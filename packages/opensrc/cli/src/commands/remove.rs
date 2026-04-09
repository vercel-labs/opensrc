use crate::lib::cache::{
    get_package_info, list_sources, remove_package_source, remove_repo_source, write_sources,
};
use crate::lib::registries::repo::is_repo_spec;
use crate::lib::registries::{detect_registry, Registry};

pub fn run(items: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut removed = 0u32;
    let mut not_found = 0u32;

    let mut removed_packages: Vec<(String, Registry)> = Vec::new();
    let mut removed_repos: Vec<String> = Vec::new();

    for item in items {
        let is_repo = is_repo_spec(item) || (item.contains('/') && !item.contains(':'));

        if is_repo {
            let mut display_name = item.clone();
            let slash_count = item.chars().filter(|c| *c == '/').count();
            if slash_count == 1 && !item.starts_with("http") {
                display_name = format!("github.com/{item}");
            }

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
                }
                Err(e) => {
                    println!("  ✗ Error removing {clean}: {e}");
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

    Ok(())
}
