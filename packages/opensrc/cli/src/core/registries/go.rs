use serde::Deserialize;

use crate::core::error::{Error, Result};

use super::{is_git_repo_url, normalize_repo_url, Registry, ResolvedPackage};

const GO_PROXY: &str = "https://proxy.golang.org";

#[derive(Deserialize)]
struct GoOrigin {
    #[serde(rename = "URL")]
    url: Option<String>,
}

#[derive(Deserialize)]
struct GoModuleInfo {
    #[serde(rename = "Version")]
    version: String,
    #[serde(rename = "Origin")]
    origin: Option<GoOrigin>,
}

pub fn parse_go_spec(spec: &str) -> (String, Option<String>) {
    if let Some(at_idx) = spec.rfind('@') {
        if at_idx > 0 {
            return (
                spec[..at_idx].trim().to_string(),
                Some(spec[at_idx + 1..].trim().to_string()),
            );
        }
    }
    (spec.trim().to_string(), None)
}

/// Apply the module proxy's case encoding: each uppercase ASCII letter becomes
/// `!` followed by its lowercase form, so `github.com/Azure/x` is requested as
/// `github.com/!azure/x`. Module paths and versions both use this encoding.
fn escape_proxy_path(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch.is_ascii_uppercase() {
            escaped.push('!');
            escaped.push(ch.to_ascii_lowercase());
        } else {
            escaped.push(ch);
        }
    }
    escaped
}

fn module_url(module: &str, version: Option<&str>) -> String {
    let encoded = escape_proxy_path(module);
    match version {
        Some(v) => {
            let encoded_version = escape_proxy_path(v);
            format!("{GO_PROXY}/{encoded}/@v/{encoded_version}.info")
        }
        None => format!("{GO_PROXY}/{encoded}/@latest"),
    }
}

fn fetch_module_info(module: &str, version: Option<&str>) -> Result<GoModuleInfo> {
    let url = module_url(module, version);

    let client = super::http_client();
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .send()?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(Error::PackageNotFound {
            name: module.to_string(),
            registry: "Go module proxy".to_string(),
        });
    }
    if !resp.status().is_success() {
        return Err(Error::HttpStatus {
            context: "module info".to_string(),
            status: resp.status().to_string(),
        });
    }

    Ok(resp.json()?)
}

/// Derive a clone URL from the module path when the proxy doesn't return Origin.
fn repo_url_from_module_path(module: &str) -> Option<String> {
    let parts: Vec<&str> = module.splitn(4, '/').collect();
    if parts.len() < 3 {
        return None;
    }
    let host = parts[0];
    let owner = parts[1];
    let repo = parts[2];

    let url = format!("https://{host}/{owner}/{repo}");
    if is_git_repo_url(&url) {
        Some(normalize_repo_url(&url))
    } else {
        // For non-standard hosts like go.googlesource.com, try the module root
        Some(format!("https://{host}/{owner}/{repo}"))
    }
}

/// Rewrite go.googlesource.com URLs to their GitHub mirrors.
/// Google maintains official mirrors at github.com/golang/* for all
/// golang.org/x/* modules. The GitHub URL is needed because the cache
/// system expects host/owner/repo structure.
fn normalize_googlesource_url(url: &str) -> Option<String> {
    if url.contains("go.googlesource.com") {
        // https://go.googlesource.com/tools -> https://github.com/golang/tools
        let repo_name = url.rsplit('/').next()?;
        Some(format!("https://github.com/golang/{repo_name}"))
    } else {
        None
    }
}

fn extract_repo_url(info: &GoModuleInfo, module: &str) -> Option<String> {
    // Prefer Origin.URL from the proxy response
    if let Some(ref origin) = info.origin {
        if let Some(ref url) = origin.url {
            // Rewrite googlesource URLs to GitHub mirrors
            if let Some(github_url) = normalize_googlesource_url(url) {
                return Some(github_url);
            }
            return Some(normalize_repo_url(url));
        }
    }

    // Fall back to deriving from the module path
    repo_url_from_module_path(module)
}

pub fn resolve_go_module(module: &str, version: Option<&str>) -> Result<ResolvedPackage> {
    let info = fetch_module_info(module, version)?;
    let resolved_version = info.version.clone();

    let repo_url = extract_repo_url(&info, module).ok_or_else(|| {
        Error::NoRepoUrl(format!(
            "No repository URL found for \"{module}@{resolved_version}\". \
             Could not resolve the module path to a git repository."
        ))
    })?;

    let git_tag = resolved_version.clone();

    Ok(ResolvedPackage {
        registry: Registry::Go,
        name: module.to_string(),
        version: resolved_version,
        repo_url,
        repo_directory: None,
        git_tag,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_go_spec_simple() {
        let (name, version) = parse_go_spec("golang.org/x/tools");
        assert_eq!(name, "golang.org/x/tools");
        assert_eq!(version, None);
    }

    #[test]
    fn test_parse_go_spec_with_version() {
        let (name, version) = parse_go_spec("golang.org/x/tools@v0.43.0");
        assert_eq!(name, "golang.org/x/tools");
        assert_eq!(version, Some("v0.43.0".into()));
    }

    #[test]
    fn test_parse_go_spec_github() {
        let (name, version) = parse_go_spec("github.com/gin-gonic/gin@v1.9.0");
        assert_eq!(name, "github.com/gin-gonic/gin");
        assert_eq!(version, Some("v1.9.0".into()));
    }

    #[test]
    fn test_module_url_case_encodes_uppercase_path() {
        assert_eq!(
            module_url("github.com/Azure/azure-sdk-for-go", None),
            "https://proxy.golang.org/github.com/!azure/azure-sdk-for-go/@latest"
        );
    }

    #[test]
    fn test_module_url_case_encodes_version() {
        assert_eq!(
            module_url("github.com/BurntSushi/toml", Some("v1.0.0-RC1")),
            "https://proxy.golang.org/github.com/!burnt!sushi/toml/@v/v1.0.0-!r!c1.info"
        );
    }

    #[test]
    fn test_module_url_leaves_lowercase_path_unchanged() {
        assert_eq!(
            module_url("golang.org/x/tools", Some("v0.43.0")),
            "https://proxy.golang.org/golang.org/x/tools/@v/v0.43.0.info"
        );
    }

    #[test]
    fn test_repo_url_from_module_path_github() {
        let url = repo_url_from_module_path("github.com/gin-gonic/gin");
        assert_eq!(url, Some("https://github.com/gin-gonic/gin".into()));
    }

    #[test]
    fn test_repo_url_from_module_path_googlesource() {
        let url = repo_url_from_module_path("golang.org/x/tools");
        // golang.org is not a recognized git host, but we still construct a URL
        assert_eq!(url, Some("https://golang.org/x/tools".into()));
    }

    #[test]
    fn test_repo_url_from_module_path_too_short() {
        let url = repo_url_from_module_path("golang.org/x");
        assert_eq!(url, None);
    }

    #[test]
    fn test_normalize_googlesource_url() {
        assert_eq!(
            normalize_googlesource_url("https://go.googlesource.com/tools"),
            Some("https://github.com/golang/tools".into())
        );
    }

    #[test]
    fn test_normalize_googlesource_url_not_googlesource() {
        assert_eq!(
            normalize_googlesource_url("https://github.com/gin-gonic/gin"),
            None
        );
    }
}
