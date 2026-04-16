use std::sync::LazyLock;

use serde::Deserialize;

static RE_URL: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^https?://(github\.com|gitlab\.com|bitbucket\.org)/").unwrap()
});
static RE_OWNER: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9-]*$").unwrap());
static RE_REPO: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^[a-zA-Z0-9._-]+$").unwrap());

const SUPPORTED_HOSTS: &[&str] = &["github.com", "gitlab.com", "bitbucket.org"];
const DEFAULT_HOST: &str = "github.com";

#[derive(Debug, Clone)]
pub struct RepoSpec {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub git_ref: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedRepo {
    pub git_ref: String,
    pub repo_url: String,
    pub display_name: String,
}

pub fn parse_repo_spec(spec: &str) -> Option<RepoSpec> {
    let input = spec.trim();
    let mut remaining = input.to_string();
    let mut git_ref: Option<String> = None;
    let mut host = DEFAULT_HOST.to_string();

    // Handle shorthand prefixes
    if remaining.starts_with("github:") {
        host = "github.com".to_string();
        remaining = remaining[7..].to_string();
    } else if remaining.starts_with("gitlab:") {
        host = "gitlab.com".to_string();
        remaining = remaining[7..].to_string();
    } else if remaining.starts_with("bitbucket:") {
        host = "bitbucket.org".to_string();
        remaining = remaining[10..].to_string();
    } else if remaining.starts_with("http://") || remaining.starts_with("https://") {
        // Full URL
        let url = match url::Url::parse(&remaining) {
            Ok(u) => u,
            Err(_) => return None,
        };
        host = url.host_str()?.to_string();
        let path_parts: Vec<&str> = url
            .path()
            .trim_start_matches('/')
            .split('/')
            .filter(|s| !s.is_empty())
            .collect();

        if path_parts.len() < 2 {
            return None;
        }

        let owner = path_parts[0].to_string();
        let mut repo = path_parts[1].to_string();
        if repo.ends_with(".git") {
            repo = repo[..repo.len() - 4].to_string();
        }

        if path_parts.len() >= 4 && (path_parts[2] == "tree" || path_parts[2] == "blob") {
            git_ref = Some(path_parts[3].to_string());
        }

        return Some(RepoSpec {
            host,
            owner,
            repo,
            git_ref,
        });
    } else if SUPPORTED_HOSTS
        .iter()
        .any(|h| remaining.starts_with(&format!("{h}/")))
    {
        if let Some(idx) = remaining.find('/') {
            host = remaining[..idx].to_string();
            remaining = remaining[idx + 1..].to_string();
        }
    } else if remaining.starts_with('@') || remaining.split('/').count() != 2 {
        return None;
    }

    // Extract ref from @ or #
    if let Some(at_idx) = remaining.find('@') {
        if at_idx > 0 {
            git_ref = Some(remaining[at_idx + 1..].to_string());
            remaining = remaining[..at_idx].to_string();
        }
    } else if let Some(hash_idx) = remaining.find('#') {
        if hash_idx > 0 {
            git_ref = Some(remaining[hash_idx + 1..].to_string());
            remaining = remaining[..hash_idx].to_string();
        }
    }

    let parts: Vec<&str> = remaining.split('/').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return None;
    }

    Some(RepoSpec {
        host,
        owner: parts[0].to_string(),
        repo: parts[1].to_string(),
        git_ref,
    })
}

pub fn is_repo_spec(spec: &str) -> bool {
    let trimmed = spec.trim();

    if trimmed.starts_with("github:")
        || trimmed.starts_with("gitlab:")
        || trimmed.starts_with("bitbucket:")
    {
        return true;
    }

    if RE_URL.is_match(trimmed) {
        return true;
    }

    if SUPPORTED_HOSTS
        .iter()
        .any(|h| trimmed.starts_with(&format!("{h}/")))
    {
        return true;
    }

    if trimmed.starts_with('@') {
        return false;
    }

    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
        let repo_part = parts[1]
            .split('@')
            .next()
            .unwrap_or("")
            .split('#')
            .next()
            .unwrap_or("");
        return RE_OWNER.is_match(parts[0]) && RE_REPO.is_match(repo_part);
    }

    false
}

#[derive(Deserialize)]
struct GitHubApiResponse {
    default_branch: String,
}

#[derive(Deserialize)]
struct GitLabApiResponse {
    default_branch: Option<String>,
}

