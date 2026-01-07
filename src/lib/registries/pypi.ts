import type { ResolvedPackage } from "../../types.js";

const PYPI_API = "https://pypi.org/pypi";

interface PyPIRelease {
  upload_time: string;
  yanked: boolean;
}

interface PyPIResponse {
  info: {
    name: string;
    version: string;
    home_page?: string;
    project_urls?: Record<string, string>;
    project_url?: string;
  };
  releases: Record<string, PyPIRelease[]>;
}

/**
 * Parse a PyPI package specifier like "requests==2.31.0" into name and version
 */
export function parsePyPISpec(spec: string): {
  name: string;
  version?: string;
} {
  // Handle version specifiers: requests==2.31.0 or requests>=2.31.0
  const eqMatch = spec.match(/^([^=<>!~]+)==(.+)$/);
  if (eqMatch) {
    return { name: eqMatch[1].trim(), version: eqMatch[2].trim() };
  }

  // Handle @ version specifier: requests@2.31.0
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
 * Fetch package metadata from PyPI
 */
async function fetchPyPIPackageInfo(
  packageName: string,
  version?: string,
): Promise<PyPIResponse> {
  const url = version
    ? `${PYPI_API}/${packageName}/${version}/json`
    : `${PYPI_API}/${packageName}/json`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Package "${packageName}" not found on PyPI`);
    }
    throw new Error(
      `Failed to fetch package info: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<PyPIResponse>;
}

/**
 * Extract repository URL from PyPI package metadata
 */
function extractRepoUrl(info: PyPIResponse["info"]): string | null {
  // Check project_urls for common repository keys
  const projectUrls = info.project_urls || {};
  const repoKeys = [
    "Source",
    "Source Code",
    "Repository",
    "GitHub",
    "Code",
    "Homepage",
  ];

  for (const key of repoKeys) {
    const url = projectUrls[key];
    if (url && isGitRepoUrl(url)) {
      return normalizeRepoUrl(url);
    }
  }

  // Fall back to home_page if it's a git repo
  if (info.home_page && isGitRepoUrl(info.home_page)) {
    return normalizeRepoUrl(info.home_page);
  }

  // Check all project_urls for any git repo URL
  for (const url of Object.values(projectUrls)) {
    if (isGitRepoUrl(url)) {
      return normalizeRepoUrl(url);
    }
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
 * Get available versions sorted by release date
 */
function getVersions(releases: PyPIResponse["releases"]): string[] {
  return Object.entries(releases)
    .filter(([, files]) => files.length > 0 && !files[0].yanked)
    .sort((a, b) => {
      const timeA = a[1][0]?.upload_time || "";
      const timeB = b[1][0]?.upload_time || "";
      return timeB.localeCompare(timeA);
    })
    .map(([version]) => version);
}

/**
 * Resolve a PyPI package to its repository information
 */
export async function resolvePyPIPackage(
  packageName: string,
  version?: string,
): Promise<ResolvedPackage> {
  const info = await fetchPyPIPackageInfo(packageName, version);

  const resolvedVersion = info.info.version;

  // Get available versions if we need them for error message
  let availableVersions: string[] = [];
  if (!version) {
    const fullInfo = await fetchPyPIPackageInfo(packageName);
    availableVersions = getVersions(fullInfo.releases).slice(0, 5);
  }

  const repoUrl = extractRepoUrl(info.info);

  if (!repoUrl) {
    throw new Error(
      `No repository URL found for "${packageName}@${resolvedVersion}". ` +
        `This package may not have its source published.` +
        (availableVersions.length > 0
          ? ` Recent versions: ${availableVersions.join(", ")}`
          : ""),
    );
  }

  // Python packages commonly use v1.2.3 or 1.2.3 as tags
  const gitTag = `v${resolvedVersion}`;

  return {
    registry: "pypi",
    name: packageName,
    version: resolvedVersion,
    repoUrl,
    gitTag,
  };
}

