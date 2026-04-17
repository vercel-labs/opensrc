use crate::core::cache::{get_absolute_path, list_sources};
use crate::core::registries::Registry;

pub fn run(json: bool) -> Result<(), Box<dyn std::error::Error>> {
    let (packages, repos) = list_sources();
    let total = packages.len() + repos.len();

    if total == 0 {
        println!("No sources cached yet.");
        println!("\nUse `opensrc fetch <package>` to cache source code for a package.");
        println!("Use `opensrc fetch <owner>/<repo>` to cache a GitHub repository.");
        println!("\nSupported registries:");
        println!("  • npm:      opensrc fetch zod, opensrc fetch npm:react");
        println!("  • PyPI:     opensrc fetch pypi:requests");
        println!("  • crates:   opensrc fetch crates:serde");
        return Ok(());
    }

    if json {
        let index = crate::core::cache::read_sources();
        println!("{}", serde_json::to_string_pretty(&index)?);
        return Ok(());
    }

    let registries = [Registry::Npm, Registry::PyPI, Registry::Crates];
    let mut displayed_packages = false;

    for registry in &registries {
        let pkgs: Vec<_> = packages
            .iter()
            .filter(|p| p.registry == *registry)
            .collect();
        if pkgs.is_empty() {
            continue;
        }

        if displayed_packages {
            println!();
        }

        println!("{} Packages:\n", registry.label());
        displayed_packages = true;

        for pkg in &pkgs {
            let date = format_date(&pkg.fetched_at);
            println!("  {}@{}", pkg.name, pkg.version);
            println!("    Path: {}", get_absolute_path(&pkg.path).display());
            println!("    Fetched: {date}");
            println!();
        }
    }

    if !repos.is_empty() {
        if displayed_packages {
            println!();
        }
        println!("Repositories:\n");

        for repo in &repos {
            let date = format_date(&repo.fetched_at);
            println!("  {}@{}", repo.name, repo.version);
            println!("    Path: {}", get_absolute_path(&repo.path).display());
            println!("    Fetched: {date}");
            println!();
        }
    }

    // Summary
    let mut parts = Vec::new();
    let mut registry_parts = Vec::new();
    for registry in &registries {
        let count = packages.iter().filter(|p| p.registry == *registry).count();
        if count > 0 {
            registry_parts.push(format!("{count} {}", registry.label()));
        }
    }

    if !packages.is_empty() {
        if registry_parts.is_empty() {
            parts.push(format!("{} package(s)", packages.len()));
        } else {
            parts.push(format!(
                "{} package(s) ({})",
                packages.len(),
                registry_parts.join(", ")
            ));
        }
    }

    if !repos.is_empty() {
        parts.push(format!("{} repo(s)", repos.len()));
    }

    println!("Total: {}", parts.join(", "));

    Ok(())
}

fn format_date(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|dt| dt.format("%b %d, %Y").to_string())
        .unwrap_or_else(|_| iso.to_string())
}
