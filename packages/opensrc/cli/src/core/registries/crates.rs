use serde::Deserialize;

use crate::core::error::{Error, Result};

use super::{Registry, ResolvedPackage};

const CRATES_API: &str = "https://crates.io/api/v1";

#[derive(Deserialize)]
struct CrateInfo {
    max_version: String,
    repository: Option<String>,
    homepage: Option<String>,
}

#[derive(Deserialize)]
struct CrateResponse {
    #[serde(rename = "crate")]
    krate: CrateInfo,
}

// Only used to validate the version exists
#[derive(Deserialize)]
#[allow(dead_code)]
struct CrateVersionResponse {
    version: serde_json::Value,
}

pub fn parse_crates_spec(spec: &str) -> (String, Option<String>) {
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

fn fetch_crate_info(name: &str) -> Result<CrateResponse> {
    let url = format!("{CRATES_API}/crates/{name}");

    let client = super::http_client();
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .send()?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(Error::PackageNotFound {
            name: name.to_string(),
            registry: "crates.io".to_string(),
        });
    }
    if !resp.status().is_success() {
        return Err(Error::HttpStatus {
            context: "crate info".to_string(),
            status: resp.status().to_string(),
        });
    }

    Ok(resp.json()?)
}

fn verify_crate_version(name: &str, version: &str) -> Result<()> {
    let url = format!("{CRATES_API}/crates/{name}/{version}");

    let client = super::http_client();
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .send()?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(Error::VersionNotFound(format!(
            "Version \"{version}\" not found for crate \"{name}\""
        )));
    }
    if !resp.status().is_success() {
        return Err(Error::HttpStatus {
            context: "crate version info".to_string(),
            status: resp.status().to_string(),
        });
    }

    let _: CrateVersionResponse = resp.json()?;
    Ok(())
}

use super::{is_git_repo_url, normalize_repo_url};

fn extract_repo_url(krate: &CrateInfo) -> Option<String> {
    if let Some(ref repo) = krate.repository {
        if is_git_repo_url(repo) {
            return Some(normalize_repo_url(repo));
        }
    }
    if let Some(ref hp) = krate.homepage {
        if is_git_repo_url(hp) {
            return Some(normalize_repo_url(hp));
        }
    }
    None
}

pub fn resolve_crate(name: &str, version: Option<&str>) -> Result<ResolvedPackage> {
    let info = fetch_crate_info(name)?;

    let resolved_version = match version {
        Some(v) => {
            verify_crate_version(name, v)?;
            v.to_string()
        }
        None => info.krate.max_version.clone(),
    };

    let repo_url = extract_repo_url(&info.krate).ok_or_else(|| {
        Error::NoRepoUrl(format!(
            "No repository URL found for \"{name}@{resolved_version}\". \
             This crate may not have its source published."
        ))
    })?;

    let git_tag = format!("v{resolved_version}");

    Ok(ResolvedPackage {
        registry: Registry::Crates,
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
    fn test_parse_crates_spec_simple() {
        let (name, version) = parse_crates_spec("serde");
        assert_eq!(name, "serde");
        assert_eq!(version, None);
    }

    #[test]
    fn test_parse_crates_spec_with_version() {
        let (name, version) = parse_crates_spec("serde@1.0.200");
        assert_eq!(name, "serde");
        assert_eq!(version, Some("1.0.200".into()));
    }
}
