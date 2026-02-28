import type { ResolvedPackage } from "../../types.js";

const MAVEN_CENTRAL_SEARCH = "https://search.maven.org/solrsearch/select";
const MAVEN_CENTRAL_REPO = "https://repo1.maven.org/maven2";

interface MavenSearchDoc {
  id: string;
  g: string; // groupId
  a: string; // artifactId
  latestVersion: string;
  repositoryId: string;
}

interface MavenSearchResponse {
  response: {
    numFound: number;
    docs: MavenSearchDoc[];
  };
}

interface MavenVersionDoc {
  id: string;
  g: string;
  a: string;
  v: string;
}

interface MavenVersionSearchResponse {
  response: {
    numFound: number;
    docs: MavenVersionDoc[];
  };
}

/**
 * Parse a Maven package specifier.
 *
 * Supported formats:
 *   groupId:artifactId                    (latest version)
 *   groupId:artifactId:version            (Maven-native colon separator)
 *   groupId:artifactId@version            (consistent with other registries)
 *
 * Examples:
 *   org.springframework:spring-core
 *   org.springframework:spring-core:6.1.0
 *   com.fasterxml.jackson.core:jackson-databind@2.16.0
 */
export function parseMavenSpec(spec: string): {
  groupId: string;
  artifactId: string;
  version?: string;
} {
  const trimmed = spec.trim();

  // Split on @ first (version separator consistent with other registries)
  const atIdx = trimmed.lastIndexOf("@");
  let coords: string;
  let version: string | undefined;

  if (atIdx > 0) {
    coords = trimmed.slice(0, atIdx);
    version = trimmed.slice(atIdx + 1).trim() || undefined;
  } else {
    coords = trimmed;
  }

  // coords should be groupId:artifactId or groupId:artifactId:version
  const parts = coords.split(":");

  if (parts.length < 2) {
    throw new Error(
      `Invalid Maven specifier "${spec}". Expected format: groupId:artifactId or groupId:artifactId:version`,
    );
  }

  const groupId = parts[0].trim();
  const artifactId = parts[1].trim();

  // If version given as third colon-separated segment (Maven native), prefer it
  if (!version && parts[2]) {
    version = parts[2].trim() || undefined;
  }

  if (!groupId || !artifactId) {
    throw new Error(
      `Invalid Maven specifier "${spec}". groupId and artifactId must not be empty.`,
    );
  }

  return { groupId, artifactId, version };
}

/**
 * Convert groupId to path segments (dots → slashes).
 * e.g. "org.springframework" → "org/springframework"
 */
function groupIdToPath(groupId: string): string {
  return groupId.replace(/\./g, "/");
}

/**
 * Fetch latest version from Maven Central Search API.
 */
async function fetchLatestVersion(
  groupId: string,
  artifactId: string,
): Promise<string> {
  const query = encodeURIComponent(`g:"${groupId}" AND a:"${artifactId}"`);
  const url = `${MAVEN_CENTRAL_SEARCH}?q=${query}&rows=1&wt=json`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to query Maven Central: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as MavenSearchResponse;

  if (data.response.numFound === 0 || data.response.docs.length === 0) {
    throw new Error(
      `Artifact "${groupId}:${artifactId}" not found on Maven Central`,
    );
  }

  return data.response.docs[0].latestVersion;
}

/**
 * Verify a specific version exists on Maven Central.
 */
async function verifyVersion(
  groupId: string,
  artifactId: string,
  version: string,
): Promise<void> {
  const query = encodeURIComponent(
    `g:"${groupId}" AND a:"${artifactId}" AND v:"${version}"`,
  );
  const url = `${MAVEN_CENTRAL_SEARCH}?q=${query}&rows=1&wt=json&core=gav`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to query Maven Central: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as MavenVersionSearchResponse;

  if (data.response.numFound === 0) {
    // Fetch available versions for a helpful error message
    const recentVersions = await fetchRecentVersions(groupId, artifactId);
    throw new Error(
      `Version "${version}" not found for "${groupId}:${artifactId}". ` +
        `Recent versions: ${recentVersions.join(", ")}`,
    );
  }
}

/**
 * Fetch recent versions for error messages.
 */
async function fetchRecentVersions(
  groupId: string,
  artifactId: string,
): Promise<string[]> {
  const query = encodeURIComponent(`g:"${groupId}" AND a:"${artifactId}"`);
  const url = `${MAVEN_CENTRAL_SEARCH}?q=${query}&rows=5&wt=json&core=gav`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) return [];

  const data = (await response.json()) as MavenVersionSearchResponse;
  return data.response.docs.map((d) => d.v);
}

/**
 * Fetch and parse the POM file to extract SCM info.
 *
 * Returns the normalized repository URL and the explicit git tag from
 * <scm><tag> if present (Maven's SCM plugin writes the exact release tag).
 *
 * POM files are XML. We use targeted regex to avoid adding an XML
 * parser dependency — the <scm> block is well-structured enough.
 */
