use crate::core::cache::{
    get_package_info, get_repo_info, list_sources, remove_package_source, remove_repo_source,
    write_sources,
};
use crate::core::registries::repo::{is_repo_spec, parse_repo_spec};
use crate::core::registries::{detect_registry, Registry};

pub fn run(items: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut removed = 0u32;
    let mut not_found = 0u32;
    let mut had_errors = false;

    let mut removed_packages: Vec<(String, Registry)> = Vec::new();
    let mut removed_repos: Vec<String> = Vec::new();

    for item in items {
        let is_repo = is_repo_spec(item) || (item.contains('/') && !item.contains(':'));

        if is_repo {
            let parsed = match parse_repo_spec(item) {
                Some(spec) => spec,
                None => {
                    println!("  ✗ Could not parse repo spec: {item}");
                    had_errors = true;
                    continue;
                }
            };
            let display_name = format!("{}/{}/{}", parsed.host, parsed.owner, parsed.repo);
            let sources_key = parsed
                .subpath
                .as_ref()
                .map(|s| format!("{display_name}/{s}"))
                .unwrap_or_else(|| display_name.clone());

            let removal = if let Some(entry) = get_repo_info(&sources_key) {
                remove_repo_source(&display_name, Some(&entry.version))
            } else {
                remove_repo_source(&display_name, None)
            };

            match removal {
                Ok(true) => {
                    if let Some(sp) = &parsed.subpath {
                        println!("  ✓ Removed {display_name}/{sp}");
                    } else {
                        println!("  ✓ Removed {display_name}");
                    }
                    removed += 1;
                    removed_repos.push(sources_key);
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
            let detected = detect_registry(item);
            let clean = &detected.clean_spec;
            let mut registry = detected.registry;

            let mut pkg_info = get_package_info(clean, registry);

            // Scan other registries if not found
            if pkg_info.is_none() {
                let registries = [Registry::Npm, Registry::PyPI, Registry::Crates];
                for reg in &registries {
                    if *reg != registry {
                        if let Some(info) = get_package_info(clean, *reg) {
                            pkg_info = Some(info);
                            registry = *reg;
                            break;
                        }
                    }
                }
            }

            if pkg_info.is_none() {
                println!("  ⚠ {clean} not found");
                not_found += 1;
                continue;
            }

            match remove_package_source(clean, registry) {
                Ok((true, repo_removed)) => {
                    println!("  ✓ Removed {clean} ({registry})");
                    if repo_removed {
                        println!("    → Also removed repo (no other packages use it)");
                    }
                    removed += 1;
                    removed_packages.push((clean.clone(), registry));
                }
                Ok((false, _)) => {
                    println!("  ✗ Failed to remove {clean}");
                    had_errors = true;
                }
                Err(e) => {
                    println!("  ✗ Error removing {clean}: {e}");
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

    if removed > 0 {
        let (packages, repos) = list_sources();

        let remaining_packages: Vec<_> = packages
            .into_iter()
            .filter(|p| {
                !removed_packages
                    .iter()
                    .any(|(name, reg)| p.name == *name && p.registry == *reg)
            })
            .collect();

        let remaining_repos: Vec<_> = repos
            .into_iter()
            .filter(|r| !removed_repos.contains(&r.name))
            .collect();

        write_sources(remaining_packages, remaining_repos)?;
    }

    if had_errors {
        return Err("Some items could not be removed".into());
    }

    Ok(())
}
