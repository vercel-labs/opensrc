pub mod crates;
pub mod npm;
pub mod pypi;
pub mod repo;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Registry {
    Npm,
    #[serde(rename = "pypi")]
    PyPI,
    Crates,
}

impl std::fmt::Display for Registry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Registry::Npm => write!(f, "npm"),
            Registry::PyPI => write!(f, "pypi"),
            Registry::Crates => write!(f, "crates"),
        }
    }
}

impl Registry {
    pub fn label(&self) -> &'static str {
        match self {
            Registry::Npm => "npm",
            Registry::PyPI => "PyPI",
            Registry::Crates => "crates.io",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedPackage {
    pub registry: Registry,
    pub name: String,
    pub version: String,
    pub repo_url: String,
    pub repo_directory: Option<String>,
    pub git_tag: String,
}

#[derive(Debug, Clone)]
pub struct PackageSpec {
    pub registry: Registry,
    pub name: String,
    pub version: Option<String>,
}

pub struct DetectedRegistry {
    pub registry: Registry,
    pub clean_spec: String,
}

const REGISTRY_PREFIXES: &[(&str, Registry)] = &[
    ("npm:", Registry::Npm),
    ("pypi:", Registry::PyPI),
    ("pip:", Registry::PyPI),
    ("python:", Registry::PyPI),
    ("crates:", Registry::Crates),
    ("cargo:", Registry::Crates),
    ("rust:", Registry::Crates),
];

pub fn detect_registry(spec: &str) -> DetectedRegistry {
    let trimmed = spec.trim();
    let lower = trimmed.to_lowercase();

    for &(prefix, registry) in REGISTRY_PREFIXES {
        if lower.starts_with(prefix) {
            return DetectedRegistry {
                registry,
                clean_spec: trimmed[prefix.len()..].to_string(),
            };
        }
    }

    DetectedRegistry {
        registry: Registry::Npm,
        clean_spec: trimmed.to_string(),
    }
}

pub fn parse_package_spec(spec: &str) -> PackageSpec {
    let detected = detect_registry(spec);

    let (name, version) = match detected.registry {
        Registry::Npm => npm::parse_npm_spec(&detected.clean_spec),
        Registry::PyPI => pypi::parse_pypi_spec(&detected.clean_spec),
        Registry::Crates => crates::parse_crates_spec(&detected.clean_spec),
    };

    PackageSpec {
        registry: detected.registry,
        name,
        version,
    }
}

pub fn resolve_package(spec: &PackageSpec) -> Result<ResolvedPackage, Box<dyn std::error::Error>> {
    match spec.registry {
        Registry::Npm => npm::resolve_npm_package(&spec.name, spec.version.as_deref()),
        Registry::PyPI => pypi::resolve_pypi_package(&spec.name, spec.version.as_deref()),
        Registry::Crates => crates::resolve_crate(&spec.name, spec.version.as_deref()),
    }
}

pub(crate) fn is_git_repo_url(url: &str) -> bool {
    url.contains("github.com") || url.contains("gitlab.com") || url.contains("bitbucket.org")
}

pub(crate) fn normalize_repo_url(url: &str) -> String {
    url.trim_end_matches('/')
        .trim_end_matches(".git")
        .split("/tree/")
        .next()
        .unwrap_or(url)
        .split("/blob/")
        .next()
        .unwrap_or(url)
        .to_string()
}

pub(crate) fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .user_agent("opensrc-cli (https://github.com/vercel-labs/opensrc)")
        .build()
        .expect("failed to build HTTP client")
}

pub(crate) fn github_token() -> Option<String> {
    std::env::var("GITHUB_TOKEN").ok().filter(|t| !t.is_empty())
}

pub(crate) fn gitlab_token() -> Option<String> {
    std::env::var("GITLAB_TOKEN").ok().filter(|t| !t.is_empty())
}

pub(crate) fn bitbucket_token() -> Option<String> {
    std::env::var("BITBUCKET_TOKEN")
        .ok()
        .filter(|t| !t.is_empty())
}

/// Rewrites an HTTPS clone URL to embed auth credentials when a token is available.
pub fn authenticated_clone_url(url: &str) -> String {
    if let Some(token) = github_token() {
        if url.contains("github.com") {
            return url.replacen(
                "https://github.com",
                &format!("https://x-access-token:{token}@github.com"),
                1,
            );
        }
    }
    if let Some(token) = gitlab_token() {
        if url.contains("gitlab.com") {
            return url.replacen(
                "https://gitlab.com",
                &format!("https://oauth2:{token}@gitlab.com"),
                1,
            );
        }
    }
    if let Some(token) = bitbucket_token() {
        if url.contains("bitbucket.org") {
            return url.replacen(
                "https://bitbucket.org",
                &format!("https://x-token-auth:{token}@bitbucket.org"),
                1,
            );
        }
    }
    url.to_string()
}

pub fn detect_input_type(spec: &str) -> &'static str {
    let trimmed = spec.trim();
    let lower = trimmed.to_lowercase();

    for &(prefix, _) in REGISTRY_PREFIXES {
        if lower.starts_with(prefix) {
            return "package";
        }
    }

    if repo::is_repo_spec(trimmed) {
        return "repo";
    }

    "package"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_git_repo_url_github() {
        assert!(is_git_repo_url("https://github.com/owner/repo"));
    }

    #[test]
    fn test_is_git_repo_url_gitlab() {
        assert!(is_git_repo_url("https://gitlab.com/owner/repo"));
    }

    #[test]
    fn test_is_git_repo_url_bitbucket() {
        assert!(is_git_repo_url("https://bitbucket.org/owner/repo"));
    }

    #[test]
    fn test_is_git_repo_url_other() {
        assert!(!is_git_repo_url("https://example.com/owner/repo"));
    }

    #[test]
    fn test_normalize_repo_url_trailing_slash() {
        assert_eq!(
            normalize_repo_url("https://github.com/owner/repo/"),
            "https://github.com/owner/repo"
        );
    }

    #[test]
    fn test_normalize_repo_url_dot_git() {
        assert_eq!(
            normalize_repo_url("https://github.com/owner/repo.git"),
            "https://github.com/owner/repo"
        );
    }

    #[test]
    fn test_normalize_repo_url_tree_ref() {
        assert_eq!(
            normalize_repo_url("https://github.com/owner/repo/tree/main/src"),
            "https://github.com/owner/repo"
        );
    }

    #[test]
    fn test_normalize_repo_url_blob_ref() {
        assert_eq!(
            normalize_repo_url("https://github.com/owner/repo/blob/main/file.rs"),
            "https://github.com/owner/repo"
        );
    }

    #[test]
    fn test_normalize_repo_url_clean() {
        assert_eq!(
            normalize_repo_url("https://github.com/owner/repo"),
            "https://github.com/owner/repo"
        );
    }
}
