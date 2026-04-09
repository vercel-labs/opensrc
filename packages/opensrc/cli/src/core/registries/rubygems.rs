use serde::Deserialize;

use super::{is_git_repo_url, normalize_repo_url, Registry, ResolvedPackage};

const RUBYGEMS_API: &str = "https://rubygems.org/api/v1";

#[derive(Deserialize)]
struct GemInfo {
    version: String,
    source_code_uri: Option<String>,
    homepage_uri: Option<String>,
}

pub fn parse_rubygems_spec(spec: &str) -> (String, Option<String>) {
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

fn fetch_gem_info(
    name: &str,
    version: Option<&str>,
) -> Result<GemInfo, Box<dyn std::error::Error>> {
    let url = match version {
        Some(v) => format!("https://rubygems.org/api/v2/rubygems/{name}/versions/{v}.json"),
        None => format!("{RUBYGEMS_API}/gems/{name}.json"),
    };

    let client = super::http_client();
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .send()?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(format!("Gem \"{name}\" not found on RubyGems").into());
    }
    if !resp.status().is_success() {
        return Err(format!("Failed to fetch gem info: {}", resp.status()).into());
    }

    Ok(resp.json()?)
}

fn extract_repo_url(info: &GemInfo) -> Option<String> {
    // Prefer source_code_uri
    if let Some(ref url) = info.source_code_uri {
        if is_git_repo_url(url) {
            return Some(normalize_repo_url(url));
        }
    }

    // Fall back to homepage_uri
    if let Some(ref url) = info.homepage_uri {
        if is_git_repo_url(url) {
            return Some(normalize_repo_url(url));
        }
    }

    None
}

pub fn resolve_rubygem(
    name: &str,
    version: Option<&str>,
) -> Result<ResolvedPackage, Box<dyn std::error::Error>> {
    let info = fetch_gem_info(name, version)?;
    let resolved_version = info.version.clone();

    let repo_url = extract_repo_url(&info).ok_or_else(|| {
        format!(
            "No repository URL found for \"{name}@{resolved_version}\". \
             This gem may not have its source code published."
        )
    })?;

    let git_tag = format!("v{resolved_version}");

    Ok(ResolvedPackage {
        registry: Registry::RubyGems,
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
    fn test_parse_rubygems_spec_simple() {
        let (name, version) = parse_rubygems_spec("rails");
        assert_eq!(name, "rails");
        assert_eq!(version, None);
    }

    #[test]
    fn test_parse_rubygems_spec_with_version() {
        let (name, version) = parse_rubygems_spec("rails@8.1.3");
        assert_eq!(name, "rails");
        assert_eq!(version, Some("8.1.3".into()));
    }

    #[test]
    fn test_parse_rubygems_spec_hyphenated() {
        let (name, version) = parse_rubygems_spec("ruby-openai@7.0.0");
        assert_eq!(name, "ruby-openai");
        assert_eq!(version, Some("7.0.0".into()));
    }
}