async function fetchScmInfo(
  groupId: string,
  artifactId: string,
  version: string,
): Promise<{ repoUrl: string; scmTag?: string } | null> {
  const groupPath = groupIdToPath(groupId);
  const pomUrl = `${MAVEN_CENTRAL_REPO}/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`;

  const response = await fetch(pomUrl);
  if (!response.ok) return null;

  const pom = await response.text();

  // Extract <scm> block
  const scmMatch = pom.match(/<scm>([\s\S]*?)<\/scm>/);
  if (!scmMatch) return null;

  const scmBlock = scmMatch[1];

  // Extract explicit <tag> element — this is the exact git tag used for the release
  const tagMatch = scmBlock.match(/<tag>(.*?)<\/tag>/);
  const scmTag =
    tagMatch && tagMatch[1].trim() !== "HEAD"
      ? tagMatch[1].trim()
      : undefined;

  // Extract URL — prefer <connection>/<developerConnection> for accuracy
  // since <url> sometimes includes artifact subdirectory paths (e.g. Netty).
  // Connection strings go through normalizeScmUrl which handles all protocol variants.
  const connMatch = scmBlock.match(/<connection>(.*?)<\/connection>/);
  if (connMatch) {
    const url = normalizeScmUrl(connMatch[1].trim());
    if (url && isGitRepoUrl(url)) return { repoUrl: url, scmTag };
  }

  const devConnMatch = scmBlock.match(
    /<developerConnection>(.*?)<\/developerConnection>/,
  );
  if (devConnMatch) {
    const url = normalizeScmUrl(devConnMatch[1].trim());
    if (url && isGitRepoUrl(url)) return { repoUrl: url, scmTag };
  }

  // Fall back to <url> — strip any trailing artifact path beyond owner/repo
  const urlMatch = scmBlock.match(/<url>(.*?)<\/url>/);
  if (urlMatch) {
    const url = normalizeScmUrl(urlMatch[1].trim());
    if (url && isGitRepoUrl(url)) return { repoUrl: url, scmTag };
  }

  return null;
}

/**
 * Normalize SCM URLs to plain HTTPS GitHub/GitLab URLs.
 *
 * Handles patterns like:
 *   scm:git:https://github.com/owner/repo.git
 *   scm:git:git://github.com/owner/repo.git
 *   scm:git:ssh://git@github.com:owner/repo.git
 *   https://github.com/owner/repo
 */
function normalizeScmUrl(raw: string): string | null {
  let url = raw;

  // Strip scm: prefix (e.g. scm:git:https://...)
  url = url.replace(/^scm:[^:]+:/, "");

  // git:// → https://
  url = url.replace(/^git:\/\//, "https://");

  // ssh://git@github.com → https://github.com
  url = url.replace(/^ssh:\/\/git@(github\.com|gitlab\.com)/, "https://$1");

  // git@github.com:owner/repo → https://github.com/owner/repo
  url = url.replace(/^git@(github\.com|gitlab\.com):/, "https://$1/");

  // Strip .git suffix and trailing slashes
  url = url.replace(/\.git$/, "").replace(/\/+$/, "");

  // Strip tree/blob subpaths and any trailing artifact directory
  // GitHub repo URLs must be exactly https://github.com/owner/repo
  url = url.replace(/\/(tree|blob)\/.*$/, "");
  const ghMatch = url.match(/^https?:\/\/(github|gitlab)\.com\/([^/]+)\/([^/]+)/);
  if (ghMatch) return `https://${ghMatch[1]}.com/${ghMatch[2]}/${ghMatch[3].replace(/\.git$/, "")}`;

  if (!url.startsWith("http")) return null;

  return url;
}

function isGitRepoUrl(url: string): boolean {
  return (
    url.includes("github.com") ||
    url.includes("gitlab.com") ||
    url.includes("bitbucket.org")
  );
}

/**
 * Resolve a Maven artifact to its repository information.
 *
 * Note on git tags: Maven projects use inconsistent tagging conventions.
 * Common patterns tried (in order by prevalence):
 *   v{version}                  e.g. v6.1.0  (Spring, modern projects)
 *   {artifactId}-{version}      e.g. jackson-databind-2.16.0
 *   {version}                   e.g. 6.1.0
 *
 * We return v{version} as the primary tag. The git clone step will
 * fall back to other patterns if this tag does not exist.
 */
export async function resolveMavenPackage(
  groupId: string,
  artifactId: string,
  version?: string,
): Promise<ResolvedPackage> {
  // Resolve version
  const resolvedVersion = version
    ? (await verifyVersion(groupId, artifactId, version), version)
    : await fetchLatestVersion(groupId, artifactId);

  // Fetch SCM info from POM (URL + optional explicit git tag)
  const scmInfo = await fetchScmInfo(groupId, artifactId, resolvedVersion);

  if (!scmInfo) {
    const recentVersions = await fetchRecentVersions(groupId, artifactId);
    throw new Error(
      `No repository URL found in POM for "${groupId}:${artifactId}:${resolvedVersion}". ` +
        `The artifact may not publish SCM information.` +
        (recentVersions.length > 0
          ? ` Recent versions: ${recentVersions.join(", ")}`
          : ""),
    );
  }

  // Git tag resolution priority:
  // 1. <scm><tag> from the POM — the exact tag used at release time (most reliable)
  // 2. {artifactId}-{version} — common legacy Java convention (e.g. jackson-databind-2.16.0)
  // 3. v{version} / {version} — tried automatically by git.ts as fallbacks
  const gitTag = scmInfo.scmTag ?? `${artifactId}-${resolvedVersion}`;

  return {
    registry: "maven",
    name: `${groupId}:${artifactId}`,
    version: resolvedVersion,
    repoUrl: scmInfo.repoUrl,
    gitTag,
  };
}
