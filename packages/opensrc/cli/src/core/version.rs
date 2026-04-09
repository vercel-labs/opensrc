use std::fs;
use std::path::Path;

fn strip_version_prefix(version: &str) -> String {
    version
        .trim_start_matches(|c: char| "^~>=<".contains(c))
        .to_string()
}

fn version_from_node_modules(package_name: &str, cwd: &Path) -> Option<String> {
    let path = cwd
        .join("node_modules")
        .join(package_name)
        .join("package.json");
    let content = fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
    parsed.get("version")?.as_str().map(|s| s.to_string())
}

fn version_from_package_lock(package_name: &str, cwd: &Path) -> Option<String> {
    let path = cwd.join("package-lock.json");
    let content = fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;

    // npm v7+ format
    if let Some(packages) = parsed.get("packages") {
        let key = format!("node_modules/{package_name}");
        if let Some(pkg) = packages.get(&key) {
            if let Some(v) = pkg.get("version").and_then(|v| v.as_str()) {
                return Some(v.to_string());
            }
        }
    }

    // npm v6 format
    if let Some(deps) = parsed.get("dependencies") {
        if let Some(dep) = deps.get(package_name) {
            if let Some(v) = dep.get("version").and_then(|v| v.as_str()) {
                return Some(v.to_string());
            }
        }
    }

    None
}

fn version_from_pnpm_lock(package_name: &str, cwd: &Path) -> Option<String> {
    let path = cwd.join("pnpm-lock.yaml");
    let content = fs::read_to_string(path).ok()?;

    let escaped = regex::escape(package_name);
    let pattern = format!(r#"['"]?{escaped}@([^('":\s)]+)"#);
    let re = regex::Regex::new(&pattern).ok()?;

    let caps = re.captures(&content)?;
    Some(caps[1].to_string())
}

fn version_from_yarn_lock(package_name: &str, cwd: &Path) -> Option<String> {
    let path = cwd.join("yarn.lock");
    let content = fs::read_to_string(path).ok()?;

    let escaped = regex::escape(package_name);
    let pattern = format!(r#""?{escaped}@[^":\n]+[":]?\s*\n\s*version\s+["']?([^"'\n]+)"#);
    let re = regex::Regex::new(&pattern).ok()?;

    let caps = re.captures(&content)?;
    Some(caps[1].to_string())
}

/// Best-guess fallback: strips range prefixes (^, ~, >=) from package.json
/// dependency specs. The result may not match an actual published version
/// (e.g. ^1.0.0 → 1.0.0 when 1.5.3 is installed), but higher-priority
/// sources (node_modules, lockfiles) are checked first.
fn version_from_package_json(package_name: &str, cwd: &Path) -> Option<String> {
    let path = cwd.join("package.json");
    let content = fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;

    for field in &["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(deps) = parsed.get(field) {
            if let Some(v) = deps.get(package_name).and_then(|v| v.as_str()) {
                return Some(strip_version_prefix(v));
            }
        }
    }

    None
}

/// Detect the installed version of an npm package from lockfiles and node_modules.
/// Priority: node_modules > package-lock.json > pnpm-lock.yaml > yarn.lock > package.json
pub fn detect_installed_version(package_name: &str, cwd: &Path) -> Option<String> {
    version_from_node_modules(package_name, cwd)
        .or_else(|| version_from_package_lock(package_name, cwd))
        .or_else(|| version_from_pnpm_lock(package_name, cwd))
        .or_else(|| version_from_yarn_lock(package_name, cwd))
        .or_else(|| version_from_package_json(package_name, cwd))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_version_prefix() {
        assert_eq!(strip_version_prefix("^1.0.0"), "1.0.0");
        assert_eq!(strip_version_prefix("~2.3.4"), "2.3.4");
        assert_eq!(strip_version_prefix(">=3.0.0"), "3.0.0");
        assert_eq!(strip_version_prefix("1.0.0"), "1.0.0");
    }
}
