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

pub fn resolve_package(spec: &PackageSpec) -> super::error::Result<ResolvedPackage> {
    match spec.registry {
        Registry::Npm => npm::resolve_npm_package(&spec.name, spec.version.as_deref()),
        Registry::PyPI => pypi::resolve_pypi_package(&spec.name, spec.version.as_deref()),
        Registry::Crates => crates::resolve_crate(&spec.name, spec.version.as_deref()),
    }
}

const GITHUB_HOST: &str = "github.com";
const GITLAB_HOST: &str = "gitlab.com";
const BITBUCKET_HOST: &str = "bitbucket.org";

pub(crate) fn is_git_repo_url(url: &str) -> bool {
    [GITHUB_HOST, GITLAB_HOST, BITBUCKET_HOST]
        .iter()
        .any(|supported| repo_host_matches(url, supported))
}

fn repo_host_matches(url: &str, expected_host: &str) -> bool {
    if let Ok(parsed) = url::Url::parse(url) {
        return parsed
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case(expected_host));
    }

    let Some(rest) = url.strip_prefix("git@") else {
        return false;
    };
    let Some((host, _)) = rest.split_once(':') else {
        return false;
    };

    host.eq_ignore_ascii_case(expected_host)
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
    let github = github_token();
    let gitlab = gitlab_token();
    let bitbucket = bitbucket_token();

    authenticated_clone_url_with_tokens(
        url,
        github.as_deref(),
        gitlab.as_deref(),
        bitbucket.as_deref(),
    )
}

fn authenticated_clone_url_with_tokens(
    url: &str,
    github: Option<&str>,
    gitlab: Option<&str>,
    bitbucket: Option<&str>,
) -> String {
    if let Some(token) = github {
        if let Some(authenticated) =
            authenticated_url_for_host(url, GITHUB_HOST, "x-access-token", token)
        {
            return authenticated;
        }
    }
    if let Some(token) = gitlab {
        if let Some(authenticated) = authenticated_url_for_host(url, GITLAB_HOST, "oauth2", token) {
            return authenticated;
        }
    }
    if let Some(token) = bitbucket {
        if let Some(authenticated) =
            authenticated_url_for_host(url, BITBUCKET_HOST, "x-token-auth", token)
        {
            return authenticated;
        }
    }
    url.to_string()
}

fn authenticated_url_for_host(
    url: &str,
    expected_host: &str,
    username: &str,
    token: &str,
) -> Option<String> {
    let mut parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?;
    if !host.eq_ignore_ascii_case(expected_host) {
        return None;
    }

    parsed.set_username(username).ok()?;
    parsed.set_password(Some(token)).ok()?;
    Some(parsed.to_string())
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
    fn test_is_git_repo_url_ssh() {
        assert!(is_git_repo_url("git@github.com:owner/repo.git"));
    }

    #[test]
    fn test_is_git_repo_url_other() {
        assert!(!is_git_repo_url("https://example.com/owner/repo"));
    }

    #[test]
    fn test_is_git_repo_url_rejects_host_prefix_confusion() {
        assert!(!is_git_repo_url(
            "https://github.com.attacker.example/owner/repo"
        ));
        assert!(!is_git_repo_url(
            "https://gitlab.com.attacker.example/owner/repo"
        ));
        assert!(!is_git_repo_url(
            "https://bitbucket.org.attacker.example/owner/repo"
        ));
        assert!(!is_git_repo_url(
            "git@github.com.attacker.example:owner/repo.git"
        ));
    }

    #[test]
    fn test_is_git_repo_url_rejects_host_in_path() {
        assert!(!is_git_repo_url(
            "https://example.com/github.com/owner/repo"
        ));
    }

    #[test]
    fn test_authenticated_clone_url_github_exact_host() {
        assert_eq!(
            authenticated_clone_url_with_tokens(
                "https://github.com/owner/repo",
                Some("TOKEN"),
                None,
                None
            ),
            "https://x-access-token:TOKEN@github.com/owner/repo"
        );
    }

    #[test]
    fn test_authenticated_clone_url_gitlab_exact_host() {
        assert_eq!(
            authenticated_clone_url_with_tokens(
                "https://gitlab.com/owner/repo",
                None,
                Some("TOKEN"),
                None
            ),
            "https://oauth2:TOKEN@gitlab.com/owner/repo"
        );
    }

    #[test]
    fn test_authenticated_clone_url_bitbucket_exact_host() {
        assert_eq!(
            authenticated_clone_url_with_tokens(
                "https://bitbucket.org/owner/repo",
                None,
                None,
                Some("TOKEN")
            ),
            "https://x-token-auth:TOKEN@bitbucket.org/owner/repo"
        );
    }

    #[test]
    fn test_authenticated_clone_url_rejects_host_prefix_confusion() {
        assert_eq!(
            authenticated_clone_url_with_tokens(
                "https://github.com.attacker.example/owner/repo",
                Some("TOKEN"),
                None,
                None
            ),
            "https://github.com.attacker.example/owner/repo"
        );
        assert_eq!(
            authenticated_clone_url_with_tokens(
                "https://gitlab.com.attacker.example/owner/repo",
                None,
                Some("TOKEN"),
                None
            ),
            "https://gitlab.com.attacker.example/owner/repo"
        );
        assert_eq!(
            authenticated_clone_url_with_tokens(
                "https://bitbucket.org.attacker.example/owner/repo",
                None,
                None,
                Some("TOKEN")
            ),
            "https://bitbucket.org.attacker.example/owner/repo"
        );
    }

    #[test]
    fn test_authenticated_clone_url_rejects_host_in_path() {
        assert_eq!(
            authenticated_clone_url_with_tokens(
                "https://example.com/github.com/owner/repo",
                Some("TOKEN"),
                None,
                None
            ),
            "https://example.com/github.com/owner/repo"
        );
    }

    #[test]
    fn test_authenticated_clone_url_only_rewrites_https() {
        assert_eq!(
            authenticated_clone_url_with_tokens(
                "http://github.com/owner/repo",
                Some("TOKEN"),
                None,
                None
            ),
            "http://github.com/owner/repo"
        );
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
