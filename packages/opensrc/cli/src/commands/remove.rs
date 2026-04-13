use crate::core::cache::{
    get_package_info, list_sources, remove_package_source, remove_repo_source, write_sources,
    PackageEntry,
};
use crate::core::registries::repo::{is_repo_spec, parse_repo_spec};
use crate::core::registries::{parse_package_spec, Registry};

fn is_same_package_entry(left: &PackageEntry, right: &PackageEntry) -> bool {
    left.name == right.name
        && left.version == right.version
        && left.registry == right.registry
        && left.path == right.path
}

fn persist_removed_sources(
    removed_packages: &[PackageEntry],
    removed_repos: &[String],
) -> Result<(), Box<dyn std::error::Error>> {
    let (packages, repos) = list_sources();

    let remaining_packages: Vec<_> = packages
        .into_iter()
        .filter(|p| {
            !removed_packages
                .iter()
                .any(|removed| is_same_package_entry(p, removed))
        })
        .collect();

    let remaining_repos: Vec<_> = repos
        .into_iter()
        .filter(|r| !removed_repos.contains(&r.name))
        .collect();

    write_sources(remaining_packages, remaining_repos)?;
    Ok(())
}

pub fn run(items: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut removed = 0u32;
    let mut not_found = 0u32;
    let mut had_errors = false;

    let mut removed_packages: Vec<PackageEntry> = Vec::new();
    let mut removed_repos: Vec<String> = Vec::new();

    for item in items {
        let is_repo = is_repo_spec(item) || (item.contains('/') && !item.contains(':'));

        if is_repo {
            let display_name = match parse_repo_spec(item) {
                Some(spec) => format!("{}/{}/{}", spec.host, spec.owner, spec.repo),
                None => {
                    println!("  ✗ Could not parse repo spec: {item}");
                    had_errors = true;
                    continue;
                }
            };

            match remove_repo_source(&display_name, None) {
                Ok(true) => {
                    println!("  ✓ Removed {display_name}");
                    removed += 1;
                    removed_repos.push(display_name);
                    persist_removed_sources(&removed_packages, &removed_repos)?;
                }
                Ok(false) => {
                    println!("  ⚠ {item} not found");
                    not_found += 1;
                }
                Err(e) => {
                    println!("  ✗ Error removing {item}: {e}");
                    had_errors = true;
                }
            }
        } else {
            let parsed = parse_package_spec(item);
            let clean = parsed.name;
            let version = parsed.version;
            let mut registry = parsed.registry;

            let mut pkg_info = get_package_info(&clean, registry, version.as_deref());

            // Scan other registries if not found
            if pkg_info.is_none() {
                let registries = [Registry::Npm, Registry::PyPI, Registry::Crates];
                for reg in &registries {
                    if *reg != registry {
                        if let Some(info) = get_package_info(&clean, *reg, version.as_deref()) {
                            pkg_info = Some(info);
                            registry = *reg;
                            break;
                        }
                    }
                }
            }

            let display_name = version
                .as_ref()
                .map(|resolved| format!("{clean}@{resolved}"))
                .unwrap_or_else(|| clean.clone());

            if pkg_info.is_none() {
                println!("  ⚠ {display_name} not found");
                not_found += 1;
                continue;
            }

            match remove_package_source(&clean, registry, version.as_deref()) {
                Ok(result) => {
                    if result.removed.is_empty() {
                        println!("  ⚠ {display_name} not found");
                        not_found += 1;
                        continue;
                    }

                    println!("  ✓ Removed {display_name} ({registry})");
                    if result.repo_removed {
                        println!("    → Also removed repo (no other packages use it)");
                    }
                    removed += result.removed.len() as u32;
                    removed_packages.extend(result.removed);
                    persist_removed_sources(&removed_packages, &removed_repos)?;
                }
                Err(e) => {
                    println!("  ✗ Error removing {display_name}: {e}");
                    had_errors = true;
                }
            }
        }
    }

    let nf_msg = if not_found > 0 {
        format!(", {not_found} not found")
    } else {
        String::new()
    };
    println!("\nRemoved {removed} source(s){nf_msg}");

    if had_errors {
        return Err("Some items could not be removed".into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::core::cache::{
        get_absolute_path, list_sources, now_iso, write_sources, PackageEntry, TEST_ENV_LOCK,
    };

    use super::*;

    fn unique_test_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("opensrc_{label}_{}_{}", std::process::id(), nanos))
    }

    fn package_entry(version: &str) -> PackageEntry {
        PackageEntry {
            name: "zod".to_string(),
            version: version.to_string(),
            registry: Registry::Npm,
            path: format!("repos/github.com/colinhacks/zod/{version}"),
            fetched_at: now_iso(),
        }
    }

    fn monorepo_package_entry(name: &str) -> PackageEntry {
        PackageEntry {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            registry: Registry::Npm,
            path: format!("repos/github.com/example/monorepo/1.0.0/packages/{name}"),
            fetched_at: now_iso(),
        }
    }

    #[test]
    fn remove_exact_package_version_leaves_other_versions_intact() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let tmp = unique_test_dir("remove_exact_package_version");
        let zod3 = package_entry("3.25.76");
        let zod4 = package_entry("4.3.6");

        fs::create_dir_all(&tmp).unwrap();
        std::env::set_var("OPENSRC_HOME", &tmp);

        write_sources(vec![zod3.clone(), zod4.clone()], vec![]).unwrap();
        fs::create_dir_all(get_absolute_path(&zod3.path)).unwrap();
        fs::create_dir_all(get_absolute_path(&zod4.path)).unwrap();

        run(&["zod@3.25.76".to_string()]).unwrap();

        let (packages, _) = list_sources();
        assert_eq!(
            packages.len(),
            1,
            "only the requested version should remain removed from the index"
        );
        assert_eq!(packages[0].name, "zod");
        assert_eq!(packages[0].version, "4.3.6");
        assert!(
            !get_absolute_path(&zod3.path).exists(),
            "the removed version directory should be deleted"
        );
        assert!(
            get_absolute_path(&zod4.path).exists(),
            "other cached versions should stay on disk"
        );

        std::env::remove_var("OPENSRC_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn remove_package_without_version_cleans_up_all_cached_versions() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let tmp = unique_test_dir("remove_all_package_versions");
        let zod3 = package_entry("3.25.76");
        let zod4 = package_entry("4.3.6");

        fs::create_dir_all(&tmp).unwrap();
        std::env::set_var("OPENSRC_HOME", &tmp);

        write_sources(vec![zod3.clone(), zod4.clone()], vec![]).unwrap();
        fs::create_dir_all(get_absolute_path(&zod3.path)).unwrap();
        fs::create_dir_all(get_absolute_path(&zod4.path)).unwrap();

        run(&["zod".to_string()]).unwrap();

        let (packages, _) = list_sources();
        assert!(
            packages.is_empty(),
            "all cached versions should be removed from the index"
        );
        assert!(
            !get_absolute_path(&zod3.path).exists(),
            "the first cached version directory should be deleted"
        );
        assert!(
            !get_absolute_path(&zod4.path).exists(),
            "the second cached version directory should be deleted too"
        );

        std::env::remove_var("OPENSRC_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn remove_multiple_monorepo_packages_cleans_shared_version_directory_once_last_reference_is_gone(
    ) {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let tmp = unique_test_dir("remove_multiple_monorepo_packages");
        let pkg_a = monorepo_package_entry("pkg-a");
        let pkg_b = monorepo_package_entry("pkg-b");

        fs::create_dir_all(&tmp).unwrap();
        std::env::set_var("OPENSRC_HOME", &tmp);

        let shared_version_dir = get_absolute_path("repos/github.com/example/monorepo/1.0.0");
        write_sources(vec![pkg_a, pkg_b], vec![]).unwrap();
        fs::create_dir_all(&shared_version_dir).unwrap();

        run(&["pkg-a".to_string(), "pkg-b".to_string()]).unwrap();

        let (packages, _) = list_sources();
        assert!(packages.is_empty());
        assert!(
            !shared_version_dir.exists(),
            "shared monorepo checkout should be deleted after the final package reference is removed"
        );

        std::env::remove_var("OPENSRC_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }
}