#[derive(Deserialize)]
struct BitbucketMainBranch {
    name: Option<String>,
}

#[derive(Deserialize)]
struct BitbucketApiResponse {
    mainbranch: Option<BitbucketMainBranch>,
}

pub fn resolve_repo(spec: &RepoSpec) -> Result<ResolvedRepo, Box<dyn std::error::Error>> {
    match spec.host.as_str() {
        "github.com" => resolve_github(spec),
        "gitlab.com" => resolve_gitlab(spec),
        "bitbucket.org" => resolve_bitbucket(spec),
        _ => Ok(ResolvedRepo {
            git_ref: spec.git_ref.clone().unwrap_or_else(|| "main".to_string()),
            repo_url: format!("https://{}/{}/{}", spec.host, spec.owner, spec.repo),
            display_name: format!("{}/{}/{}", spec.host, spec.owner, spec.repo),
        }),
    }
}

fn resolve_github(spec: &RepoSpec) -> Result<ResolvedRepo, Box<dyn std::error::Error>> {
    let url = format!("https://api.github.com/repos/{}/{}", spec.owner, spec.repo);

    let client = super::http_client();
    let mut req = client
        .get(&url)
        .header("Accept", "application/vnd.github.v3+json");

    if let Some(token) = super::github_token() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }

    let resp = req.send()?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        let hint = if super::github_token().is_none() {
            " If this is a private repo, set GITHUB_TOKEN."
        } else {
            " Your token may lack access to this repository."
        };
        return Err(format!(
            "Repository \"{}/{}\" not found on GitHub.{hint}",
            spec.owner, spec.repo
        )
        .into());
    }
    if resp.status() == reqwest::StatusCode::FORBIDDEN {
        return Err("GitHub API rate limit exceeded. Try again later or set GITHUB_TOKEN.".into());
    }
    if !resp.status().is_success() {
        return Err(format!("Failed to fetch repository info: {}", resp.status()).into());
    }

    let data: GitHubApiResponse = resp.json()?;
    let resolved_ref = spec.git_ref.clone().unwrap_or(data.default_branch);

    Ok(ResolvedRepo {
        git_ref: resolved_ref,
        repo_url: format!("https://github.com/{}/{}", spec.owner, spec.repo),
        display_name: format!("{}/{}/{}", spec.host, spec.owner, spec.repo),
    })
}

fn resolve_gitlab(spec: &RepoSpec) -> Result<ResolvedRepo, Box<dyn std::error::Error>> {
    let project_path = format!("{}/{}", spec.owner, spec.repo);
    let encoded = urlencoding::encode(&project_path);
    let url = format!("https://gitlab.com/api/v4/projects/{encoded}");

    let client = super::http_client();
    let mut req = client.get(&url);

    if let Some(token) = super::gitlab_token() {
        req = req.header("PRIVATE-TOKEN", &token);
    }

    let resp = req.send()?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        let hint = if super::gitlab_token().is_none() {
            " If this is a private repo, set GITLAB_TOKEN."
        } else {
            " Your token may lack access to this repository."
        };
        return Err(format!(
            "Repository \"{}/{}\" not found on GitLab.{hint}",
            spec.owner, spec.repo
        )
        .into());
    }
    if !resp.status().is_success() {
        return Err(format!("Failed to fetch repository info: {}", resp.status()).into());
    }

    let data: GitLabApiResponse = resp.json()?;
    let resolved_ref = spec
        .git_ref
        .clone()
        .unwrap_or_else(|| data.default_branch.unwrap_or_else(|| "main".to_string()));

    Ok(ResolvedRepo {
        git_ref: resolved_ref,
        repo_url: format!("https://gitlab.com/{}/{}", spec.owner, spec.repo),
        display_name: format!("{}/{}/{}", spec.host, spec.owner, spec.repo),
    })
}

