use std::collections::{HashMap, HashSet, VecDeque};
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
    parse_pnpm_lock(&content, package_name)
}

fn version_from_yarn_lock(package_name: &str, cwd: &Path) -> Option<String> {
    let path = cwd.join("yarn.lock");
    let content = fs::read_to_string(path).ok()?;
    parse_yarn_lock(&content, package_name)
}

/// Best-guess fallback: strips range prefixes (^, ~, >=) from package.json
/// dependency specs. The result may not match an actual published version
/// (e.g. ^1.0.0 → 1.0.0 when 1.5.3 is installed), but higher-priority
/// sources (node_modules, lockfiles) are checked first.
fn version_from_package_json(package_name: &str, cwd: &Path) -> Option<String> {
    let path = cwd.join("package.json");
    let content = fs::read_to_string(path).ok()?;
    parse_package_json_version(&content, package_name)
}

/// Extract `package_name`'s version from a parsed package.json.
///
/// Skips entries that aren't real registry versions (e.g. `workspace:*`,
/// `link:../pkg`, `file:./tarball.tgz`, `git+https://...`) so the caller
/// isn't handed a string that can't be resolved against npm.
fn parse_package_json_version(content: &str, package_name: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(content).ok()?;

    for field in &["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(deps) = parsed.get(field) {
            if let Some(v) = deps.get(package_name).and_then(|v| v.as_str()) {
                let stripped = strip_version_prefix(v);
                if is_registry_version(&stripped) {
                    return Some(stripped);
                }
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

// ---------------------------------------------------------------------------
// Shared lockfile helpers
// ---------------------------------------------------------------------------

/// Strip a pnpm peer-dependency suffix like `(react@18.0.0)` from a version
/// string, so `18.2.0(react@17.0.0)` becomes `18.2.0`. Cuts at the first `(`
/// so nested peer suffixes like `18.2.0(a@1)(b@2(c@3))` also collapse
/// cleanly.
fn strip_peer_suffix(v: &str) -> &str {
    match v.find('(') {
        Some(i) => v[..i].trim_end(),
        None => v.trim_end(),
    }
}

/// Strip a YAML-style inline comment. Only strips when `#` is preceded by
/// whitespace, so URL fragments like `github:foo/bar#branch` pass through
/// intact.
fn strip_inline_comment(s: &str) -> &str {
    match s.find(" #") {
        Some(i) => s[..i].trim_end(),
        None => s,
    }
}

/// Strip any mix of surrounding single/double quotes from a trimmed string.
fn trim_quotes(s: &str) -> &str {
    s.trim_matches(|c: char| c == '"' || c == '\'')
}

/// Normalise a raw YAML value: trim whitespace, strip an inline comment, and
/// strip surrounding quotes. Does NOT strip peer-dep suffixes — callers do
/// that when appropriate.
fn clean_value(s: &str) -> &str {
    let s = s.trim();
    let s = strip_inline_comment(s);
    trim_quotes(s)
}

/// Split a `<pkg>@<rest>` spec into `(name, rest)`, treating scoped names
/// (`@scope/pkg`) correctly. Returns `None` if there's no `@` separator.
fn split_pkg_spec(spec: &str) -> Option<(&str, &str)> {
    let at_pos = if let Some(rest) = spec.strip_prefix('@') {
        rest.find('@').map(|i| i + 1)?
    } else {
        spec.find('@')?
    };
    Some((&spec[..at_pos], &spec[at_pos + 1..]))
}

/// Return `true` if `v` looks like a version we can resolve against a public
/// registry. Lockfiles (and package.json) can legitimately contain
/// workspace/link/file/git/URL protocol strings — for example a pnpm importer
/// may pin a sibling workspace package with `version: link:../pkg`, and a
/// yarn Berry workspace root has `version: 0.0.0-use.local`. Returning any
/// of those from `detect_installed_version` would make the caller try to
/// fetch `<pkg>@link:../pkg` from npm, which fails with a confusing error.
///
/// Real npm versions never contain `:`, so treating a colon as disqualifying
/// catches every known protocol prefix (`link:`, `file:`, `workspace:`,
/// `portal:`, `git:`, `git+ssh://`, `github:`, `http:`, `https:`, `npm:`,
/// etc.) without having to enumerate them.
fn is_registry_version(v: &str) -> bool {
    !v.is_empty() && v != "0.0.0-use.local" && !v.contains(':')
}

// ---------------------------------------------------------------------------
// pnpm
// ---------------------------------------------------------------------------

/// Dependency-graph node built up during pnpm parsing. Keys in the containing
/// map are the full snapshot id (`<name>@<version>[<peer-suffix>]`).
#[derive(Debug)]
struct PnpmNode {
    name: String,
    /// Version with peer suffix stripped — what we'd return to the caller.
    version: String,
    /// Snapshot ids of this node's direct dependencies.
    deps: Vec<String>,
}

#[derive(Debug, Default)]
struct PnpmGraph {
    nodes: HashMap<String, PnpmNode>,
    /// Snapshot ids that are direct deps of any importer (or top-level
    /// `dependencies:` in v5/v6 non-workspace lockfiles).
    roots: Vec<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Origin {
    /// Top-level `dependencies:` / `devDependencies:` etc. (v5/v6).
    Root,
    /// Inside an `importers.<name>.<group>:` block.
    Importer,
}

/// A frame on the indent-aware parse stack. The `usize` is the indent of the
/// line that opened the frame; children must be at indent strictly greater
/// than that value. `Frame::Root` has no header line and is never popped.
#[derive(Clone, Debug)]
enum Frame {
    Root,
    Importers(usize),
    Importer(usize),
    DepGroup(usize, Origin),
    /// Block-form dep entry awaiting a nested `version:` line.
    DepBlock {
        base: usize,
        origin: Origin,
        pkg_name: String,
    },
    Packages(usize),
    Snapshots(usize),
    /// Inside a `packages:` or `snapshots:` entry, collecting its subkeys.
    PkgEntry {
        base: usize,
        key: String,
    },
    /// Inside a pkg entry's `dependencies:` / `optionalDependencies:` block,
    /// collecting dep edges for `owner`.
    PkgDeps {
        base: usize,
        owner: String,
    },
}

impl Frame {
    fn base(&self) -> Option<usize> {
        match self {
            Frame::Root => None,
            Frame::Importers(b) | Frame::Importer(b) | Frame::Packages(b) | Frame::Snapshots(b) => {
                Some(*b)
            }
            Frame::DepGroup(b, _) => Some(*b),
            Frame::DepBlock { base, .. }
            | Frame::PkgEntry { base, .. }
            | Frame::PkgDeps { base, .. } => Some(*base),
        }
    }
}

/// Parse a `pnpm-lock.yaml` text and return the installed version of
/// `package_name`, if found.
///
/// Search priority:
/// 1. Direct match in `importers.<any>.{dependencies,devDependencies,optionalDependencies}`
/// 2. Direct match in top-level `{dependencies,devDependencies,optionalDependencies}` (v5/v6)
/// 3. Transitive resolution via BFS from root-importer deps through the
///    `snapshots:` (v9) or `packages:` (v6–v8) dep graph
/// 4. Fallback: first matching `packages:` or `snapshots:` key
fn parse_pnpm_lock(text: &str, pkg: &str) -> Option<String> {
    let mut stack: Vec<Frame> = vec![Frame::Root];
    let mut graph = PnpmGraph::default();

    let mut importer_match: Option<String> = None;
    let mut top_match: Option<String> = None;
    let mut packages_fallback: Option<String> = None;

    for raw in text.lines() {
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        if line.trim_start().starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let content = &line[indent..];

        // Pop frames whose scope has ended. Root (base == None) never pops.
        while let Some(top) = stack.last() {
            if let Some(base) = top.base() {
                if indent <= base {
                    stack.pop();
                    continue;
                }
            }
            break;
        }

        // Clone the top frame so we can mutate the stack inside the match.
        let top = stack.last().expect("stack never empty").clone();
        match top {
            Frame::Root => {
                if indent == 0 {
                    if let Some(key) = content.strip_suffix(':') {
                        match key.trim() {
                            "importers" => stack.push(Frame::Importers(indent)),
                            "dependencies" | "devDependencies" | "optionalDependencies" => {
                                stack.push(Frame::DepGroup(indent, Origin::Root));
                            }
                            "packages" => stack.push(Frame::Packages(indent)),
                            "snapshots" => stack.push(Frame::Snapshots(indent)),
                            _ => {}
                        }
                    }
                }
            }
            Frame::Importers(_) => {
                if content.ends_with(':') {
                    stack.push(Frame::Importer(indent));
                }
            }
            Frame::Importer(_) => {
                if let Some(key) = content.strip_suffix(':') {
                    if matches!(
                        key.trim(),
                        "dependencies" | "devDependencies" | "optionalDependencies"
                    ) {
                        stack.push(Frame::DepGroup(indent, Origin::Importer));
                    }
                }
            }
            Frame::DepGroup(_, origin) => {
                if let Some((k, v)) = content.split_once(':') {
                    let dep_name = trim_quotes(k.trim()).to_string();
                    let raw_value = v.trim();

                    if raw_value.is_empty() {
                        // Block form: version comes on a nested line.
                        stack.push(Frame::DepBlock {
                            base: indent,
                            origin,
                            pkg_name: dep_name,
                        });
                    } else {
                        let cleaned = clean_value(raw_value);
                        let stripped = strip_peer_suffix(cleaned);
                        // Add to graph roots using the raw (peer-including)
                        // value so the key matches `snapshots:` entries.
                        graph.roots.push(format!("{dep_name}@{cleaned}"));

                        // Filter at capture so workspace/link/file versions
                        // in one importer don't block a real version in a
                        // later importer.
                        if dep_name == pkg && is_registry_version(stripped) {
                            let captured = Some(stripped.to_string());
                            match origin {
                                Origin::Importer if importer_match.is_none() => {
                                    importer_match = captured;
                                }
                                Origin::Root if top_match.is_none() => {
                                    top_match = captured;
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            Frame::DepBlock {
                origin, pkg_name, ..
            } => {
                if let Some(rest) = content.strip_prefix("version:") {
                    let cleaned = clean_value(rest);
                    let stripped = strip_peer_suffix(cleaned);
                    graph.roots.push(format!("{pkg_name}@{cleaned}"));

                    if pkg_name == pkg && is_registry_version(stripped) {
                        let captured = Some(stripped.to_string());
                        match origin {
                            Origin::Importer if importer_match.is_none() => {
                                importer_match = captured;
                            }
                            Origin::Root if top_match.is_none() => {
                                top_match = captured;
                            }
                            _ => {}
                        }
                    }
                    stack.pop();
                }
            }
            Frame::Packages(_) | Frame::Snapshots(_) => {
                if let Some((key_part, value_part)) = content.split_once(':') {
                    let key = trim_quotes(key_part.trim());
                    let key = key.strip_prefix('/').unwrap_or(key);

                    if let Some((name, version_with_peer)) = split_pkg_spec(key) {
                        let version = strip_peer_suffix(version_with_peer).to_string();

                        graph
                            .nodes
                            .entry(key.to_string())
                            .or_insert_with(|| PnpmNode {
                                name: name.to_string(),
                                version: version.clone(),
                                deps: Vec::new(),
                            });

                        if name == pkg
                            && packages_fallback.is_none()
                            && is_registry_version(&version)
                        {
                            packages_fallback = Some(version);
                        }

                        if value_part.trim().is_empty() {
                            stack.push(Frame::PkgEntry {
                                base: indent,
                                key: key.to_string(),
                            });
                        }
                        // Else: inline value like `{}` — no children to parse.
                    }
                }
            }
            Frame::PkgEntry { key, .. } => {
                if let Some(sub_key) = content.strip_suffix(':') {
                    if matches!(sub_key.trim(), "dependencies" | "optionalDependencies") {
                        stack.push(Frame::PkgDeps {
                            base: indent,
                            owner: key,
                        });
                    }
                    // Ignore resolution/engines/peerDependencies/transitivePeerDependencies/etc.
                }
            }
            Frame::PkgDeps { owner, .. } => {
                if let Some((k, v)) = content.split_once(':') {
                    let dep_name = trim_quotes(k.trim());
                    let dep_value = clean_value(v);
                    if !dep_value.is_empty() {
                        let dep_key = format!("{dep_name}@{dep_value}");
                        if let Some(node) = graph.nodes.get_mut(&owner) {
                            node.deps.push(dep_key);
                        }
                    }
                }
            }
        }
    }

    importer_match
        .or(top_match)
        .or_else(|| resolve_transitive(&graph, pkg))
        .or(packages_fallback)
}

/// Breadth-first search from `graph.roots` through the snapshot dep graph,
/// returning the version of the first reached node whose name matches
/// `pkg`. Depth-first would pick a less-predictable version; BFS picks the
/// version at the shallowest transitive depth, which is closer to what's
/// actually hoisted in `node_modules`.
fn resolve_transitive(graph: &PnpmGraph, pkg: &str) -> Option<String> {
    if graph.nodes.is_empty() || graph.roots.is_empty() {
        return None;
    }
    let mut visited: HashSet<&str> = HashSet::new();
    let mut queue: VecDeque<&str> = graph.roots.iter().map(|s| s.as_str()).collect();
    while let Some(key) = queue.pop_front() {
        if !visited.insert(key) {
            continue;
        }
        let Some(node) = graph.nodes.get(key) else {
            continue;
        };
        if node.name == pkg && is_registry_version(&node.version) {
            return Some(node.version.clone());
        }
        for dep in &node.deps {
            if !visited.contains(dep.as_str()) {
                queue.push_back(dep.as_str());
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// yarn
// ---------------------------------------------------------------------------

/// Parse a `yarn.lock` text (classic v1 or Berry v2+) and return the
/// installed version of `package_name`, if found.
fn parse_yarn_lock(text: &str, pkg: &str) -> Option<String> {
    let mut blocks: Vec<Vec<&str>> = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() {
            if !current.is_empty() {
                blocks.push(std::mem::take(&mut current));
            }
        } else {
            current.push(line);
        }
    }
    if !current.is_empty() {
        blocks.push(current);
    }

    for block in &blocks {
        let mut header: Option<&str> = None;
        let mut body: Vec<&str> = Vec::with_capacity(block.len());

        for &line in block {
            if line.trim_start().starts_with('#') {
                continue;
            }
            if header.is_none() && !line.starts_with(char::is_whitespace) {
                header = Some(line);
            } else {
                body.push(line);
            }
        }

        let Some(header) = header else { continue };

        if header.starts_with("__metadata:") {
            continue;
        }

        let Some(header_body) = header.strip_suffix(':') else {
            continue;
        };

        // Splitting on `, ` covers both:
        //   v1:    "foo@^1.0.0", "foo@~1.2.0":
        //   Berry: "foo@npm:^1.0.0, foo@workspace:*":
        // In the Berry case, the first split part keeps a leading `"` and the
        // last keeps a trailing `"`; `trim_quotes` strips either form.
        let matched = header_body.split(", ").any(|s| {
            let spec = trim_quotes(s.trim());
            split_pkg_spec(spec)
                .map(|(name, _)| name == pkg)
                .unwrap_or(false)
        });

        if !matched {
            continue;
        }

        for line in &body {
            let trimmed = line.trim_start();
            let Some(rest) = trimmed.strip_prefix("version") else {
                continue;
            };
            // Must be followed by `:` (Berry) or whitespace (v1) to be the
            // version key — not e.g. `versions:`.
            let next = rest.chars().next();
            if !matches!(next, Some(':') | Some(' ') | Some('\t')) {
                continue;
            }
            let rest = rest.trim_start();
            let rest = rest.strip_prefix(':').unwrap_or(rest);
            let cleaned = clean_value(rest);
            let stripped = strip_peer_suffix(cleaned);
            // Skip workspace sentinels (`0.0.0-use.local`) and protocol
            // strings (`workspace:.`, `portal:.`, etc.) so the caller gets
            // `None` rather than an unfetchable "version". If another block
            // later in the file has a real version, we'll find it there.
            if is_registry_version(stripped) {
                return Some(stripped.to_string());
            }
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

    #[test]
    fn test_split_pkg_spec_plain() {
        assert_eq!(split_pkg_spec("zod@3.22.0"), Some(("zod", "3.22.0")));
    }

    #[test]
    fn test_split_pkg_spec_scoped() {
        assert_eq!(
            split_pkg_spec("@scope/pkg@1.2.3"),
            Some(("@scope/pkg", "1.2.3"))
        );
    }

    #[test]
    fn test_split_pkg_spec_npm_protocol() {
        assert_eq!(
            split_pkg_spec("zod@npm:^3.22.0"),
            Some(("zod", "npm:^3.22.0"))
        );
    }

    #[test]
    fn test_split_pkg_spec_no_separator() {
        assert_eq!(split_pkg_spec("zod"), None);
        assert_eq!(split_pkg_spec("@scope/pkg"), None);
    }

    #[test]
    fn test_strip_peer_suffix() {
        assert_eq!(strip_peer_suffix("18.0.0"), "18.0.0");
        assert_eq!(strip_peer_suffix("18.0.0(react@18.0.0)"), "18.0.0");
        assert_eq!(strip_peer_suffix("15.5.15(a@1)(b@2(c@3))"), "15.5.15");
        assert_eq!(strip_peer_suffix("3.22.0  "), "3.22.0");
    }

    #[test]
    fn test_strip_inline_comment() {
        assert_eq!(strip_inline_comment("1.2.3"), "1.2.3");
        assert_eq!(strip_inline_comment("1.2.3 # comment"), "1.2.3");
        assert_eq!(strip_inline_comment("1.2.3  # trailing"), "1.2.3");
        // URL fragment (no space before #) must pass through.
        assert_eq!(
            strip_inline_comment("github:foo/bar#branch"),
            "github:foo/bar#branch"
        );
    }

    #[test]
    fn test_clean_value() {
        assert_eq!(clean_value("  \"1.2.3\"  "), "1.2.3");
        assert_eq!(clean_value("  1.2.3 # comment"), "1.2.3");
        assert_eq!(clean_value("  '1.2.3' # comment"), "1.2.3");
    }

    #[test]
    fn test_is_registry_version() {
        assert!(is_registry_version("1.2.3"));
        assert!(is_registry_version("1.0.0-beta.1"));
        assert!(is_registry_version("1.0.0-rc.1+build.5114f85"));
        assert!(!is_registry_version(""));
        assert!(!is_registry_version("0.0.0-use.local"));
        assert!(!is_registry_version("link:../pkg"));
        assert!(!is_registry_version("file:./tarball.tgz"));
        assert!(!is_registry_version("workspace:*"));
        assert!(!is_registry_version("workspace:^1.0.0"));
        assert!(!is_registry_version("portal:../pkg"));
        assert!(!is_registry_version("github:owner/repo"));
        assert!(!is_registry_version("git+https://example.com/repo.git"));
        assert!(!is_registry_version("npm:other-pkg@^1"));
    }

    // ---- pnpm: direct-lookup behaviour (preserved from previous rewrite) ----

    #[test]
    fn pnpm_v5_top_level_string_form() {
        let text = r#"lockfileVersion: '5.4'

specifiers:
  zod: ^3.22.0

dependencies:
  zod: 3.22.0

packages:
  /zod/3.22.0:
    resolution: {}
"#;
        assert_eq!(parse_pnpm_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn pnpm_v6_top_level_object_form() {
        let text = r#"lockfileVersion: '6.0'

dependencies:
  zod:
    specifier: ^3.22.0
    version: 3.22.0

packages:
  /zod@3.22.0:
    resolution: {}
"#;
        assert_eq!(parse_pnpm_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn pnpm_v9_importer_with_peer_suffix() {
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      react-dom:
        specifier: ^18.0.0
        version: 18.2.0(react@18.0.0)

packages:
  react-dom@18.2.0:
    resolution: {}
"#;
        assert_eq!(parse_pnpm_lock(text, "react-dom"), Some("18.2.0".into()));
    }

    #[test]
    fn pnpm_scoped_package_importer() {
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      '@scope/pkg':
        specifier: ^1.0.0
        version: 1.2.3
"#;
        assert_eq!(parse_pnpm_lock(text, "@scope/pkg"), Some("1.2.3".into()));
    }

    #[test]
    fn pnpm_fallback_to_packages_key() {
        let text = r#"lockfileVersion: '9.0'

packages:
  zod@3.22.0:
    resolution: {}
"#;
        assert_eq!(parse_pnpm_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn pnpm_scoped_fallback_to_packages_key() {
        let text = r#"lockfileVersion: '9.0'

packages:
  '@scope/pkg@1.2.3':
    resolution: {}
"#;
        assert_eq!(parse_pnpm_lock(text, "@scope/pkg"), Some("1.2.3".into()));
    }

    #[test]
    fn pnpm_returns_none_when_absent() {
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      react:
        specifier: ^18.0.0
        version: 18.0.0
"#;
        assert_eq!(parse_pnpm_lock(text, "zod"), None);
    }

    #[test]
    fn pnpm_ignores_peer_suffix_false_match() {
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      react-dom:
        specifier: ^18.0.0
        version: 18.2.0(react@17.0.0)
"#;
        assert_eq!(parse_pnpm_lock(text, "react"), None);
    }

    #[test]
    fn pnpm_multiple_importers_first_wins() {
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      zod:
        specifier: ^3.22.0
        version: 3.22.0
  apps/docs:
    dependencies:
      zod:
        specifier: ^3.23.0
        version: 3.23.0
"#;
        assert_eq!(parse_pnpm_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn pnpm_devdependencies_in_importer() {
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    devDependencies:
      typescript:
        specifier: ^5.0.0
        version: 5.4.5
"#;
        assert_eq!(parse_pnpm_lock(text, "typescript"), Some("5.4.5".into()));
    }

    // ---- pnpm: new coverage ----

    #[test]
    fn pnpm_optional_dependencies_in_importer() {
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    optionalDependencies:
      fsevents:
        specifier: ^2.3.0
        version: 2.3.3
"#;
        assert_eq!(parse_pnpm_lock(text, "fsevents"), Some("2.3.3".into()));
    }

    #[test]
    fn pnpm_crlf_line_endings() {
        let text = "lockfileVersion: '9.0'\r\n\r\nimporters:\r\n  .:\r\n    dependencies:\r\n      zod:\r\n        specifier: ^3.22.0\r\n        version: 3.22.0\r\n";
        assert_eq!(parse_pnpm_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn pnpm_empty_file() {
        assert_eq!(parse_pnpm_lock("", "zod"), None);
    }

    #[test]
    fn pnpm_only_comments() {
        let text = "# just a comment\n# another one\n";
        assert_eq!(parse_pnpm_lock(text, "zod"), None);
    }

    #[test]
    fn pnpm_inline_comment_stripped() {
        // pnpm doesn't actually emit inline comments, but hand-edited or
        // future-format files shouldn't leak comment text into versions.
        let text = r#"lockfileVersion: '9.0'

dependencies:
  zod: 3.22.0 # pinned
"#;
        assert_eq!(parse_pnpm_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn pnpm_skips_link_version_in_importer() {
        // pnpm workspace dep pinned via `link:` must not be returned as a
        // version — it would be passed verbatim to npm and fail.
        let text = r#"lockfileVersion: '9.0'

importers:
  apps/web:
    dependencies:
      my-ui-lib:
        specifier: workspace:^
        version: link:../../packages/ui
"#;
        assert_eq!(parse_pnpm_lock(text, "my-ui-lib"), None);
    }

    #[test]
    fn pnpm_workspace_link_in_first_importer_does_not_block_later_real_version() {
        // First importer has a `link:` version; second has a real one. The
        // first-wins policy should skip the workspace link and capture the
        // real version.
        let text = r#"lockfileVersion: '9.0'

importers:
  apps/web:
    dependencies:
      shared:
        specifier: workspace:^
        version: link:../../packages/shared
  apps/docs:
    dependencies:
      shared:
        specifier: ^1.2.3
        version: 1.2.3
"#;
        assert_eq!(parse_pnpm_lock(text, "shared"), Some("1.2.3".into()));
    }

    #[test]
    fn pnpm_skips_link_version_in_top_level_deps() {
        let text = r#"lockfileVersion: '6.0'

dependencies:
  my-lib: link:../my-lib
"#;
        assert_eq!(parse_pnpm_lock(text, "my-lib"), None);
    }

    #[test]
    fn pnpm_skips_file_protocol_in_importer() {
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      tarball-pkg:
        specifier: file:./pkg.tgz
        version: file:pkg.tgz
"#;
        assert_eq!(parse_pnpm_lock(text, "tarball-pkg"), None);
    }

    #[test]
    fn pnpm_indent_relative_parses_4_space_indent() {
        // Not how pnpm emits, but the stack-based parser shouldn't care.
        let text = r#"lockfileVersion: '9.0'

importers:
    .:
        dependencies:
            zod:
                specifier: ^3.22.0
                version: 3.22.0
"#;
        assert_eq!(parse_pnpm_lock(text, "zod"), Some("3.22.0".into()));
    }

    // ---- pnpm: transitive resolution ----

    #[test]
    fn pnpm_transitive_via_snapshots() {
        // foo is transitively reachable from root dep next via snapshots graph.
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      next:
        specifier: ^14
        version: 14.0.0(react@18.2.0)

packages:

  foo@1.0.0:
    resolution: {}

  next@14.0.0:
    resolution: {}

  react@18.2.0:
    resolution: {}

snapshots:

  foo@1.0.0: {}

  next@14.0.0(react@18.2.0):
    dependencies:
      foo: 1.0.0
      react: 18.2.0

  react@18.2.0: {}
"#;
        assert_eq!(parse_pnpm_lock(text, "foo"), Some("1.0.0".into()));
    }

    #[test]
    fn pnpm_transitive_picks_reachable_version_among_multiple() {
        // Two react versions exist in snapshots; only 18.2.0 is reachable
        // from the root. BFS must pick 18.2.0, not the lexicographically-
        // first one (17.0.0).
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      next:
        specifier: ^14
        version: 14.0.0(react@18.2.0)

snapshots:

  next@14.0.0(react@18.2.0):
    dependencies:
      react: 18.2.0

  react@17.0.0: {}

  react@18.2.0: {}
"#;
        assert_eq!(parse_pnpm_lock(text, "react"), Some("18.2.0".into()));
    }

    #[test]
    fn pnpm_transitive_falls_back_to_packages_when_unreachable() {
        // `unused` isn't reachable from any root; should fall back to the
        // first matching `packages:` key.
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      zod:
        specifier: ^3
        version: 3.22.0

packages:

  unused@9.9.9:
    resolution: {}

  zod@3.22.0:
    resolution: {}

snapshots:

  zod@3.22.0: {}
"#;
        assert_eq!(parse_pnpm_lock(text, "unused"), Some("9.9.9".into()));
    }

    #[test]
    fn pnpm_transitive_handles_cycles() {
        // a → b → a cycle; looking up a non-cyclic pkg should still work.
        let text = r#"lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      a:
        specifier: ^1
        version: 1.0.0

snapshots:

  a@1.0.0:
    dependencies:
      b: 1.0.0

  b@1.0.0:
    dependencies:
      a: 1.0.0
      target: 2.0.0

  target@2.0.0: {}
"#;
        assert_eq!(parse_pnpm_lock(text, "target"), Some("2.0.0".into()));
    }

    // ---- yarn (preserved) ----

    #[test]
    fn yarn_v1_single_specifier() {
        let text = "# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT DIRECTLY.\n\
# yarn lockfile v1\n\
\n\
\n\
\"zod@^3.22.0\":\n  \
version \"3.22.0\"\n  \
resolved \"https://registry.yarnpkg.com/zod/-/zod-3.22.0.tgz\"\n";
        assert_eq!(parse_yarn_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn yarn_v1_multi_specifier_match_not_first() {
        let text = "# yarn lockfile v1\n\
\n\
\n\
\"foo@^1.0.0\":\n  \
version \"1.0.0\"\n\
\n\
\"bar@^1.0.0\", \"bar@~1.2.0\":\n  \
version \"1.2.3\"\n";
        assert_eq!(parse_yarn_lock(text, "bar"), Some("1.2.3".into()));
    }

    #[test]
    fn yarn_v1_scoped_package() {
        let text = "# yarn lockfile v1\n\
\n\
\n\
\"@scope/pkg@^1.0.0\":\n  \
version \"1.0.0\"\n";
        assert_eq!(parse_yarn_lock(text, "@scope/pkg"), Some("1.0.0".into()));
    }

    #[test]
    fn yarn_berry_npm_protocol() {
        let text = "# This file is generated by running \"yarn install\".\n\
\n\
__metadata:\n  \
version: 6\n  \
cacheKey: 8\n\
\n\
\"zod@npm:^3.22.0\":\n  \
version: 3.22.0\n  \
resolution: \"zod@npm:3.22.0\"\n";
        assert_eq!(parse_yarn_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn yarn_berry_comma_separated_specifiers() {
        let text = "__metadata:\n  \
version: 6\n\
\n\
\"foo@npm:^1.0.0, foo@workspace:*\":\n  \
version: 1.2.3\n  \
resolution: \"foo@npm:1.2.3\"\n";
        assert_eq!(parse_yarn_lock(text, "foo"), Some("1.2.3".into()));
    }

    #[test]
    fn yarn_berry_scoped_package() {
        let text = "__metadata:\n  \
version: 6\n\
\n\
\"@scope/pkg@npm:^1.0.0\":\n  \
version: 1.2.3\n";
        assert_eq!(parse_yarn_lock(text, "@scope/pkg"), Some("1.2.3".into()));
    }

    #[test]
    fn yarn_returns_none_when_absent() {
        let text = "# yarn lockfile v1\n\
\n\
\n\
\"foo@^1.0.0\":\n  \
version \"1.0.0\"\n";
        assert_eq!(parse_yarn_lock(text, "zod"), None);
    }

    #[test]
    fn yarn_skips_metadata_block() {
        let text = "__metadata:\n  \
version: 6\n";
        assert_eq!(parse_yarn_lock(text, "__metadata"), None);
    }

    // ---- yarn: new coverage ----

    #[test]
    fn yarn_crlf_line_endings() {
        let text = "# yarn lockfile v1\r\n\r\n\r\n\"zod@^3.22.0\":\r\n  version \"3.22.0\"\r\n";
        assert_eq!(parse_yarn_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn yarn_empty_file() {
        assert_eq!(parse_yarn_lock("", "zod"), None);
    }

    #[test]
    fn yarn_v1_inline_comment_stripped() {
        let text = "# yarn lockfile v1\n\
\n\
\n\
\"zod@^3.22.0\":\n  \
version \"3.22.0\" # pinned\n";
        assert_eq!(parse_yarn_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn yarn_berry_inline_comment_stripped() {
        let text = "__metadata:\n  \
version: 6\n\
\n\
\"zod@npm:^3.22.0\":\n  \
version: 3.22.0 # pinned\n";
        assert_eq!(parse_yarn_lock(text, "zod"), Some("3.22.0".into()));
    }

    #[test]
    fn yarn_berry_skips_workspace_root_sentinel() {
        // Yarn Berry gives the workspace root `version: 0.0.0-use.local`.
        // Returning that would make the caller try to fetch it from npm.
        let text = "__metadata:\n  \
version: 6\n\
\n\
\"myproject@workspace:.\":\n  \
version: 0.0.0-use.local\n  \
resolution: \"myproject@workspace:.\"\n";
        assert_eq!(parse_yarn_lock(text, "myproject"), None);
    }

    #[test]
    fn yarn_berry_workspace_block_does_not_block_later_real_block() {
        // A workspace self-reference should be skipped, but a real block for
        // the same name later in the file should still be found.
        let text = "__metadata:\n  \
version: 6\n\
\n\
\"foo@workspace:packages/foo\":\n  \
version: 0.0.0-use.local\n  \
resolution: \"foo@workspace:packages/foo\"\n\
\n\
\"foo@npm:^1.0.0\":\n  \
version: 1.2.3\n  \
resolution: \"foo@npm:1.2.3\"\n";
        assert_eq!(parse_yarn_lock(text, "foo"), Some("1.2.3".into()));
    }

    #[test]
    fn yarn_v1_skips_link_protocol_version() {
        // Yarn v1 can record a `file:` or linked dep with a protocol version.
        let text = "# yarn lockfile v1\n\
\n\
\n\
\"my-lib@file:../my-lib\":\n  \
version \"file:../my-lib\"\n";
        assert_eq!(parse_yarn_lock(text, "my-lib"), None);
    }

    // ---- Fixture-backed tests ----

    const YARN_V1_FIXTURE: &str = include_str!("../../tests/fixtures/yarn-v1.lock");
    const YARN_BERRY_FIXTURE: &str = include_str!("../../tests/fixtures/yarn-berry.lock");
    const PNPM_V9_FIXTURE: &str = include_str!("../../tests/fixtures/pnpm-v9-workspace.yaml");

    #[test]
    fn yarn_v1_fixture_scoped() {
        assert_eq!(
            parse_yarn_lock(YARN_V1_FIXTURE, "@babel/core"),
            Some("7.23.0".into())
        );
        assert_eq!(
            parse_yarn_lock(YARN_V1_FIXTURE, "@types/react"),
            Some("18.2.45".into())
        );
    }

    #[test]
    fn yarn_v1_fixture_multi_specifier() {
        // lodash@^4.17.21 is in a multi-specifier header.
        assert_eq!(
            parse_yarn_lock(YARN_V1_FIXTURE, "lodash"),
            Some("4.17.21".into())
        );
    }

    #[test]
    fn yarn_v1_fixture_direct_deps() {
        assert_eq!(
            parse_yarn_lock(YARN_V1_FIXTURE, "react"),
            Some("18.2.0".into())
        );
        assert_eq!(
            parse_yarn_lock(YARN_V1_FIXTURE, "typescript"),
            Some("5.3.3".into())
        );
        assert_eq!(
            parse_yarn_lock(YARN_V1_FIXTURE, "zod"),
            Some("3.22.4".into())
        );
    }

    #[test]
    fn yarn_v1_fixture_absent() {
        assert_eq!(
            parse_yarn_lock(YARN_V1_FIXTURE, "not-installed-anywhere"),
            None
        );
    }

    #[test]
    fn yarn_berry_fixture_scoped_with_npm_protocol() {
        assert_eq!(
            parse_yarn_lock(YARN_BERRY_FIXTURE, "@types/react"),
            Some("18.2.45".into())
        );
    }

    #[test]
    fn yarn_berry_fixture_comma_specifier() {
        assert_eq!(
            parse_yarn_lock(YARN_BERRY_FIXTURE, "lodash"),
            Some("4.17.21".into())
        );
    }

    #[test]
    fn yarn_berry_fixture_direct_deps() {
        assert_eq!(
            parse_yarn_lock(YARN_BERRY_FIXTURE, "react"),
            Some("18.2.0".into())
        );
        assert_eq!(
            parse_yarn_lock(YARN_BERRY_FIXTURE, "typescript"),
            Some("5.3.3".into())
        );
    }

    #[test]
    fn yarn_berry_fixture_absent() {
        assert_eq!(
            parse_yarn_lock(YARN_BERRY_FIXTURE, "not-installed-anywhere"),
            None
        );
    }

    #[test]
    fn pnpm_fixture_direct_importer_dep() {
        assert_eq!(
            parse_pnpm_lock(PNPM_V9_FIXTURE, "next"),
            Some("14.0.0".into())
        );
    }

    #[test]
    fn pnpm_fixture_scoped_direct_dep() {
        assert_eq!(
            parse_pnpm_lock(PNPM_V9_FIXTURE, "@types/react"),
            Some("18.2.45".into())
        );
    }

    #[test]
    fn pnpm_fixture_multi_importer_first_wins() {
        // apps/web (react@18.2.0) is listed before apps/legacy (react@17.0.2).
        assert_eq!(
            parse_pnpm_lock(PNPM_V9_FIXTURE, "react"),
            Some("18.2.0".into())
        );
    }

    #[test]
    fn pnpm_fixture_transitive_via_bfs() {
        // js-tokens is only reachable via loose-envify; not a direct dep.
        assert_eq!(
            parse_pnpm_lock(PNPM_V9_FIXTURE, "js-tokens"),
            Some("4.0.0".into())
        );
    }

    #[test]
    fn pnpm_fixture_transitive_scheduler_prefers_reachable_from_web() {
        // Both scheduler@0.20.2 (via legacy) and scheduler@0.23.0 (via web)
        // exist. BFS from roots in file order reaches 0.23.0 first (web is
        // declared before legacy).
        assert_eq!(
            parse_pnpm_lock(PNPM_V9_FIXTURE, "scheduler"),
            Some("0.23.0".into())
        );
    }

    #[test]
    fn pnpm_fixture_absent() {
        assert_eq!(
            parse_pnpm_lock(PNPM_V9_FIXTURE, "definitely-not-here"),
            None
        );
    }

    #[test]
    fn pnpm_fixture_top_level_typescript_dev_dep() {
        assert_eq!(
            parse_pnpm_lock(PNPM_V9_FIXTURE, "typescript"),
            Some("5.3.3".into())
        );
    }

    // ---- package.json fallback ----

    #[test]
    fn package_json_strips_range_prefix() {
        let json = r#"{"dependencies":{"zod":"^3.22.0"}}"#;
        assert_eq!(
            parse_package_json_version(json, "zod"),
            Some("3.22.0".into())
        );
    }

    #[test]
    fn package_json_reads_dev_and_peer() {
        let json = r#"{
            "devDependencies":{"typescript":"~5.3.0"},
            "peerDependencies":{"react":">=18.0.0"}
        }"#;
        assert_eq!(
            parse_package_json_version(json, "typescript"),
            Some("5.3.0".into())
        );
        assert_eq!(
            parse_package_json_version(json, "react"),
            Some("18.0.0".into())
        );
    }

    #[test]
    fn package_json_skips_workspace_protocol() {
        let json = r#"{"dependencies":{"my-lib":"workspace:*"}}"#;
        assert_eq!(parse_package_json_version(json, "my-lib"), None);
    }

    #[test]
    fn package_json_skips_link_and_file_protocols() {
        let json = r#"{
            "dependencies":{
                "linked":"link:../linked",
                "tarball":"file:./pkg.tgz"
            }
        }"#;
        assert_eq!(parse_package_json_version(json, "linked"), None);
        assert_eq!(parse_package_json_version(json, "tarball"), None);
    }

    #[test]
    fn package_json_skips_git_and_github_protocols() {
        let json = r#"{
            "dependencies":{
                "from-github":"github:owner/repo#v1.0.0",
                "from-git":"git+https://example.com/repo.git"
            }
        }"#;
        assert_eq!(parse_package_json_version(json, "from-github"), None);
        assert_eq!(parse_package_json_version(json, "from-git"), None);
    }

    #[test]
    fn package_json_absent_returns_none() {
        let json = r#"{"dependencies":{"zod":"^3.22.0"}}"#;
        assert_eq!(parse_package_json_version(json, "not-there"), None);
    }

    #[test]
    fn package_json_invalid_json_returns_none() {
        assert_eq!(parse_package_json_version("not json", "zod"), None);
    }
}
