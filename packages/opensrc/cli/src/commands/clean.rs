use std::fs;

use crate::core::cache::{
    cleanup_empty_dirs, extract_repo_base_path, get_opensrc_dir, get_repos_dir, list_sources,
    write_sources, PackageEntry, RepoEntry,
};
use crate::core::registries::Registry;

pub fn run(
    clean_packages_flag: bool,
    clean_repos_flag: bool,
    registry: Option<Registry>,
) -> Result<(), Box<dyn std::error::Error>> {
    let clean_packages = clean_packages_flag || !clean_repos_flag;
    let clean_repos = clean_repos_flag || (!clean_packages_flag && registry.is_none());

    let (packages, repos) = list_sources();

    let mut remaining_packages: Vec<PackageEntry> = packages.clone();
    let mut remaining_repos: Vec<RepoEntry> = repos.clone();

    let mut packages_to_remove: Vec<PackageEntry> = Vec::new();
    let mut packages_removed = 0usize;

    if clean_packages {
        if let Some(reg) = registry {
            packages_to_remove = packages
                .iter()
                .filter(|p| p.registry == reg)
                .cloned()
                .collect();
            remaining_packages = packages
                .iter()
                .filter(|p| p.registry != reg)
                .cloned()
                .collect();
        } else {
            packages_to_remove = packages.clone();
            remaining_packages = Vec::new();
        }
        packages_removed = packages_to_remove.len();
    }

    let mut repos_to_remove: Vec<RepoEntry> = Vec::new();
    let mut repos_removed = 0usize;

    if clean_repos {
        repos_to_remove = repos.clone();
        remaining_repos = Vec::new();
        repos_removed = repos_to_remove.len();
    }

    // Determine which on-disk paths to remove
    let pkg_paths: std::collections::HashSet<String> = packages_to_remove
        .iter()
        .map(|p| extract_repo_base_path(&p.path))
        .collect();
    let repo_paths: std::collections::HashSet<String> =
        repos_to_remove.iter().map(|r| r.path.clone()).collect();
    let needed_paths: std::collections::HashSet<String> = remaining_packages
        .iter()
        .map(|p| extract_repo_base_path(&p.path))
        .collect();

    let all_paths: std::collections::HashSet<String> =
        pkg_paths.union(&repo_paths).cloned().collect();
    let opensrc_dir = get_opensrc_dir();

    let mut delete_errors = 0usize;
    for repo_path in &all_paths {
        if !needed_paths.contains(repo_path) {
            let full = opensrc_dir.join(repo_path);
            if full.exists() {
                if let Err(e) = fs::remove_dir_all(&full) {
                    eprintln!("Warning: failed to remove {}: {e}", full.display());
                    delete_errors += 1;
                }
            }
        }
    }

    let repos_dir = get_repos_dir();
    if repos_dir.exists() {
        cleanup_empty_dirs(&repos_dir);
    }

    if clean_packages {
        if let Some(reg) = registry {
            println!("✓ Removed {packages_removed} {} package(s)", reg.label());
        } else if packages_removed > 0 {
            println!("✓ Removed {packages_removed} package(s)");
        } else {
            println!("No packages to remove");
        }
    }

    if clean_repos {
        if repos_removed > 0 {
            println!("✓ Removed {repos_removed} repo(s)");
        } else {
            println!("No repos to remove");
        }
    }

    let total = packages_removed + repos_removed;

    if total > 0 {
        write_sources(remaining_packages, remaining_repos)?;
    }

    println!("\nCleaned {total} source(s)");

    if delete_errors > 0 {
        return Err(format!("Failed to remove {delete_errors} path(s) from disk").into());
    }

    Ok(())
}