fn resolve_bitbucket(spec: &RepoSpec) -> Result<ResolvedRepo, Box<dyn std::error::Error>> {
    let url = format!(
        "https://api.bitbucket.org/2.0/repositories/{}/{}",
        spec.owner, spec.repo
    );

    let client = super::http_client();
    let mut req = client.get(&url);

    if let Some(token) = super::bitbucket_token() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }

    let resp = req.send()?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        let hint = if super::bitbucket_token().is_none() {
            " If this is a private repo, set BITBUCKET_TOKEN."
        } else {
            " Your token may lack access to this repository."
        };
        return Err(format!(
            "Repository \"{}/{}\" not found on Bitbucket.{hint}",
            spec.owner, spec.repo
        )
        .into());
    }
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || resp.status() == reqwest::StatusCode::FORBIDDEN
    {
        let hint = if super::bitbucket_token().is_none() {
            " If this is a private repo, set BITBUCKET_TOKEN."
        } else {
            " Your token may lack access to this repository."
        };
        return Err(format!(
            "Access denied to Bitbucket repository \"{}/{}\".{hint}",
            spec.owner, spec.repo
        )
        .into());
    }
    if !resp.status().is_success() {
        return Err(format!("Failed to fetch repository info: {}", resp.status()).into());
    }

    let data: BitbucketApiResponse = resp.json()?;
    let resolved_ref = spec.git_ref.clone().unwrap_or_else(|| {
        data.mainbranch
            .and_then(|b| b.name)
            .unwrap_or_else(|| "main".to_string())
    });

    Ok(ResolvedRepo {
        git_ref: resolved_ref,
        repo_url: format!("https://bitbucket.org/{}/{}", spec.owner, spec.repo),
        display_name: format!("{}/{}/{}", spec.host, spec.owner, spec.repo),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_repo_spec_simple() {
        let spec = parse_repo_spec("vercel/next.js").unwrap();
        assert_eq!(spec.host, "github.com");
        assert_eq!(spec.owner, "vercel");
        assert_eq!(spec.repo, "next.js");
        assert_eq!(spec.git_ref, None);
    }

    #[test]
    fn test_parse_repo_spec_with_ref() {
        let spec = parse_repo_spec("vercel/next.js@canary").unwrap();
        assert_eq!(spec.owner, "vercel");
        assert_eq!(spec.repo, "next.js");
        assert_eq!(spec.git_ref, Some("canary".into()));
    }

    #[test]
    fn test_parse_repo_spec_github_prefix() {
        let spec = parse_repo_spec("github:vercel/next.js").unwrap();
        assert_eq!(spec.host, "github.com");
        assert_eq!(spec.owner, "vercel");
    }

    #[test]
    fn test_parse_repo_spec_full_url() {
        let spec = parse_repo_spec("https://github.com/vercel/next.js/tree/canary").unwrap();
        assert_eq!(spec.host, "github.com");
        assert_eq!(spec.owner, "vercel");
        assert_eq!(spec.repo, "next.js");
        assert_eq!(spec.git_ref, Some("canary".into()));
    }

    #[test]
    fn test_parse_repo_spec_bitbucket_prefix() {
        let spec = parse_repo_spec("bitbucket:atlassian/python-bitbucket").unwrap();
        assert_eq!(spec.host, "bitbucket.org");
        assert_eq!(spec.owner, "atlassian");
        assert_eq!(spec.repo, "python-bitbucket");
        assert_eq!(spec.git_ref, None);
    }

    #[test]
    fn test_parse_repo_spec_bitbucket_prefix_with_ref() {
        let spec = parse_repo_spec("bitbucket:atlassian/python-bitbucket@master").unwrap();
        assert_eq!(spec.host, "bitbucket.org");
        assert_eq!(spec.owner, "atlassian");
        assert_eq!(spec.repo, "python-bitbucket");
        assert_eq!(spec.git_ref, Some("master".into()));
    }

    #[test]
    fn test_parse_repo_spec_bitbucket_url() {
        let spec = parse_repo_spec("https://bitbucket.org/atlassian/python-bitbucket").unwrap();
        assert_eq!(spec.host, "bitbucket.org");
        assert_eq!(spec.owner, "atlassian");
        assert_eq!(spec.repo, "python-bitbucket");
        assert_eq!(spec.git_ref, None);
    }

    #[test]
    fn test_is_repo_spec() {
        assert!(is_repo_spec("vercel/next.js"));
        assert!(is_repo_spec("github:vercel/next.js"));
        assert!(is_repo_spec("https://github.com/vercel/next.js"));
        assert!(is_repo_spec("bitbucket:atlassian/python-bitbucket"));
        assert!(is_repo_spec(
            "https://bitbucket.org/atlassian/python-bitbucket"
        ));
        assert!(!is_repo_spec("@babel/core"));
        assert!(!is_repo_spec("zod"));
    }
}
