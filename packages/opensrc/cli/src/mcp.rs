use std::collections::HashSet;
use std::fs;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::{schemars, tool, tool_router, ServiceExt};
use serde::{Deserialize, Serialize};

use crate::core::cache::{
    cleanup_empty_dirs, extract_repo_base_path, get_opensrc_dir, get_package_info, get_repos_dir,
    list_sources, read_sources, remove_package_source, remove_repo_source, write_sources,
    PackageEntry, RepoEntry,
};
use crate::core::error::Error;
use crate::core::fetcher::ensure_cached;
use crate::core::registries::repo::{is_repo_spec, parse_repo_spec};
use crate::core::registries::{detect_registry, Registry};

// --- Tool parameter structs ---

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct FetchParams {
    /// Package or repo specs (e.g. "zod", "pypi:requests", "owner/repo")
    packages: Vec<String>,
    /// Working directory for lockfile version resolution
    cwd: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct PathParams {
    /// Package or repo spec (e.g. "zod", "pypi:requests", "owner/repo")
    package: String,
    /// Working directory for lockfile version resolution
    cwd: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct RemoveParams {
    /// Packages or repos to remove from the cache
    packages: Vec<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct CleanParams {
    /// Only remove packages (not repos). Defaults to removing both.
    packages: Option<bool>,
    /// Only remove repos (not packages). Defaults to removing both.
    repos: Option<bool>,
    /// Only remove packages from this registry: "npm", "pypi", or "crates"
    registry: Option<String>,
}

// --- JSON response helpers ---

#[derive(Serialize)]
struct FetchResult {
    name: String,
    version: String,
    path: String,
    from_cache: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

#[derive(Serialize)]
struct FetchError {
    package: String,
    error: String,
}

#[derive(Serialize)]
struct FetchResponse {
    results: Vec<FetchResult>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    errors: Vec<FetchError>,
}

#[derive(Serialize)]
struct RemoveResult {
    removed: u32,
    not_found: u32,
    errors: Vec<String>,
}

#[derive(Serialize)]
struct CleanResult {
    packages_removed: usize,
    repos_removed: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    errors: Vec<String>,
}

// --- Server ---

#[derive(Clone)]
pub struct OpensrcServer;

#[tool_router(server_handler)]
impl OpensrcServer {
    #[tool(
        description = "Fetch source code for one or more packages or repos into the local cache. \
        Accepts npm packages (e.g. \"zod\"), PyPI packages (\"pypi:requests\"), \
        crates.io packages (\"crates:serde\"), or GitHub repos (\"owner/repo\")."
    )]
    async fn opensrc_fetch(&self, Parameters(params): Parameters<FetchParams>) -> String {
        let packages = params.packages;
        let cwd = params.cwd.unwrap_or_else(|| ".".to_string());

        tokio::task::spawn_blocking(move || {
            let mut response = FetchResponse {
                results: Vec::new(),
                errors: Vec::new(),
            };

            for spec in &packages {
                match ensure_cached(spec, &cwd, false) {
                    Ok(outcome) => {
                        response.results.push(FetchResult {
                            name: outcome.name,
                            version: outcome.version,
                            path: outcome.path.display().to_string(),
                            from_cache: outcome.from_cache,
                            warning: outcome.warning,
                        });
                    }
                    Err(e) => {
                        response.errors.push(FetchError {
                            package: spec.clone(),
                            error: e.to_string(),
                        });
                    }
                }
            }

            serde_json::to_string_pretty(&response).unwrap_or_else(|e| format!("Error: {e}"))
        })
        .await
        .unwrap_or_else(|e| format!("Error: {e}"))
    }

    #[tool(
        description = "Get the absolute path to a cached package's source code. \
        Fetches on cache miss. Use this path with file-reading tools to explore the source."
    )]
    async fn opensrc_path(&self, Parameters(params): Parameters<PathParams>) -> String {
        let package = params.package;
        let cwd = params.cwd.unwrap_or_else(|| ".".to_string());

        tokio::task::spawn_blocking(move || match ensure_cached(&package, &cwd, false) {
            Ok(outcome) => outcome.path.display().to_string(),
            Err(e) => format!("Error: {e}"),
        })
        .await
        .unwrap_or_else(|e| format!("Error: {e}"))
    }

    #[tool(description = "List all cached source code packages and repos. \
        Returns the full sources index as JSON.")]
    async fn opensrc_list(&self) -> String {
        tokio::task::spawn_blocking(|| match read_sources() {
            Ok(index) => {
                serde_json::to_string_pretty(&index).unwrap_or_else(|e| format!("Error: {e}"))
            }
            Err(e) => format!("Error: {e}"),
        })
        .await
        .unwrap_or_else(|e| format!("Error: {e}"))
    }

    #[tool(description = "Remove cached source code for specific packages or repos.")]
    async fn opensrc_remove(&self, Parameters(params): Parameters<RemoveParams>) -> String {
        let packages = params.packages;

        tokio::task::spawn_blocking(move || {
            let mut removed = 0u32;
            let mut not_found = 0u32;
            let mut errors: Vec<String> = Vec::new();
            let mut removed_packages: Vec<(String, Registry)> = Vec::new();
            let mut removed_repos: Vec<String> = Vec::new();

            for item in &packages {
                let is_repo = is_repo_spec(item) || (item.contains('/') && !item.contains(':'));

                if is_repo {
                    let display_name = match parse_repo_spec(item) {
                        Some(spec) => format!("{}/{}/{}", spec.host, spec.owner, spec.repo),
                        None => {
                            errors.push(format!("Could not parse repo spec: {item}"));
                            continue;
                        }
                    };

                    match remove_repo_source(&display_name, None) {
                        Ok(true) => {
                            removed += 1;
                            removed_repos.push(display_name);
                        }
                        Ok(false) => not_found += 1,
                        Err(e) => errors.push(format!("{item}: {e}")),
                    }
                } else {
                    let detected = detect_registry(item);
                    let clean = &detected.clean_spec;
                    let mut registry = detected.registry;

                    let mut pkg_info = match get_package_info(clean, registry) {
                        Ok(info) => info,
                        Err(e) => {
                            errors.push(format!("{item}: {e}"));
                            continue;
                        }
                    };

                    if pkg_info.is_none() {
                        let registries = [Registry::Npm, Registry::PyPI, Registry::Crates];
                        for reg in &registries {
                            if *reg != registry {
                                if let Ok(Some(info)) = get_package_info(clean, *reg) {
                                    pkg_info = Some(info);
                                    registry = *reg;
                                    break;
                                }
                            }
                        }
                    }

                    if pkg_info.is_none() {
                        not_found += 1;
                        continue;
                    }

                    match remove_package_source(clean, registry) {
                        Ok((true, _)) => {
                            removed += 1;
                            removed_packages.push((clean.clone(), registry));
                        }
                        Ok((false, _)) => errors.push(format!("Failed to remove {clean}")),
                        Err(e) => errors.push(format!("{clean}: {e}")),
                    }
                }
            }

            if removed > 0 {
                if let Ok((packages, repos)) = list_sources() {
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
                    let _ = write_sources(remaining_packages, remaining_repos);
                }
            }

            let result = RemoveResult {
                removed,
                not_found,
                errors,
            };
            serde_json::to_string_pretty(&result).unwrap_or_else(|e| format!("Error: {e}"))
        })
        .await
        .unwrap_or_else(|e| format!("Error: {e}"))
    }

    #[tool(description = "Remove all cached packages and/or repos. \
        With no arguments, removes everything. Use 'packages' or 'repos' to limit scope, \
        or 'registry' to target a specific registry (\"npm\", \"pypi\", \"crates\").")]
    async fn opensrc_clean(&self, Parameters(params): Parameters<CleanParams>) -> String {
        tokio::task::spawn_blocking(move || {
            let registry = params.registry.as_deref().and_then(|r| match r {
                "npm" => Some(Registry::Npm),
                "pypi" => Some(Registry::PyPI),
                "crates" => Some(Registry::Crates),
                _ => None,
            });

            let clean_packages_flag = params.packages.unwrap_or(false);
            let clean_repos_flag = params.repos.unwrap_or(false);

            let clean_packages = clean_packages_flag || registry.is_some() || !clean_repos_flag;
            let clean_repos = clean_repos_flag || (!clean_packages_flag && registry.is_none());

            let (packages, repos) = match list_sources() {
                Ok(v) => v,
                Err(e) => return format!("Error: {e}"),
            };

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

            let pkg_paths: HashSet<String> = packages_to_remove
                .iter()
                .map(|p| extract_repo_base_path(&p.path))
                .collect();
            let repo_paths: HashSet<String> =
                repos_to_remove.iter().map(|r| r.path.clone()).collect();
            let needed_paths: HashSet<String> = remaining_packages
                .iter()
                .map(|p| extract_repo_base_path(&p.path))
                .collect();
            let all_paths: HashSet<String> = pkg_paths.union(&repo_paths).cloned().collect();

            let mut errors: Vec<String> = Vec::new();

            if let Ok(opensrc_dir) = get_opensrc_dir() {
                for repo_path in &all_paths {
                    if !needed_paths.contains(repo_path) {
                        let full = opensrc_dir.join(repo_path);
                        if full.exists() {
                            if let Err(e) = fs::remove_dir_all(&full) {
                                errors.push(format!("Failed to remove {}: {e}", full.display()));
                            }
                        }
                    }
                }

                if let Ok(repos_dir) = get_repos_dir() {
                    if repos_dir.exists() {
                        cleanup_empty_dirs(&repos_dir);
                    }
                }
            }

            let total = packages_removed + repos_removed;
            if total > 0 {
                let _ = write_sources(remaining_packages, remaining_repos);
            }

            let result = CleanResult {
                packages_removed,
                repos_removed,
                errors,
            };
            serde_json::to_string_pretty(&result).unwrap_or_else(|e| format!("Error: {e}"))
        })
        .await
        .unwrap_or_else(|e| format!("Error: {e}"))
    }
}

pub fn run() -> crate::core::error::Result<()> {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| Error::Other(format!("Failed to create tokio runtime: {e}")))?;

    rt.block_on(async {
        let transport = rmcp::transport::stdio();
        let server = OpensrcServer
            .serve(transport)
            .await
            .map_err(|e| Error::Other(format!("MCP server error: {e}")))?;

        server
            .waiting()
            .await
            .map_err(|e| Error::Other(format!("MCP server error: {e}")))?;

        Ok(())
    })
}
