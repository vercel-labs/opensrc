use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use super::registries::Registry;

const OPENSRC_DIR: &str = ".opensrc";
const REPOS_DIR: &str = "repos";
const SOURCES_FILE: &str = "sources.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageEntry {
    pub name: String,
    pub version: String,
    pub registry: Registry,
    pub path: String,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoEntry {
    pub name: String,
    pub version: String,
    pub path: String,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SourcesIndex {
    #[serde(rename = "updatedAt", skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub packages: Option<Vec<PackageEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repos: Option<Vec<RepoEntry>>,
}

pub fn get_opensrc_dir() -> PathBuf {
    if let Ok(home) = std::env::var("OPENSRC_HOME") {
        return PathBuf::from(home);
    }
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(OPENSRC_DIR)
}

pub fn get_repos_dir() -> PathBuf {
    get_opensrc_dir().join(REPOS_DIR)
}

/// Extract host/owner/repo from a git URL.
pub fn parse_repo_url(url: &str) -> Option<(String, String, String)> {
    let re_https =
        regex::Regex::new(r"https?://([^/]+)/([^/]+)/([^/]+)").unwrap();
    if let Some(caps) = re_https.captures(url) {
        let repo = caps[3].trim_end_matches(".git").to_string();
        return Some((caps[1].to_string(), caps[2].to_string(), repo));
    }

    let re_ssh = regex::Regex::new(r"git@([^:]+):([^/]+)/(.+)").unwrap();
    if let Some(caps) = re_ssh.captures(url) {
        let repo = caps[3].trim_end_matches(".git").to_string();
        return Some((caps[1].to_string(), caps[2].to_string(), repo));
    }

    None
}

pub fn get_repo_display_name(repo_url: &str) -> Option<String> {
    parse_repo_url(repo_url).map(|(host, owner, repo)| format!("{host}/{owner}/{repo}"))
}

pub fn get_repo_path(display_name: &str, version: &str) -> PathBuf {
    get_repos_dir().join(display_name).join(version)
}

pub fn get_repo_relative_path(display_name: &str, version: &str) -> String {
    format!("{REPOS_DIR}/{display_name}/{version}")
}

pub fn get_absolute_path(relative_path: &str) -> PathBuf {
    get_opensrc_dir().join(relative_path)
}

pub fn read_sources() -> SourcesIndex {
    let path = get_opensrc_dir().join(SOURCES_FILE);
    if !path.exists() {
        return SourcesIndex::default();
    }
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => SourcesIndex::default(),
    }
}

pub fn list_sources() -> (Vec<PackageEntry>, Vec<RepoEntry>) {
    let index = read_sources();
    (
        index.packages.unwrap_or_default(),
        index.repos.unwrap_or_default(),
    )
}

pub fn write_sources(packages: Vec<PackageEntry>, repos: Vec<RepoEntry>) -> std::io::Result<()> {
    let dir = get_opensrc_dir();
    let path = dir.join(SOURCES_FILE);

    if packages.is_empty() && repos.is_empty() {
        if path.exists() {
            fs::remove_file(&path)?;
        }
        return Ok(());
    }

    fs::create_dir_all(&dir)?;

    let index = SourcesIndex {
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
        packages: if packages.is_empty() {
            None
        } else {
            Some(packages)
        },
        repos: if repos.is_empty() { None } else { Some(repos) },
    };

    let json = serde_json::to_string_pretty(&index)?;
    fs::write(&path, json)?;
    Ok(())
}

pub fn get_package_info(name: &str, registry: Registry) -> Option<PackageEntry> {
    let (packages, _) = list_sources();
    packages
        .into_iter()
        .find(|p| p.name == name && p.registry == registry)
}

pub fn get_repo_info(display_name: &str) -> Option<RepoEntry> {
    let (_, repos) = list_sources();
    repos.into_iter().find(|r| r.name == display_name)
}

