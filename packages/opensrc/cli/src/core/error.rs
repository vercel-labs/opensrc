pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Package \"{name}\" not found on {registry}")]
    PackageNotFound { name: String, registry: String },

    #[error("{0}")]
    VersionNotFound(String),

    #[error("{0}")]
    NoRepoUrl(String),

    #[error("{0}")]
    RepoNotFound(String),

    #[error("{0}")]
    AccessDenied(String),

    #[error("GitHub API rate limit exceeded. Try again later or set GITHUB_TOKEN.")]
    RateLimitExceeded,

    #[error("Invalid repository format: {0}")]
    InvalidRepoSpec(String),

    #[error("{0}")]
    CloneFailed(String),

    #[error("Could not determine home directory. Set the OPENSRC_HOME environment variable.")]
    HomeDirNotFound,

    #[error("Failed to fetch {context}: {status}")]
    HttpStatus { context: String, status: String },

    #[error("{0}")]
    Other(String),

    #[error(transparent)]
    Http(#[from] reqwest::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
