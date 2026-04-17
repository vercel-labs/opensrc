use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

#[cfg(test)]
pub static TEST_ENV_LOCK: LazyLock<std::sync::Mutex<()>> =
    LazyLock::new(|| std::sync::Mutex::new(()));

use serde::{Deserialize, Serialize};

use super::registries::Registry;

static RE_HTTPS_REPO: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"https?://([^/]+)/([^/]+)/([^/]+)").unwrap());
static RE_SSH_REPO: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"git@([^:]+):([^/]+)/(.+)").unwrap());

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
    match dirs::home_dir() {
        Some(h) => h.join(OPENSRC_DIR),
        None => {
            eprintln!("Error: Could not determine home directory. Set the OPENSRC_HOME environment variable.");
            std::process::exit(1);
        }
    }
}

pub fn get_repos_dir() -> PathBuf {
    get_opensrc_dir().join(REPOS_DIR)
}

/// Extract host/owner/repo from a git URL.
pub fn parse_repo_url(url: &str) -> Option<(String, String, String)> {
    if let Some(caps) = RE_HTTPS_REPO.captures(url) {
        let repo = caps[3].trim_end_matches(".git").to_string();
        return Some((caps[1].to_string(), caps[2].to_string(), repo));
    }

    if let Some(caps) = RE_SSH_REPO.captures(url) {
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
        Ok(content) => match serde_json::from_str(&content) {
            Ok(index) => index,
            Err(e) => {
                let bak = path.with_extension("json.bak");
                eprintln!(
                    "Warning: {} is corrupt ({}), backing up to {}",
                    path.display(),
                    e,
                    bak.display()
                );
                let _ = fs::copy(&path, &bak);
                SourcesIndex::default()
            }
        },
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

/// Atomic write: serializes to a temp file then renames, so concurrent
/// readers never see a partially-written sources.json.
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
    let tmp = dir.join(".sources.json.tmp");
    fs::write(&tmp, json)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn get_package_info(
    name: &str,
    registry: Registry,
    version: Option<&str>,
) -> Option<PackageEntry> {
    let (packages, _) = list_sources();
    packages.into_iter().find(|p| {
        p.name == name
            && p.registry == registry
            && version.is_none_or(|expected| p.version == expected)
    })
}

pub fn upsert_package_entry(packages: &mut Vec<PackageEntry>, entry: PackageEntry) {
    if let Some(idx) = packages.iter().position(|p| {
        p.name == entry.name && p.registry == entry.registry && p.version == entry.version
    }) {
        packages[idx] = entry;
    } else {
        packages.push(entry);
    }
}

pub fn get_repo_info(display_name: &str) -> Option<RepoEntry> {
    let (_, repos) = list_sources();
    repos.into_iter().find(|r| r.name == display_name)
}

pub fn extract_repo_base_path(full_path: &str) -> String {
    let parts: Vec<&str> = full_path.split('/').collect();
    if parts.len() >= 4 && parts[0] == "repos" {
        parts[..4].join("/")
    } else {
        full_path.to_string()
    }
}

pub fn extract_versioned_repo_path(full_path: &str) -> String {
    let parts: Vec<&str> = full_path.split('/').collect();
    if parts.len() >= 5 && parts[0] == "repos" {
        parts[..5].join("/")
    } else {
        full_path.to_string()
    }
}

#[derive(Debug, Default)]
pub struct RemovePackageSourceResult {
    pub removed: Vec<PackageEntry>,
    pub repo_removed: bool,
}

pub fn remove_package_source(
    name: &str,
    registry: Registry,
    version: Option<&str>,
) -> Result<RemovePackageSourceResult, Box<dyn std::error::Error>> {
    let (packages, repos) = list_sources();
    let removed: Vec<PackageEntry> = packages
        .iter()
        .filter(|p| {
            p.name == name
                && p.registry == registry
                && version.is_none_or(|expected| p.version == expected)
        })
        .cloned()
        .collect();

    if removed.is_empty() {
        return Ok(RemovePackageSourceResult::default());
    }

    let remaining: Vec<&PackageEntry> = packages
        .iter()
        .filter(|candidate| {
            !removed.iter().any(|target| {
                candidate.name == target.name
                    && candidate.version == target.version
                    && candidate.registry == target.registry
                    && candidate.path == target.path
            })
        })
        .collect();

    let mut repo_removed = false;
    let mut cleaned_paths = HashSet::new();

    for pkg in &removed {
        let versioned_path = extract_versioned_repo_path(&pkg.path);
        if !cleaned_paths.insert(versioned_path.clone()) {
            continue;
        }

        let still_used = remaining
            .iter()
            .any(|entry| extract_versioned_repo_path(&entry.path) == versioned_path)
            || repos
                .iter()
                .any(|entry| extract_versioned_repo_path(&entry.path) == versioned_path);
        if still_used {
            continue;
        }

        let absolute_path = get_opensrc_dir().join(&versioned_path);
        if absolute_path.exists() {
            fs::remove_dir_all(&absolute_path)?;
            repo_removed = true;
            cleanup_empty_parent_dirs(&versioned_path);
        }
    }

    Ok(RemovePackageSourceResult {
        removed,
        repo_removed,
    })
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
        assert_eq!(
            result,
            ("github.com".into(), "colinhacks".into(), "zod".into())
        );
    }

    #[test]
    fn test_parse_repo_url_ssh() {
        let result = parse_repo_url("git@github.com:colinhacks/zod.git").unwrap();
        assert_eq!(
            result,
            ("github.com".into(), "colinhacks".into(), "zod".into())
        );
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
            "repos/github.com/owner/repo".to_string()
        );
        assert_eq!(extract_repo_base_path("other"), "other".to_string());
    }

    fn package_entry(name: &str, version: &str, registry: Registry, path: &str) -> PackageEntry {
        PackageEntry {
            name: name.to_string(),
            version: version.to_string(),
            registry,
            path: path.to_string(),
            fetched_at: now_iso(),
        }
    }

    #[test]
    fn test_upsert_package_entry_preserves_other_versions() {
        let mut packages = vec![package_entry(
            "zod",
            "3.25.76",
            Registry::Npm,
            "repos/github.com/colinhacks/zod/3.25.76",
        )];

        upsert_package_entry(
            &mut packages,
            package_entry(
                "zod",
                "4.3.6",
                Registry::Npm,
                "repos/github.com/colinhacks/zod/4.3.6",
            ),
        );

        assert_eq!(packages.len(), 2);
        assert!(packages.iter().any(|pkg| pkg.version == "3.25.76"));
        assert!(packages.iter().any(|pkg| pkg.version == "4.3.6"));
    }

    #[test]
    fn test_upsert_package_entry_replaces_same_version() {
        let mut packages = vec![package_entry(
            "zod",
            "4.3.6",
            Registry::Npm,
            "repos/github.com/colinhacks/zod/4.3.6",
        )];

        upsert_package_entry(
            &mut packages,
            package_entry(
                "zod",
                "4.3.6",
                Registry::Npm,
                "repos/github.com/colinhacks/zod/4.3.6/packages/zod",
            ),
        );

        assert_eq!(packages.len(), 1);
        assert_eq!(
            packages[0].path,
            "repos/github.com/colinhacks/zod/4.3.6/packages/zod"
        );
    }

    #[test]
    fn test_read_sources_corrupt_json_creates_backup() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let tmp = std::env::temp_dir().join("opensrc_test_corrupt");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let sources_path = tmp.join(SOURCES_FILE);
        let backup_path = tmp.join("sources.json.bak");
        fs::write(&sources_path, "NOT VALID JSON {{{").unwrap();

        std::env::set_var("OPENSRC_HOME", tmp.to_str().unwrap());
        let index = read_sources();
        std::env::remove_var("OPENSRC_HOME");

        assert!(index.packages.is_none());
        assert!(index.repos.is_none());
        assert!(backup_path.exists(), "backup file should be created");
        let bak_content = fs::read_to_string(&backup_path).unwrap();
        assert_eq!(bak_content, "NOT VALID JSON {{{");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_remove_package_source_keeps_shared_version_directory_in_monorepo() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let tmp = std::env::temp_dir().join("opensrc_test_shared_version_directory");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        std::env::set_var("OPENSRC_HOME", tmp.to_str().unwrap());
        write_sources(
            vec![
                package_entry(
                    "pkg-a",
                    "1.0.0",
                    Registry::Npm,
                    "repos/github.com/example/monorepo/1.0.0/packages/a",
                ),
                package_entry(
                    "pkg-b",
                    "1.0.0",
                    Registry::Npm,
                    "repos/github.com/example/monorepo/1.0.0/packages/b",
                ),
            ],
            vec![],
        )
        .unwrap();

        let versioned_repo_path = get_absolute_path("repos/github.com/example/monorepo/1.0.0");
        fs::create_dir_all(&versioned_repo_path).unwrap();

        let result = remove_package_source("pkg-a", Registry::Npm, Some("1.0.0")).unwrap();
        assert_eq!(result.removed.len(), 1);
        assert!(!result.repo_removed);
        assert!(
            versioned_repo_path.exists(),
            "shared version directory should stay while another package entry still points to it"
        );

        std::env::remove_var("OPENSRC_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_remove_package_source_keeps_directory_when_repo_entry_still_uses_it() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let tmp = std::env::temp_dir().join("opensrc_test_package_repo_shared_directory");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        std::env::set_var("OPENSRC_HOME", tmp.to_str().unwrap());
        write_sources(
            vec![package_entry(
                "pkg-a",
                "1.0.0",
                Registry::Npm,
                "repos/github.com/example/monorepo/1.0.0/packages/a",
            )],
            vec![RepoEntry {
                name: "github.com/example/monorepo".to_string(),
                version: "1.0.0".to_string(),
                path: "repos/github.com/example/monorepo/1.0.0".to_string(),
                fetched_at: now_iso(),
            }],
        )
        .unwrap();

        let versioned_repo_path = get_absolute_path("repos/github.com/example/monorepo/1.0.0");
        fs::create_dir_all(&versioned_repo_path).unwrap();

        let result = remove_package_source("pkg-a", Registry::Npm, Some("1.0.0")).unwrap();
        assert_eq!(result.removed.len(), 1);
        assert!(!result.repo_removed);
        assert!(
            versioned_repo_path.exists(),
            "package removal should not delete a checkout still referenced by a repo cache entry"
        );

        std::env::remove_var("OPENSRC_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_get_package_info_uses_exact_version() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let tmp = std::env::temp_dir().join("opensrc_test_exact_version_lookup");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        std::env::set_var("OPENSRC_HOME", tmp.to_str().unwrap());
        write_sources(
            vec![
                package_entry(
                    "zod",
                    "3.25.76",
                    Registry::Npm,
                    "repos/github.com/colinhacks/zod/3.25.76",
                ),
                package_entry(
                    "zod",
                    "4.3.6",
                    Registry::Npm,
                    "repos/github.com/colinhacks/zod/4.3.6",
                ),
            ],
            vec![],
        )
        .unwrap();

        let package = get_package_info("zod", Registry::Npm, Some("4.3.6")).unwrap();
        assert_eq!(package.version, "4.3.6");
        assert_eq!(package.path, "repos/github.com/colinhacks/zod/4.3.6");

        std::env::remove_var("OPENSRC_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_read_sources_valid_json() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        let tmp = std::env::temp_dir().join("opensrc_test_valid");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let sources_path = tmp.join(SOURCES_FILE);
        fs::write(
            &sources_path,
            r#"{"updatedAt":"2024-01-01T00:00:00Z","packages":[{"name":"zod","version":"3.22.0","registry":"npm","path":"repos/github.com/colinhacks/zod/v3.22.0","fetchedAt":"2024-01-01T00:00:00Z"}]}"#,
        )
        .unwrap();

        std::env::set_var("OPENSRC_HOME", tmp.to_str().unwrap());
        let index = read_sources();
        std::env::remove_var("OPENSRC_HOME");

        assert!(index.packages.is_some());
        assert_eq!(index.packages.unwrap().len(), 1);

        let _ = fs::remove_dir_all(&tmp);
    }
}