fn extract_repo_base_path(full_path: &str) -> &str {
    let parts: Vec<&str> = full_path.split('/').collect();
    if parts.len() >= 4 && parts[0] == "repos" {
        let end = parts[..4].iter().map(|s| s.len()).sum::<usize>() + 3;
        &full_path[..end]
    } else {
        full_path
    }
}

pub fn remove_package_source(
    name: &str,
    registry: Registry,
) -> Result<(bool, bool), Box<dyn std::error::Error>> {
    let (packages, _) = list_sources();
    let pkg = match packages.iter().find(|p| p.name == name && p.registry == registry) {
        Some(p) => p.clone(),
        None => return Ok((false, false)),
    };

    let pkg_repo_base = extract_repo_base_path(&pkg.path);

    let others_use_same = packages
        .iter()
        .any(|p| extract_repo_base_path(&p.path) == pkg_repo_base && !(p.name == name && p.registry == registry));

    let mut repo_removed = false;

    if !others_use_same {
        let parts: Vec<&str> = pkg.path.split('/').collect();
        if parts.len() >= 5 && parts[0] == "repos" {
            let versioned = parts[..5].join("/");
            let versioned_path = get_opensrc_dir().join(&versioned);
            if versioned_path.exists() {
                fs::remove_dir_all(&versioned_path)?;
                repo_removed = true;
                cleanup_empty_parent_dirs(&versioned);
            }
        }
    }

    Ok((true, repo_removed))
}

pub fn remove_repo_source(
    display_name: &str,
    version: Option<&str>,
) -> Result<bool, Box<dyn std::error::Error>> {
    if let Some(ver) = version {
        let path = get_repo_path(display_name, ver);
        if !path.exists() {
            return Ok(false);
        }
        fs::remove_dir_all(&path)?;
        cleanup_empty_parent_dirs(&get_repo_relative_path(display_name, ver));
        Ok(true)
    } else {
        let repo_dir = get_repos_dir().join(display_name);
        if !repo_dir.exists() {
            return Ok(false);
        }
        fs::remove_dir_all(&repo_dir)?;
        cleanup_empty_parent_dirs(&format!("{REPOS_DIR}/{display_name}"));
        Ok(true)
    }
}

fn cleanup_empty_parent_dirs(relative_path: &str) {
    let parts: Vec<&str> = relative_path.split('/').collect();
    if parts.len() < 2 {
        return;
    }

    let base = get_opensrc_dir();
    for i in (1..parts.len()).rev() {
        let dir = base.join(parts[..i].join("/"));
        if dir.exists() {
            if let Ok(entries) = fs::read_dir(&dir) {
                if entries.count() == 0 {
                    let _ = fs::remove_dir(&dir);
                } else {
                    break;
                }
            }
        }
    }
}

pub fn cleanup_empty_dirs(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                cleanup_empty_dirs(&entry.path());
            }
        }
    }
    if let Ok(entries) = fs::read_dir(dir) {
        if entries.count() == 0 {
            let _ = fs::remove_dir(dir);
        }
    }
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_repo_url_https() {
        let result = parse_repo_url("https://github.com/colinhacks/zod").unwrap();
        assert_eq!(result, ("github.com".into(), "colinhacks".into(), "zod".into()));
    }

    #[test]
    fn test_parse_repo_url_ssh() {
        let result = parse_repo_url("git@github.com:colinhacks/zod.git").unwrap();
        assert_eq!(result, ("github.com".into(), "colinhacks".into(), "zod".into()));
    }

    #[test]
    fn test_get_repo_display_name() {
        assert_eq!(
            get_repo_display_name("https://github.com/colinhacks/zod"),
            Some("github.com/colinhacks/zod".into())
        );
    }

    #[test]
    fn test_extract_repo_base_path() {
        assert_eq!(
            extract_repo_base_path("repos/github.com/owner/repo/1.0.0/packages/sub"),
            "repos/github.com/owner/repo"
        );
        assert_eq!(extract_repo_base_path("other"), "other");
    }
}
