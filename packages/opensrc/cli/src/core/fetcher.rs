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

/// The outcome of ensuring a package or repo is cached locally.
pub struct FetchOutcome {
    pub path: PathBuf,
    pub name: String,
    pub version: String,
    pub source_label: String,
    pub from_cache: bool,
    pub warning: Option<String>,
}

fn log(verbose: bool, msg: &str) {
    if verbose {
        eprintln!("{msg}");
    }
}

fn ensure_package_cached(
    spec: &str,
    cwd: &str,
    verbose: bool,
) -> Result<FetchOutcome, Box<dyn std::error::Error>> {
    let parsed = parse_package_spec(spec);
    let registry = parsed.registry;
    let name = parsed.name.clone();
    let mut version = parsed.version.clone();

    if let Some(ref v) = version {
        if let Some(existing) = get_package_info(&name, registry) {
            if existing.version == *v {
                return Ok(FetchOutcome {
                    path: get_absolute_path(&existing.path),
                    name: existing.name,
                    version: existing.version,
                    source_label: registry.label().to_string(),
                    from_cache: true,
                    warning: None,
                });
            }
        }
    }

    if version.is_none() && registry == Registry::Npm {
        let detected = detect_installed_version(&name, &PathBuf::from(cwd));
        if let Some(v) = detected {
            version = Some(v.clone());
            if let Some(existing) = get_package_info(&name, registry) {
                if existing.version == v {
                    return Ok(FetchOutcome {
                        path: get_absolute_path(&existing.path),
                        name: existing.name,
                        version: existing.version,
                        source_label: registry.label().to_string(),
                        from_cache: true,
                        warning: None,
                    });
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
        packages[idx] = entry.clone();
    } else {
        packages.push(entry.clone());
    }
    write_sources(packages, repos)?;

    Ok(FetchOutcome {
        path: get_absolute_path(&result.path),
        name: result.package,
        version: result.version,
        source_label: registry.label().to_string(),
        from_cache: false,
        warning: result.error,
    })
}

fn ensure_repo_cached(
    spec: &str,
    verbose: bool,
) -> Result<FetchOutcome, Box<dyn std::error::Error>> {
    let repo_spec = match parse_repo_spec(spec) {
        Some(s) => s,
        None => {
            return Err(format!("Invalid repository format: {spec}").into());
        }
    };

    let display = format!("{}/{}/{}", repo_spec.host, repo_spec.owner, repo_spec.repo);

    if let Some(ref r) = repo_spec.git_ref {
        if let Some(existing) = get_repo_info(&display) {
            if existing.version == *r {
                return Ok(FetchOutcome {
                    path: get_absolute_path(&existing.path),
                    name: existing.name,
                    version: existing.version,
                    source_label: repo_spec.host.clone(),
                    from_cache: true,
                    warning: None,
                });
            }
        }
    }

    log(
        verbose,
        &format!("Fetching {}/{}...", repo_spec.owner, repo_spec.repo),
    );
    let resolved = resolve_repo(&repo_spec)?;
    log(verbose, &format!("  → Cloning at {}...", resolved.git_ref));

    let result = fetch_repo_source(&resolved);

    if !result.success {
        return Err(format!("Failed: {}", result.error.as_deref().unwrap_or("unknown")).into());
    }

    if let Some(ref warn) = result.error {
        log(verbose, &format!("  ⚠ {warn}"));
    }

    let (packages, mut repos) = list_sources();
    let entry = RepoEntry {
        name: result.package.clone(),
        version: result.version.clone(),
        path: result.path.clone(),
        fetched_at: now_iso(),
    };
    if let Some(idx) = repos.iter().position(|r| r.name == entry.name) {
        repos[idx] = entry.clone();
    } else {
        repos.push(entry.clone());
    }
    write_sources(packages, repos)?;

    Ok(FetchOutcome {
        path: get_absolute_path(&result.path),
        name: result.package,
        version: result.version,
        source_label: repo_spec.host,
        from_cache: false,
        warning: result.error,
    })
}

/// Ensure the given spec (package or repo) is cached locally, fetching it if
/// necessary. Returns information about where it ended up on disk.
pub fn ensure_cached(
    spec: &str,
    cwd: &str,
    verbose: bool,
) -> Result<FetchOutcome, Box<dyn std::error::Error>> {
    if detect_input_type(spec) == "repo" {
        ensure_repo_cached(spec, verbose)
    } else {
        ensure_package_cached(spec, cwd, verbose)
    }
}
