use crate::core::cache::{
    get_package_info, list_sources, remove_package_source, remove_repo_source, write_sources,
};
use crate::core::error::{Error, Result};
use crate::core::registries::repo::{is_repo_spec, parse_repo_spec};
use crate::core::registries::{detect_registry, Registry};

pub fn run(items: &[String]) -> Result<()> {
    let mut removed = 0u32;
    let mut not_found = 0u32;
    let mut had_errors = false;

    let mut removed_packages: Vec<(String, Registry)> = Vec::new();
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

            let mut pkg_info = get_package_info(clean, registry)?;

            if pkg_info.is_none() {
                let registries = [Registry::Npm, Registry::PyPI, Registry::Crates];
                for reg in &registries {
                    if *reg != registry {
                        if let Some(info) = get_package_info(clean, *reg)? {
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
        let (packages, repos) = list_sources()?;

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
        return Err(Error::Other("Some items could not be removed".to_string()));
    }

    Ok(())
}
