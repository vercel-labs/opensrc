import type { ResolvedPackage } from "../../types.js";

const PACKAGIST_API = "https://repo.packagist.org/p2";

interface PackagistVersion {
  version: string;
  version_normalized: string;
  source?: {
    type: string;
    url: string;
    reference: string;
  };
  time?: string;
}

interface PackagistResponse {
  packages: {
    [packageName: string]: PackagistVersion[];
  };
}

/**
 * Parse a Packagist package specifier like "laravel/framework@11.0.0" into name and version
 */
export function parsePackagistSpec(spec: string): {
  name: string;
  version?: string;
} {
  const trimmed = spec.trim();

  // Packagist packages are in vendor/package format
  // Handle version specifier: vendor/package@1.0.0 or vendor/package:1.0.0
  const colonIndex = trimmed.lastIndexOf(":");
  const atIndex = trimmed.lastIndexOf("@");

  // Use whichever delimiter comes after the vendor/package part
  // We need to be careful with @ since it could be part of the version (like dev-main@abc123)
  // The package name always contains a /, so find that first
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) {
    return { name: trimmed };
  }

  // Check for : version separator (Composer style: vendor/package:^1.0)
  if (colonIndex > slashIndex) {
    return {
      name: trimmed.slice(0, colonIndex).trim(),
      version: trimmed.slice(colonIndex + 1).trim(),
    };
  }

  // Check for @ version separator
  if (atIndex > slashIndex) {
    return {
      name: trimmed.slice(0, atIndex).trim(),
      version: trimmed.slice(atIndex + 1).trim(),
    };
  }

  return { name: trimmed };
}

/**
 * Fetch package metadata from Packagist
 */
async function fetchPackagistInfo(
  packageName: string,
): Promise<PackagistResponse> {
  const url = `${PACKAGIST_API}/${packageName}.json`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "opensrc-cli (https://github.com/vercel-labs/opensrc)",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Package "${packageName}" not found on Packagist`);
    }
    throw new Error(
      `Failed to fetch package info: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<PackagistResponse>;
}

/**
 * Extract repository URL from package version info
 */
function extractRepoUrl(version: PackagistVersion): string | null {
  if (!version.source?.url) {
    return null;
  }

  let url = version.source.url;

  // Normalize git URLs
  url = url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^git@gitlab\.com:/, "https://gitlab.com/")
    .replace(/\.git$/, "");

  // Only return URLs from known git hosts
  if (isGitRepoUrl(url)) {
    return normalizeRepoUrl(url);
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
  return url
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/tree\/.*$/, "")
    .replace(/\/blob\/.*$/, "");
}

/**
 * Get available versions sorted by time (newest first)
 * Filters out dev versions unless specifically requested
 */
function getAvailableVersions(
  versions: PackagistVersion[],
  includeDev = false,
): PackagistVersion[] {
  return versions
    .filter((v) => {
      if (includeDev) return true;
      // Filter out dev versions (dev-*, *-dev, etc.)
      return (
        !v.version.startsWith("dev-") &&
        !v.version.endsWith("-dev") &&
        !v.version.includes("-dev@")
      );
    })
    .sort((a, b) => {
      // Sort by time if available, otherwise by version
      if (a.time && b.time) {
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      }
      return b.version_normalized.localeCompare(a.version_normalized);
    });
}

/**
 * Resolve a Packagist package to its repository information
 */
export async function resolvePackagistPackage(
  packageName: string,
  version?: string,
): Promise<ResolvedPackage> {
  const info = await fetchPackagistInfo(packageName);
  const versions = info.packages[packageName];

  if (!versions || versions.length === 0) {
    throw new Error(`No versions found for "${packageName}"`);
  }

  let resolvedVersion: PackagistVersion;

  if (version) {
    // Find the specific version requested
    // Handle both exact match and normalized match
    const normalizedRequest = version.replace(/^v/, "");
    resolvedVersion =
      versions.find(
        (v) =>
          v.version === version ||
          v.version === `v${version}` ||
          v.version_normalized === normalizedRequest ||
          v.version_normalized.startsWith(normalizedRequest + "."),
      ) ||
      versions.find((v) => v.version.includes(version)) ||
      versions[0];

    if (!resolvedVersion) {
      const availableVersions = getAvailableVersions(versions)
        .slice(0, 5)
        .map((v) => v.version)
        .join(", ");
      throw new Error(
        `Version "${version}" not found for "${packageName}". ` +
          `Recent versions: ${availableVersions}`,
      );
    }
  } else {
    // Get the latest stable version
    const stableVersions = getAvailableVersions(versions);
    resolvedVersion = stableVersions[0] || versions[0];
  }

  const repoUrl = extractRepoUrl(resolvedVersion);

  if (!repoUrl) {
    const availableVersions = getAvailableVersions(versions)
      .slice(0, 5)
      .map((v) => v.version)
      .join(", ");
    throw new Error(
      `No repository URL found for "${packageName}@${resolvedVersion.version}". ` +
        `This package may not have its source published. ` +
        `Recent versions: ${availableVersions}`,
    );
  }

  // PHP packages commonly use v1.2.3 as tags
  const gitTag = resolvedVersion.version.startsWith("v")
    ? resolvedVersion.version
    : `v${resolvedVersion.version}`;

  return {
    registry: "packagist",
    name: packageName,
    version: resolvedVersion.version,
    repoUrl,
    gitTag,
  };
}
