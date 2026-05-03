use std::collections::HashMap;
use std::sync::LazyLock;

use serde::Deserialize;

use crate::core::error::{Error, Result};

use super::{Registry, ResolvedPackage};

static RE_PYPI_VERSION: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^([^=<>!~]+)==(.+)$").unwrap());

const PYPI_API: &str = "https://pypi.org/pypi";

#[derive(Deserialize)]
struct PyPIInfo {
    version: String,
    home_page: Option<String>,
    project_urls: Option<HashMap<String, String>>,
}

#[derive(Deserialize)]
struct PyPIResponse {
    info: PyPIInfo,
}

pub fn parse_pypi_spec(spec: &str) -> (String, Option<String>) {
    if let Some(caps) = RE_PYPI_VERSION.captures(spec) {
        return (caps[1].trim().to_string(), Some(caps[2].trim().to_string()));
    }

    // requests@2.31.0
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

fn fetch_pypi_info(name: &str, version: Option<&str>) -> Result<PyPIResponse> {
    let url = match version {
        Some(v) => format!("{PYPI_API}/{name}/{v}/json"),
        None => format!("{PYPI_API}/{name}/json"),
    };

    let client = super::http_client();
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .send()?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(Error::PackageNotFound {
            name: name.to_string(),
            registry: "PyPI".to_string(),
        });
    }
    if !resp.status().is_success() {
        return Err(Error::HttpStatus {
            context: "package info".to_string(),
            status: resp.status().to_string(),
        });
    }

    Ok(resp.json()?)
}

use super::{is_git_repo_url, normalize_repo_url};

fn extract_repo_url(info: &PyPIInfo) -> Option<String> {
    let repo_keys = [
        "Source",
        "Source Code",
        "Repository",
        "GitHub",
        "Code",
        "Homepage",
    ];

    if let Some(urls) = &info.project_urls {
        for key in &repo_keys {
            if let Some(url) = urls.get(*key) {
                if is_git_repo_url(url) {
                    return Some(normalize_repo_url(url));
                }
            }
        }

        if let Some(hp) = &info.home_page {
            if is_git_repo_url(hp) {
                return Some(normalize_repo_url(hp));
            }
        }

        for url in urls.values() {
            if is_git_repo_url(url) {
                return Some(normalize_repo_url(url));
            }
        }
    }

    if let Some(hp) = &info.home_page {
        if is_git_repo_url(hp) {
            return Some(normalize_repo_url(hp));
        }
    }

    None
}

pub fn resolve_pypi_package(name: &str, version: Option<&str>) -> Result<ResolvedPackage> {
    let info = fetch_pypi_info(name, version)?;
    let resolved_version = info.info.version.clone();

    let repo_url = extract_repo_url(&info.info).ok_or_else(|| {
        Error::NoRepoUrl(format!(
            "No repository URL found for \"{name}@{resolved_version}\". \
             This package may not have its source published."
        ))
    })?;

    let git_tag = format!("v{resolved_version}");

    Ok(ResolvedPackage {
        registry: Registry::PyPI,
        name: name.to_string(),
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
    fn test_parse_pypi_spec_simple() {
        let (name, version) = parse_pypi_spec("requests");
        assert_eq!(name, "requests");
        assert_eq!(version, None);
    }

    #[test]
    fn test_parse_pypi_spec_double_eq() {
        let (name, version) = parse_pypi_spec("requests==2.31.0");
        assert_eq!(name, "requests");
        assert_eq!(version, Some("2.31.0".into()));
    }

    #[test]
    fn test_parse_pypi_spec_at() {
        let (name, version) = parse_pypi_spec("requests@2.31.0");
        assert_eq!(name, "requests");
        assert_eq!(version, Some("2.31.0".into()));
    }
}
