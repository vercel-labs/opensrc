use std::fs;
use std::path::Path;
use std::process::Command;

use super::cache::{get_repo_display_name, get_repo_path, get_repo_relative_path};
use super::registries::repo::ResolvedRepo;
use super::registries::{Registry, ResolvedPackage};

#[derive(Debug)]
pub struct FetchResult {
    pub package: String,
    pub version: String,
    pub path: String,
    pub success: bool,
    pub error: Option<String>,
    pub registry: Option<Registry>,
}

struct CloneResult {
    success: bool,
    error: Option<String>,
}

fn clone_at_tag(repo_url: &str, target: &Path, version: &str) -> CloneResult {
    let tags = [format!("v{version}"), version.to_string()];

    for tag in &tags {
        let status = Command::new("git")
            .args([
                "clone",
                "--depth",
                "1",
                "--branch",
                tag,
                "--single-branch",
                repo_url,
                &target.to_string_lossy(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        match status {
            Ok(s) if s.success() => {
                return CloneResult {
                    success: true,
                    error: None,
                }
            }
            _ => {
                let _ = fs::remove_dir_all(target);
                continue;
            }
        }
    }

    // Fallback: clone default branch
    let status = Command::new("git")
        .args(["clone", "--depth", "1", repo_url, &target.to_string_lossy()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match status {
        Ok(s) if s.success() => CloneResult {
            success: true,
            error: Some(format!(
                "Could not find tag for version {version}, cloned default branch instead"
            )),
        },
        _ => CloneResult {
            success: false,
            error: Some("Failed to clone repository".into()),
        },
    }
}

fn clone_at_ref(repo_url: &str, target: &Path, git_ref: &str) -> CloneResult {
    let status = Command::new("git")
        .args([
            "clone",
            "--depth",
            "1",
            "--branch",
            git_ref,
            "--single-branch",
            repo_url,
            &target.to_string_lossy(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    if let Ok(s) = status {
        if s.success() {
            return CloneResult {
                success: true,
                error: None,
            };
        }
    }

    let _ = fs::remove_dir_all(target);

    // Fallback: clone default branch
    let status = Command::new("git")
        .args(["clone", "--depth", "1", repo_url, &target.to_string_lossy()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match status {
        Ok(s) if s.success() => CloneResult {
            success: true,
            error: Some(format!(
                "Could not find ref \"{git_ref}\", cloned default branch instead"
            )),
        },
        _ => CloneResult {
            success: false,
            error: Some("Failed to clone repository".into()),
        },
    }
}

fn remove_git_dir(repo_path: &Path) {
    let git_dir = repo_path.join(".git");
    if git_dir.exists() {
        let _ = fs::remove_dir_all(&git_dir);
    }
}

pub fn fetch_source(resolved: &ResolvedPackage) -> FetchResult {
    let display_name = match get_repo_display_name(&resolved.repo_url) {
        Some(n) => n,
        None => {
            return FetchResult {
                package: resolved.name.clone(),
                version: resolved.version.clone(),
                path: String::new(),
                success: false,
                error: Some(format!(
                    "Could not parse repository URL: {}",
                    resolved.repo_url
                )),
                registry: Some(resolved.registry),
            }
        }
    };

    let repo_path = get_repo_path(&display_name, &resolved.version);

    if repo_path.exists() {
        let mut rel = get_repo_relative_path(&display_name, &resolved.version);
        if let Some(ref dir) = resolved.repo_directory {
            rel = format!("{rel}/{dir}");
        }
        return FetchResult {
            package: resolved.name.clone(),
            version: resolved.version.clone(),
            path: rel,
            success: true,
            error: None,
            registry: Some(resolved.registry),
        };
    }

    if let Some(parent) = repo_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let clone = clone_at_tag(&resolved.repo_url, &repo_path, &resolved.version);

    if !clone.success {
        return FetchResult {
            package: resolved.name.clone(),
            version: resolved.version.clone(),
            path: get_repo_relative_path(&display_name, &resolved.version),
            success: false,
            error: clone.error,
            registry: Some(resolved.registry),
        };
    }

    remove_git_dir(&repo_path);

    let mut rel = get_repo_relative_path(&display_name, &resolved.version);
    if let Some(ref dir) = resolved.repo_directory {
        rel = format!("{rel}/{dir}");
    }

    FetchResult {
        package: resolved.name.clone(),
        version: resolved.version.clone(),
        path: rel,
        success: true,
        error: clone.error,
        registry: Some(resolved.registry),
    }
}

pub fn fetch_repo_source(resolved: &ResolvedRepo) -> FetchResult {
    let repo_path = get_repo_path(&resolved.display_name, &resolved.git_ref);

    if repo_path.exists() {
        return FetchResult {
            package: resolved.display_name.clone(),
            version: resolved.git_ref.clone(),
            path: get_repo_relative_path(&resolved.display_name, &resolved.git_ref),
            success: true,
            error: None,
            registry: None,
        };
    }

    if let Some(parent) = repo_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let clone = clone_at_ref(&resolved.repo_url, &repo_path, &resolved.git_ref);

    if !clone.success {
        return FetchResult {
            package: resolved.display_name.clone(),
            version: resolved.git_ref.clone(),
            path: get_repo_relative_path(&resolved.display_name, &resolved.git_ref),
            success: false,
            error: clone.error,
            registry: None,
        };
    }

    remove_git_dir(&repo_path);

    FetchResult {
        package: resolved.display_name.clone(),
        version: resolved.git_ref.clone(),
        path: get_repo_relative_path(&resolved.display_name, &resolved.git_ref),
        success: true,
        error: clone.error,
        registry: None,
    }
}
