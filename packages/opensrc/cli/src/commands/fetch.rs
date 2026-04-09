use std::path::PathBuf;

use crate::lib::cache::{
    get_absolute_path, list_sources, now_iso, write_sources, PackageEntry, RepoEntry,
};
use crate::lib::git::{fetch_repo_source, fetch_source, FetchResult};
use crate::lib::registries::repo::{parse_repo_spec, resolve_repo};
use crate::lib::registries::{detect_input_type, parse_package_spec, resolve_package, Registry};
use crate::lib::version::detect_installed_version;

fn registry_label(r: Registry) -> &'static str {
    r.label()
}

fn fetch_repo_input(spec: &str) -> FetchResult {
    let repo_spec = match parse_repo_spec(spec) {
        Some(s) => s,
        None => {
            return FetchResult {
                package: spec.to_string(),
                version: String::new(),
                path: String::new(),
                success: false,
                error: Some(format!("Invalid repository format: {spec}")),
                registry: None,
            }
        }
    };

    let display = format!("{}/{}/{}", repo_spec.host, repo_spec.owner, repo_spec.repo);
    println!(
        "\nFetching {}/{} from {}...",
        repo_spec.owner, repo_spec.repo, repo_spec.host
    );

    match resolve_repo(&repo_spec) {
        Ok(resolved) => {
            println!("  → Found: {}", resolved.repo_url);
            println!("  → Ref: {}", resolved.git_ref);
            println!("  → Cloning at {}...", resolved.git_ref);

            let result = fetch_repo_source(&resolved);
            if result.success {
                let abs = get_absolute_path(&result.path);
                println!("  ✓ Cached at {}", abs.display());
                if let Some(ref warn) = result.error {
                    println!("  ⚠ {warn}");
                }
            } else {
                println!(
                    "  ✗ Failed: {}",
                    result.error.as_deref().unwrap_or("unknown")
                );
            }
            result
        }
        Err(e) => {
            println!("  ✗ Error: {e}");
            FetchResult {
                package: display,
                version: String::new(),
                path: String::new(),
                success: false,
                error: Some(e.to_string()),
                registry: None,
            }
        }
    }
}

fn fetch_package_input(spec: &str, cwd: &str) -> FetchResult {
    let pkg = parse_package_spec(spec);
    let registry = pkg.registry;
    let name = pkg.name.clone();
    let mut version = pkg.version.clone();

    let label = registry_label(registry);
    println!("\nFetching {name} from {label}...");

    if version.is_none() && registry == Registry::Npm {
        let detected = detect_installed_version(&name, &PathBuf::from(cwd));
        if let Some(v) = detected {
            println!("  → Detected installed version: {v}");
            version = Some(v);
        } else {
            println!("  → No installed version found, using latest");
        }
    } else if version.is_none() {
        println!("  → Using latest version");
    } else {
        println!(
            "  → Using specified version: {}",
            version.as_deref().unwrap()
        );
    }

    println!("  → Resolving repository...");

    let spec_with_version = crate::lib::registries::PackageSpec {
        registry,
        name: name.clone(),
        version,
    };

    match resolve_package(&spec_with_version) {
        Ok(resolved) => {
            println!("  → Found: {}", resolved.repo_url);
            if let Some(ref dir) = resolved.repo_directory {
                println!("  → Monorepo path: {dir}");
            }
            println!("  → Cloning at {}...", resolved.git_tag);

            let result = fetch_source(&resolved);
            if result.success {
                let abs = get_absolute_path(&result.path);
                println!("  ✓ Cached at {}", abs.display());
                if let Some(ref warn) = result.error {
                    println!("  ⚠ {warn}");
                }
            } else {
                println!(
                    "  ✗ Failed: {}",
                    result.error.as_deref().unwrap_or("unknown")
                );
            }
            result
        }
        Err(e) => {
            println!("  ✗ Error: {e}");
            FetchResult {
                package: name,
                version: String::new(),
                path: String::new(),
                success: false,
                error: Some(e.to_string()),
                registry: Some(registry),
            }
        }
    }
}

fn merge_results(
    mut packages: Vec<PackageEntry>,
    mut repos: Vec<RepoEntry>,
    results: &[FetchResult],
) -> (Vec<PackageEntry>, Vec<RepoEntry>) {
    let now = now_iso();

    for result in results {
        if !result.success {
            continue;
        }

        if let Some(registry) = result.registry {
            let entry = PackageEntry {
                name: result.package.clone(),
                version: result.version.clone(),
                registry,
                path: result.path.clone(),
                fetched_at: now.clone(),
            };

            if let Some(idx) = packages
                .iter()
                .position(|p| p.name == result.package && p.registry == registry)
            {
                packages[idx] = entry;
            } else {
                packages.push(entry);
            }
        } else {
            let entry = RepoEntry {
                name: result.package.clone(),
                version: result.version.clone(),
                path: result.path.clone(),
                fetched_at: now.clone(),
            };

            if let Some(idx) = repos.iter().position(|r| r.name == result.package) {
                repos[idx] = entry;
            } else {
                repos.push(entry);
            }
        }
    }

    (packages, repos)
}

pub fn run(specs: &[String], cwd: Option<&str>) -> Result<(), Box<dyn std::error::Error>> {
    let cwd = cwd.unwrap_or(".");
    let mut results: Vec<FetchResult> = Vec::new();

    for spec in specs {
        let input_type = detect_input_type(spec);
        let result = if input_type == "repo" {
            fetch_repo_input(spec)
        } else {
            fetch_package_input(spec, cwd)
        };
        results.push(result);
    }

    let succeeded: Vec<&FetchResult> = results.iter().filter(|r| r.success).collect();
    let failed: Vec<&FetchResult> = results.iter().filter(|r| !r.success).collect();

    println!(
        "\nDone: {} succeeded, {} failed",
        succeeded.len(),
        failed.len()
    );

    if !succeeded.is_empty() {
        println!("\nSource code cached at:");
        for r in &succeeded {
            let abs = get_absolute_path(&r.path);
            println!("  {} → {}", r.package, abs.display());
        }

        let (packages, repos) = list_sources();
        let (packages, repos) = merge_results(packages, repos, &results);
        write_sources(packages, repos)?;
    }

    Ok(())
}
