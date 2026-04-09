use super::{Registry, ResolvedPackage};
use serde::Deserialize;
use std::collections::HashMap;

const NPM_REGISTRY: &str = "https://registry.npmjs.org";

#[derive(Deserialize)]
struct NpmRepository {
    url: Option<String>,
    directory: Option<String>,
}

#[derive(Deserialize)]
struct NpmVersionInfo {
    repository: Option<NpmRepository>,
}

#[derive(Deserialize)]
struct NpmResponse {
    #[serde(rename = "dist-tags")]
    dist_tags: HashMap<String, String>,
    versions: HashMap<String, NpmVersionInfo>,
    repository: Option<NpmRepository>,
}

pub fn parse_npm_spec(spec: &str) -> (String, Option<String>) {
    // Scoped packages: @scope/pkg@version
    if spec.starts_with('@') {
        let re = regex::Regex::new(r"^(@[^/]+/[^@]+)(?:@(.+))?$").unwrap();
        if let Some(caps) = re.captures(spec) {
            let name = caps[1].to_string();
            let version = caps.get(2).map(|m| m.as_str().to_string());
            return (name, version);
        }
    }

    // Regular packages: zod@3.22.0
    if let Some(at_idx) = spec.rfind('@') {
        if at_idx > 0 {
            return (
                spec[..at_idx].to_string(),
                Some(spec[at_idx + 1..].to_string()),
            );
        }
    }

    (spec.to_string(), None)
}

fn fetch_npm_info(name: &str) -> Result<NpmResponse, Box<dyn std::error::Error>> {
    let encoded = name.replace('@', "%40").replace("%40", "@");
    let url = format!("{NPM_REGISTRY}/{encoded}");

    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .send()?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("Package \"{name}\" not found on npm").into());
    }
    if !resp.status().is_success() {
        return Err(format!("Failed to fetch package info: {}", resp.status()).into());
    }

    Ok(resp.json()?)
}

fn extract_repo_url(
    top_repo: Option<&NpmRepository>,
    version_repo: Option<&NpmRepository>,
) -> Option<(String, Option<String>)> {
    let repo = version_repo.or(top_repo)?;
    let raw = repo.url.as_deref()?;

    let url = raw
        .trim_start_matches("git+")
        .replace("git://", "https://")
        .replace("git+ssh://git@", "https://")
        .replace("ssh://git@", "https://")
        .trim_end_matches(".git")
        .to_string();

    let url = if let Some(suffix) = url.strip_prefix("github:") {
        format!("https://github.com/{suffix}")
    } else {
        url
    };

    Some((url, repo.directory.clone()))
}

pub fn resolve_npm_package(
    name: &str,
    version: Option<&str>,
) -> Result<ResolvedPackage, Box<dyn std::error::Error>> {
    let info = fetch_npm_info(name)?;

    let resolved_version = match version {
        Some(v) => v.to_string(),
        None => info
            .dist_tags
            .get("latest")
            .ok_or_else(|| format!("No latest version found for \"{name}\""))?
            .clone(),
    };

    if !info.versions.contains_key(&resolved_version) {
        let recent: Vec<&String> = info.versions.keys().collect::<Vec<_>>();
        let tail: Vec<&&String> = recent.iter().rev().take(5).collect();
        let versions_str = tail
            .iter()
            .map(|v| v.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Version \"{resolved_version}\" not found for \"{name}\". Recent versions: {versions_str}"
        )
        .into());
    }

    let version_info = info.versions.get(&resolved_version);
    let (repo_url, repo_directory) = extract_repo_url(
        info.repository.as_ref(),
        version_info.and_then(|v| v.repository.as_ref()),
    )
    .ok_or_else(|| {
        format!(
            "No repository URL found for \"{name}@{resolved_version}\". \
             This package may not have its source published."
        )
    })?;

    let git_tag = format!("v{resolved_version}");

    Ok(ResolvedPackage {
        registry: Registry::Npm,
        name: name.to_string(),
        version: resolved_version,
        repo_url,
        repo_directory,
        git_tag,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_npm_spec_simple() {
        let (name, version) = parse_npm_spec("zod");
        assert_eq!(name, "zod");
        assert_eq!(version, None);
    }

    #[test]
    fn test_parse_npm_spec_with_version() {
        let (name, version) = parse_npm_spec("zod@3.22.0");
        assert_eq!(name, "zod");
        assert_eq!(version, Some("3.22.0".into()));
    }

    #[test]
    fn test_parse_npm_spec_scoped() {
        let (name, version) = parse_npm_spec("@babel/core@7.0.0");
        assert_eq!(name, "@babel/core");
        assert_eq!(version, Some("7.0.0".into()));
    }

    #[test]
    fn test_parse_npm_spec_scoped_no_version() {
        let (name, version) = parse_npm_spec("@babel/core");
        assert_eq!(name, "@babel/core");
        assert_eq!(version, None);
    }
}
