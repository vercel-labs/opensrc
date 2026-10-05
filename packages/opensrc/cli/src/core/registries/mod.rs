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

/// Blocking HTTP client for registry and git-host APIs.
///
/// Trust anchors are the union of the OS certificate store (`rustls-tls-native-roots`)
/// and the bundled Mozilla roots (`rustls-tls-webpki-roots`). A corporate proxy CA
/// installed in the OS store is trusted the same way `curl` trusts it. When that
/// store is missing or empty, the Mozilla roots still allow HTTPS.
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

    /// A CA that exists only in `SSL_CERT_FILE` (the OpenSSL/OS trust input used by
    /// `rustls-native-certs` on every platform) must be accepted. The bundled Mozilla
    /// roots do not contain this CA, so this fails when the client is built with
    /// `rustls-tls-webpki-roots` alone.
    #[test]
    fn http_client_trusts_os_certificate_store() {
        use std::io::{BufRead, BufReader, Read};
        use std::path::{Path, PathBuf};
        use std::process::{Child, Command, Stdio};
        use std::sync::Mutex;

        struct TempDir(PathBuf);
        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        struct ChildGuard(Child);
        impl Drop for ChildGuard {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }

        struct RestoreEnv {
            file: Option<std::ffi::OsString>,
            dir: Option<std::ffi::OsString>,
        }
        impl Drop for RestoreEnv {
            fn drop(&mut self) {
                restore_env("SSL_CERT_FILE", self.file.take());
                restore_env("SSL_CERT_DIR", self.dir.take());
            }
        }

        fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }

        fn with_ssl_cert_file<T>(file: Option<&Path>, body: impl FnOnce() -> T) -> T {
            static LOCK: Mutex<()> = Mutex::new(());
            let _lock = LOCK.lock().unwrap_or_else(|err| err.into_inner());
            let restore = RestoreEnv {
                file: std::env::var_os("SSL_CERT_FILE"),
                dir: std::env::var_os("SSL_CERT_DIR"),
            };
            match file {
                Some(path) => std::env::set_var("SSL_CERT_FILE", path),
                None => std::env::remove_var("SSL_CERT_FILE"),
            }
            // rustls-native-certs loads SSL_CERT_DIR in addition to SSL_CERT_FILE.
            std::env::remove_var("SSL_CERT_DIR");
            let result = body();
            drop(restore);
            result
        }

        fn openssl(dir: &Path, args: &[&str]) {
            let output = Command::new("openssl")
                .args(args)
                .current_dir(dir)
                .output()
                .expect("openssl is required to generate the test CA");
            assert!(
                output.status.success(),
                "openssl {args:?} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fn error_chain(err: &dyn std::error::Error) -> String {
            let mut parts = vec![err.to_string()];
            let mut source = err.source();
            while let Some(inner) = source {
                parts.push(inner.to_string());
                source = inner.source();
            }
            parts.join("\n")
        }

        let dir = TempDir(std::env::temp_dir().join(format!("opensrc-tls-{}", std::process::id())));
        std::fs::create_dir_all(&dir.0).unwrap();

        openssl(
            &dir.0,
            &[
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-sha256",
                "-days",
                "1",
                "-nodes",
                "-keyout",
                "ca.key",
                "-out",
                "ca.crt",
                "-subj",
                "/CN=opensrc-test-ca",
                "-addext",
                "basicConstraints=critical,CA:TRUE",
                "-addext",
                "keyUsage=critical,keyCertSign,cRLSign",
            ],
        );
        openssl(
            &dir.0,
            &[
                "req",
                "-newkey",
                "rsa:2048",
                "-sha256",
                "-nodes",
                "-keyout",
                "server.key",
                "-out",
                "server.csr",
                "-subj",
                "/CN=localhost",
            ],
        );
        std::fs::write(
            dir.0.join("server.ext"),
            "basicConstraints=CA:FALSE\n\
             keyUsage=digitalSignature,keyEncipherment\n\
             extendedKeyUsage=serverAuth\n\
             subjectAltName=IP:127.0.0.1,DNS:localhost\n",
        )
        .unwrap();
        openssl(
            &dir.0,
            &[
                "x509",
                "-req",
                "-in",
                "server.csr",
                "-CA",
                "ca.crt",
                "-CAkey",
                "ca.key",
                "-CAcreateserial",
                "-out",
                "server.crt",
                "-days",
                "1",
                "-sha256",
                "-extfile",
                "server.ext",
            ],
        );

        let script = dir.0.join("server.py");
        std::fs::write(
            &script,
            r#"import http.server
import ssl
import sys

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"ok"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return

server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.minimum_version = ssl.TLSVersion.TLSv1_2
context.load_cert_chain(sys.argv[1], sys.argv[2])
server.socket = context.wrap_socket(server.socket, server_side=True)
print(server.server_address[1], flush=True)
while True:
    try:
        server.handle_request()
    except Exception:
        continue
"#,
        )
        .unwrap();

        let mut child = ChildGuard(
            Command::new("python3")
                .arg("-u")
                .arg(&script)
                .arg(dir.0.join("server.crt"))
                .arg(dir.0.join("server.key"))
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("python3 is required to serve the test certificate"),
        );
        let mut stdout = BufReader::new(child.0.stdout.take().unwrap());
        let mut port_line = String::new();
        let read = stdout.read_line(&mut port_line).expect("read server port");
        if read == 0 {
            let mut stderr = String::new();
            if let Some(mut err) = child.0.stderr.take() {
                let _ = err.read_to_string(&mut stderr);
            }
            panic!("HTTPS test server did not report a port: {stderr}");
        }
        let port: u16 = port_line
            .trim()
            .parse()
            .unwrap_or_else(|_| panic!("invalid port from test server: {port_line:?}"));
        let url = format!("https://127.0.0.1:{port}/");

        let untrusted = with_ssl_cert_file(None, || http_client().get(&url).send());
        let untrusted =
            untrusted.expect_err("custom CA must be rejected when it is not in the OS store");
        let untrusted_text = error_chain(&untrusted);
        assert!(
            untrusted_text.to_ascii_lowercase().contains("certificate"),
            "expected a certificate verification error, got {untrusted_text}"
        );

        let trusted = with_ssl_cert_file(Some(&dir.0.join("ca.crt")), || {
            http_client().get(&url).send()
        });
        let trusted = trusted.unwrap_or_else(|err| {
            panic!(
                "OS trust store should accept the test CA: {}",
                error_chain(&err)
            )
        });
        assert!(trusted.status().is_success());
        assert_eq!(trusted.text().unwrap(), "ok");
    }
}
