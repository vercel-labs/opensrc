import type { RegistryResponse, ResolvedPackage } from "../../types.js";

const NPM_REGISTRY = "https://registry.npmjs.org";

/**
 * Parse an npm package specifier like "zod@3.22.0" into name and version
 */
export function parseNpmSpec(spec: string): {
  name: string;
  version?: string;
} {
  // Handle scoped packages like @babel/core@7.0.0
  if (spec.startsWith("@")) {
    const match = spec.match(/^(@[^/]+\/[^@]+)(?:@(.+))?$/);
    if (match) {
      return { name: match[1], version: match[2] };
    }
  }

  // Handle regular packages like zod@3.22.0
  const atIndex = spec.lastIndexOf("@");
  if (atIndex > 0) {
    return {
      name: spec.slice(0, atIndex),
      version: spec.slice(atIndex + 1),
    };
  }

  return { name: spec };
}

/**
 * Fetch package metadata from npm registry
 */
export async function fetchNpmPackageInfo(
  packageName: string,
): Promise<RegistryResponse> {
  const url = `${NPM_REGISTRY}/${encodeURIComponent(packageName).replace("%40", "@")}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Package "${packageName}" not found on npm`);
    }
    throw new Error(
      `Failed to fetch package info: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<RegistryResponse>;
}

/**
 * Extract repository URL from npm package metadata
 */
export function extractRepoUrl(
  info: RegistryResponse,
  version?: string,
): { url: string; directory?: string } | null {
  // Try to get repo info from specific version first, then fall back to top-level
  const versionInfo = version ? info.versions[version] : null;
  const repo = versionInfo?.repository || info.repository;

  if (!repo?.url) {
    return null;
  }

  let url = repo.url;

  // Normalize git URLs
  // git+https://github.com/user/repo.git -> https://github.com/user/repo
  // git://github.com/user/repo.git -> https://github.com/user/repo
  // git+ssh://git@github.com/user/repo.git -> https://github.com/user/repo
  url = url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^git\+ssh:\/\/git@/, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/\.git$/, "");

  // Handle GitHub shorthand
  if (url.startsWith("github:")) {
    url = `https://github.com/${url.slice(7)}`;
  }

  return {
    url,
    directory: repo.directory,
  };
}

/**
 * Get the latest version from registry response
 */
export function getLatestVersion(info: RegistryResponse): string {
  return info["dist-tags"].latest;
}

/**
 * Resolve an npm package to its repository information
 */
export async function resolveNpmPackage(
  packageName: string,
  version?: string,
): Promise<ResolvedPackage> {
  const info = await fetchNpmPackageInfo(packageName);

  // If no version specified, use latest
  const resolvedVersion = version || getLatestVersion(info);

  // Verify the version exists
  if (!info.versions[resolvedVersion]) {
    const availableVersions = Object.keys(info.versions).slice(-5).join(", ");
    throw new Error(
      `Version "${resolvedVersion}" not found for "${packageName}". ` +
        `Recent versions: ${availableVersions}`,
    );
  }

  const repo = extractRepoUrl(info, resolvedVersion);

  if (!repo) {
    throw new Error(
      `No repository URL found for "${packageName}@${resolvedVersion}". ` +
        `This package may not have its source published.`,
    );
  }

  // Determine git tag - try common patterns
  // Most packages use v1.2.3, some use 1.2.3
  const gitTag = `v${resolvedVersion}`;

  return {
    registry: "npm",
    name: packageName,
    version: resolvedVersion,
    repoUrl: repo.url,
    repoDirectory: repo.directory,
    gitTag,
  };
}

