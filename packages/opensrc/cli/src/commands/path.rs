use std::path::PathBuf;

use crate::core::cache::{
    get_absolute_path, get_package_info, get_repo_info, list_sources, now_iso, write_sources,
    PackageEntry, RepoEntry,
};
use crate::core::git::{fetch_repo_source, fetch_source};
use crate::core::registries::repo::{parse_repo_spec, resolve_repo};
use crate::core::registries::{
    detect_input_type, parse_package_spec, resolve_package, PackageSpec, Registry,
};
use crate::core::version::detect_installed_version;

fn log(verbose: bool, msg: &str) {
    if verbose {
        eprintln!("{msg}");
    }
}

fn handle_package(spec: &str, cwd: &str, verbose: bool) -> Result<(), Box<dyn std::error::Error>> {
    let parsed = parse_package_spec(spec);
    let registry = parsed.registry;
    let name = parsed.name.clone();
    let mut version = parsed.version.clone();

    // Check cache if version is specified
    if let Some(ref v) = version {
        if let Some(existing) = get_package_info(&name, registry) {
            if existing.version == *v {
                let abs = get_absolute_path(&existing.path);
                println!("{}", abs.display());
                return Ok(());
            }
        }
    }

    // Detect installed version for npm
    if version.is_none() && registry == Registry::Npm {
        let detected = detect_installed_version(&name, &PathBuf::from(cwd));
        if let Some(v) = detected {
            version = Some(v.clone());
            if let Some(existing) = get_package_info(&name, registry) {
                if existing.version == v {
                    let abs = get_absolute_path(&existing.path);
                    println!("{}", abs.display());
                    return Ok(());
                }
            }
        }
    }

    log(
        verbose,
        &format!("Fetching {name} from {}...", registry.label()),
    );

    let pkg_spec = PackageSpec {
        registry,
        name: name.clone(),
        version,
    };
    let resolved = resolve_package(&pkg_spec)?;
    log(verbose, &format!("  → Cloning at {}...", resolved.git_tag));

    let result = fetch_source(&resolved);

    if !result.success {
        return Err(format!("Failed: {}", result.error.as_deref().unwrap_or("unknown")).into());
    }

    if let Some(ref warn) = result.error {
        log(verbose, &format!("  ⚠ {warn}"));
    }

    // Update index
    let (mut packages, repos) = list_sources();
    let entry = PackageEntry {
        name: result.package.clone(),
        version: result.version.clone(),
        registry: result.registry.unwrap_or(Registry::Npm),
        path: result.path.clone(),
        fetched_at: now_iso(),
    };
    if let Some(idx) = packages
        .iter()
        .position(|p| p.name == entry.name && p.registry == entry.registry)
    {
        packages[idx] = entry;
    } else {
        packages.push(entry);
    }
    write_sources(packages, repos)?;

    let abs = get_absolute_path(&result.path);
    log(verbose, &format!("  ✓ Cached at {}", abs.display()));
    println!("{}", abs.display());
    Ok(())
}

fn handle_repo(spec: &str, _cwd: &str, verbose: bool) -> Result<(), Box<dyn std::error::Error>> {
    let repo_spec = match parse_repo_spec(spec) {
        Some(s) => s,
        None => {
            return Err(format!("Invalid repository format: {spec}").into());
        }
    };

    let display = format!("{}/{}/{}", repo_spec.host, repo_spec.owner, repo_spec.repo);
    let display_with_subpath = repo_spec
        .subpath
        .as_ref()
        .map(|s| format!("{display}/{s}"))
        .unwrap_or_else(|| display.clone());

    // Check cache
    if let Some(ref r) = repo_spec.git_ref {
        if let Some(existing) = get_repo_info(&display_with_subpath) {
            if existing.version == *r {
                let abs = get_absolute_path(&existing.path);
                println!("{}", abs.display());
                return Ok(());
            }
        }
    }

    log(
        verbose,
        &match &repo_spec.subpath {
            Some(sp) => format!("Fetching {}/{}/{}...", repo_spec.owner, repo_spec.repo, sp),
            None => format!("Fetching {}/{}...", repo_spec.owner, repo_spec.repo),
        },
    );
    let resolved = resolve_repo(&repo_spec)?;

    if repo_spec.git_ref.is_none() && repo_spec.subpath.is_some() {
        if let Some(existing) = get_repo_info(&display_with_subpath) {
            if existing.version == resolved.git_ref {
                let abs = get_absolute_path(&existing.path);
                println!("{}", abs.display());
                return Ok(());
            }
        }
    }

    log(verbose, &format!("  → Cloning at {}...", resolved.git_ref));

    let result = fetch_repo_source(&resolved);

    if !result.success {
        return Err(format!("Failed: {}", result.error.as_deref().unwrap_or("unknown")).into());
    }

    if let Some(ref warn) = result.error {
        log(verbose, &format!("  ⚠ {warn}"));
    }

    // Update index
    let (packages, mut repos) = list_sources();
    let entry = RepoEntry {
        name: result.package.clone(),
        version: result.version.clone(),
        path: result.path.clone(),
        fetched_at: now_iso(),
    };
    if let Some(idx) = repos.iter().position(|r| r.name == entry.name) {
        repos[idx] = entry;
    } else {
        repos.push(entry);
    }
    write_sources(packages, repos)?;

    let abs = get_absolute_path(&result.path);
    log(verbose, &format!("  ✓ Cached at {}", abs.display()));
    println!("{}", abs.display());
    Ok(())
}

fn run_one(spec: &str, cwd: &str, verbose: bool) -> Result<(), Box<dyn std::error::Error>> {
    let input_type = detect_input_type(spec);

    if input_type == "repo" {
        handle_repo(spec, cwd, verbose)
    } else {
        handle_package(spec, cwd, verbose)
    }
}

pub fn run(
    specs: &[String],
    cwd: Option<&str>,
    verbose: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let cwd = cwd.unwrap_or(".");
    for spec in specs {
        run_one(spec, cwd, verbose)?;
    }
    Ok(())
}
