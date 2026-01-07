import type { ResolvedPackage } from "../../types.js";

const CRATES_API = "https://crates.io/api/v1";

interface CrateVersion {
  num: string;
  yanked: boolean;
  created_at: string;
}

interface CrateResponse {
  crate: {
    id: string;
    name: string;
    max_version: string;
    repository?: string;
    homepage?: string;
  };
  versions: CrateVersion[];
}

interface CrateVersionResponse {
  version: {
    num: string;
    crate: string;
    yanked: boolean;
  };
}

/**
 * Parse a crates.io package specifier like "serde@1.0.0" into name and version
 */
export function parseCratesSpec(spec: string): {
  name: string;
  version?: string;
} {
  // Handle @ version specifier: serde@1.0.0
  const atIndex = spec.lastIndexOf("@");
  if (atIndex > 0) {
    return {
      name: spec.slice(0, atIndex).trim(),
      version: spec.slice(atIndex + 1).trim(),
    };
  }

  return { name: spec.trim() };
}

/**
 * Fetch crate metadata from crates.io
 */
async function fetchCrateInfo(crateName: string): Promise<CrateResponse> {
  const url = `${CRATES_API}/crates/${crateName}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "opensrc-cli (https://github.com/opensrc-labs/opensrc)",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Crate "${crateName}" not found on crates.io`);
    }
    throw new Error(
      `Failed to fetch crate info: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<CrateResponse>;
}

/**
 * Fetch specific version info from crates.io
 */
async function fetchCrateVersionInfo(
  crateName: string,
  version: string,
): Promise<CrateVersionResponse> {
  const url = `${CRATES_API}/crates/${crateName}/${version}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "opensrc-cli (https://github.com/opensrc-labs/opensrc)",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Version "${version}" not found for crate "${crateName}"`,
      );
    }
    throw new Error(
      `Failed to fetch crate version info: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<CrateVersionResponse>;
}

/**
 * Extract repository URL from crate metadata
 */
function extractRepoUrl(crate: CrateResponse["crate"]): string | null {
  // Check repository field first
  if (crate.repository && isGitRepoUrl(crate.repository)) {
    return normalizeRepoUrl(crate.repository);
  }

  // Fall back to homepage if it's a git repo
  if (crate.homepage && isGitRepoUrl(crate.homepage)) {
    return normalizeRepoUrl(crate.homepage);
  }

  return null;
}

function isGitRepoUrl(url: string): boolean {
  return (
    url.includes("github.com") ||
    url.includes("gitlab.com") ||
    url.includes("bitbucket.org")
  );
}

function normalizeRepoUrl(url: string): string {
  // Remove trailing slashes and common suffixes
  return url
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/tree\/.*$/, "")
    .replace(/\/blob\/.*$/, "");
}

/**
 * Get available versions sorted by release date (newest first)
 */
function getAvailableVersions(versions: CrateVersion[]): string[] {
  return versions
    .filter((v) => !v.yanked)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .map((v) => v.num);
}

/**
 * Resolve a crate to its repository information
 */
export async function resolveCrate(
  crateName: string,
  version?: string,
): Promise<ResolvedPackage> {
  const info = await fetchCrateInfo(crateName);

  // If version specified, verify it exists
  let resolvedVersion = version || info.crate.max_version;

  if (version) {
    await fetchCrateVersionInfo(crateName, version);
    resolvedVersion = version;
  }

  const repoUrl = extractRepoUrl(info.crate);

  if (!repoUrl) {
    const availableVersions = getAvailableVersions(info.versions)
      .slice(0, 5)
      .join(", ");
    throw new Error(
      `No repository URL found for "${crateName}@${resolvedVersion}". ` +
        `This crate may not have its source published. ` +
        `Recent versions: ${availableVersions}`,
    );
  }

  // Rust crates commonly use v1.2.3 as tags
  const gitTag = `v${resolvedVersion}`;

  return {
    registry: "crates",
    name: crateName,
    version: resolvedVersion,
    repoUrl,
    gitTag,
  };
}

