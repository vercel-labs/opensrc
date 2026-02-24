import { simpleGit, SimpleGit } from "simple-git";
import { rm, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type {
  ResolvedPackage,
  ResolvedRepo,
  FetchResult,
  Registry,
} from "../types.js";

const OPENSRC_DIR = "opensrc";
const REPOS_DIR = "repos";
const SOURCES_FILE = "sources.json";

/**
 * Get the opensrc directory path
 */
export function getOpensrcDir(cwd: string = process.cwd()): string {
  return join(cwd, OPENSRC_DIR);
}

/**
 * Get the repos directory path
 */
export function getReposDir(cwd: string = process.cwd()): string {
  return join(getOpensrcDir(cwd), REPOS_DIR);
}

/**
 * Extract host/owner/repo from a git URL
 */
export function parseRepoUrl(
  url: string,
): { host: string; owner: string; repo: string } | null {
  // Handle HTTPS URLs: https://github.com/owner/repo
  const httpsMatch = url.match(/https?:\/\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (httpsMatch) {
    return {
      host: httpsMatch[1],
      owner: httpsMatch[2],
      repo: httpsMatch[3].replace(/\.git$/, ""),
    };
  }

  // Handle SSH URLs: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@([^:]+):([^/]+)\/(.+)/);
  if (sshMatch) {
    return {
      host: sshMatch[1],
      owner: sshMatch[2],
      repo: sshMatch[3].replace(/\.git$/, ""),
    };
  }

  return null;
}

/**
 * Get the path where a repo's source will be stored
 */
export function getRepoPath(
  displayName: string,
  cwd: string = process.cwd(),
): string {
  return join(getReposDir(cwd), displayName);
}

/**
 * Get the relative path for a repo (for sources.json)
 */
export function getRepoRelativePath(displayName: string): string {
  return `${REPOS_DIR}/${displayName}`;
}

/**
 * Get repo display name from URL
 */
export function getRepoDisplayName(repoUrl: string): string | null {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return null;
  return `${parsed.host}/${parsed.owner}/${parsed.repo}`;
}

interface PackageEntry {
  name: string;
  version: string;
  registry: Registry;
  path: string;
  fetchedAt: string;
}

interface RepoEntry {
  name: string;
  version: string;
  path: string;
  fetchedAt: string;
}

/**
 * Read the sources.json file
 */
async function readSourcesJson(cwd: string): Promise<{
  packages?: PackageEntry[];
  repos?: RepoEntry[];
} | null> {
  const sourcesPath = join(getOpensrcDir(cwd), SOURCES_FILE);

  if (!existsSync(sourcesPath)) {
    return null;
  }

  try {
    const content = await readFile(sourcesPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Check if a repo source already exists
 */
export function repoExists(
  displayName: string,
  cwd: string = process.cwd(),
): boolean {
  return existsSync(getRepoPath(displayName, cwd));
}

/**
 * Check if a package's repo already exists
 */
export function packageRepoExists(
  repoUrl: string,
  cwd: string = process.cwd(),
): boolean {
  const displayName = getRepoDisplayName(repoUrl);
  if (!displayName) return false;
  return repoExists(displayName, cwd);
}

/**
 * Get package info from sources.json
 */
export async function getPackageInfo(
  packageName: string,
  cwd: string = process.cwd(),
  registry: Registry = "npm",
): Promise<PackageEntry | null> {
  const sources = await readSourcesJson(cwd);
  if (!sources?.packages) {
    return null;
  }

  return (
    sources.packages.find(
      (p) => p.name === packageName && p.registry === registry,
    ) || null
  );
}

/**
 * Get repo info from sources.json
 */
export async function getRepoInfo(
  displayName: string,
  cwd: string = process.cwd(),
): Promise<RepoEntry | null> {
  const sources = await readSourcesJson(cwd);
  if (!sources?.repos) {
    return null;
  }

  return sources.repos.find((r) => r.name === displayName) || null;
}

/**
 * Try to clone at a specific tag, with fallbacks
 */
async function cloneAtTag(
  git: SimpleGit,
  repoUrl: string,
  targetPath: string,
  version: string,
): Promise<{ success: boolean; tag?: string; error?: string }> {
  const tagsToTry = [`v${version}`, version, `${version}`];

  for (const tag of tagsToTry) {
    try {
      await git.clone(repoUrl, targetPath, [
        "--depth",
        "1",
        "--branch",
        tag,
        "--single-branch",
      ]);
      return { success: true, tag };
    } catch {
      continue;
    }
  }

  // If no tag worked, clone default branch with a warning
  try {
    await git.clone(repoUrl, targetPath, ["--depth", "1"]);
    return {
      success: true,
      tag: "HEAD",
      error: `Could not find tag for version ${version}, cloned default branch instead`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to clone repository: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Clone a repository at a specific ref (branch, tag, or commit)
 */
async function cloneAtRef(
  git: SimpleGit,
  repoUrl: string,
  targetPath: string,
  ref: string,
): Promise<{ success: boolean; ref?: string; error?: string }> {
  try {
    await git.clone(repoUrl, targetPath, [
      "--depth",
      "1",
      "--branch",
      ref,
      "--single-branch",
    ]);
    return { success: true, ref };
  } catch {
    // Ref might be a commit or doesn't exist as a branch/tag
  }

  // Clone default branch
  try {
    await git.clone(repoUrl, targetPath, ["--depth", "1"]);
    return {
      success: true,
      ref: "HEAD",
      error: `Could not find ref "${ref}", cloned default branch instead`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to clone repository: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Fetch source code for a resolved package
 */
export async function fetchSource(
  resolved: ResolvedPackage,
  cwd: string = process.cwd(),
): Promise<FetchResult> {
  const git = simpleGit();

  // Get repo display name from URL
  const repoDisplayName = getRepoDisplayName(resolved.repoUrl);
  if (!repoDisplayName) {
    return {
      package: resolved.name,
      version: resolved.version,
      path: "",
      success: false,
      error: `Could not parse repository URL: ${resolved.repoUrl}`,
      registry: resolved.registry,
    };
  }

  const repoPath = getRepoPath(repoDisplayName, cwd);
  const reposDir = getReposDir(cwd);

  // Ensure repos directory exists
  if (!existsSync(reposDir)) {
    await mkdir(reposDir, { recursive: true });
  }

  // Remove existing if present (re-fetch at potentially different version)
  if (existsSync(repoPath)) {
    await rm(repoPath, { recursive: true, force: true });
  }

  // Ensure parent directories exist (for host/owner structure)
  const parentDir = join(repoPath, "..");
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  // Clone the repository
  const cloneResult = await cloneAtTag(
    git,
    resolved.repoUrl,
    repoPath,
    resolved.version,
  );

  if (!cloneResult.success) {
    return {
      package: resolved.name,
      version: resolved.version,
      path: getRepoRelativePath(repoDisplayName),
      success: false,
      error: cloneResult.error,
      registry: resolved.registry,
    };
  }

  // Remove .git directory to save space and avoid confusion
  const gitDir = join(repoPath, ".git");
  if (existsSync(gitDir)) {
    await rm(gitDir, { recursive: true, force: true });
  }

  // Determine the actual source path (for monorepos, include subdirectory)
  let relativePath = getRepoRelativePath(repoDisplayName);
  if (resolved.repoDirectory) {
    relativePath = `${relativePath}/${resolved.repoDirectory}`;
  }

  return {
    package: resolved.name,
    version: resolved.version,
    path: relativePath,
    success: true,
    error: cloneResult.error,
    registry: resolved.registry,
  };
}

/**
 * Fetch source code for a resolved repository
 */
export async function fetchRepoSource(
  resolved: ResolvedRepo,
  cwd: string = process.cwd(),
): Promise<FetchResult> {
  const git = simpleGit();
  const repoPath = getRepoPath(resolved.displayName, cwd);
  const reposDir = getReposDir(cwd);

  // Ensure repos directory exists
  if (!existsSync(reposDir)) {
    await mkdir(reposDir, { recursive: true });
  }

  // Remove existing if present
  if (existsSync(repoPath)) {
    await rm(repoPath, { recursive: true, force: true });
  }

  // Ensure parent directories exist (for host/owner structure)
  const parentDir = join(repoPath, "..");
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  // Clone the repository
  const cloneResult = await cloneAtRef(
    git,
    resolved.repoUrl,
    repoPath,
    resolved.ref,
  );

  if (!cloneResult.success) {
    return {
      package: resolved.displayName,
      version: resolved.ref,
      path: getRepoRelativePath(resolved.displayName),
      success: false,
      error: cloneResult.error,
    };
  }

  // Remove .git directory to save space and avoid confusion
  const gitDir = join(repoPath, ".git");
  if (existsSync(gitDir)) {
    await rm(gitDir, { recursive: true, force: true });
  }

  return {
    package: resolved.displayName,
    version: resolved.ref,
    path: getRepoRelativePath(resolved.displayName),
    success: true,
    error: cloneResult.error,
  };
}

/**
 * Extract the repo path from a full path (removes any monorepo subdirectory)
 * e.g., "repos/github.com/owner/repo/packages/sub" -> "repos/github.com/owner/repo"
 */
function extractRepoPath(fullPath: string): string {
  const parts = fullPath.split("/");
  // repos/host/owner/repo = 4 parts minimum
  if (parts.length >= 4 && parts[0] === "repos") {
    return parts.slice(0, 4).join("/");
  }
  return fullPath;
}

/**
 * Remove source code for a package (removes its repo if no other packages use it)
 */
export async function removePackageSource(
  packageName: string,
  cwd: string = process.cwd(),
  registry: Registry = "npm",
): Promise<{ removed: boolean; repoRemoved: boolean }> {
  const sources = await readSourcesJson(cwd);
  if (!sources?.packages) {
    return { removed: false, repoRemoved: false };
  }

  const pkg = sources.packages.find(
    (p) => p.name === packageName && p.registry === registry,
  );
  if (!pkg) {
    return { removed: false, repoRemoved: false };
  }

  const pkgRepoPath = extractRepoPath(pkg.path);

  // Check if other packages use the same repo
  const otherPackagesUsingSameRepo = sources.packages.filter(
    (p) =>
      extractRepoPath(p.path) === pkgRepoPath &&
      !(p.name === packageName && p.registry === registry),
  );

  let repoRemoved = false;

  // Only remove the repo if no other packages use it
  if (otherPackagesUsingSameRepo.length === 0) {
    const repoPath = join(getOpensrcDir(cwd), pkgRepoPath);
    if (existsSync(repoPath)) {
      await rm(repoPath, { recursive: true, force: true });
      repoRemoved = true;

      // Clean up empty parent directories
      await cleanupEmptyParentDirs(pkgRepoPath, cwd);
    }
  }

  return { removed: true, repoRemoved };
}

/**
 * Remove source code for a repo
 */
export async function removeRepoSource(
  displayName: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  const repoPath = getRepoPath(displayName, cwd);

  if (!existsSync(repoPath)) {
    return false;
  }

  await rm(repoPath, { recursive: true, force: true });

  // Clean up empty parent directories
  await cleanupEmptyParentDirs(getRepoRelativePath(displayName), cwd);

  return true;
}

/**
 * Clean up empty parent directories after removing a repo
 */
async function cleanupEmptyParentDirs(
  relativePath: string,
  cwd: string,
): Promise<void> {
  const parts = relativePath.split("/");
  if (parts.length < 4) return; // repos/host/owner/repo - need at least 4 parts

  const { readdir } = await import("fs/promises");
  const opensrcDir = getOpensrcDir(cwd);

  // Try to clean up owner directory (repos/host/owner)
  const ownerDir = join(opensrcDir, parts[0], parts[1], parts[2]);
  try {
    const ownerContents = await readdir(ownerDir);
    if (ownerContents.length === 0) {
      await rm(ownerDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore errors
  }

  // Try to clean up host directory (repos/host)
  const hostDir = join(opensrcDir, parts[0], parts[1]);
  try {
    const hostContents = await readdir(hostDir);
    if (hostContents.length === 0) {
      await rm(hostDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore errors
  }
}

/**
 * @deprecated Use removePackageSource instead
 */
export async function removeSource(
  packageName: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  const result = await removePackageSource(packageName, cwd, "npm");
  return result.removed;
}

/**
 * List all fetched sources from sources.json
 */
export async function listSources(cwd: string = process.cwd()): Promise<{
  packages: PackageEntry[];
  repos: RepoEntry[];
}> {
  const sources = await readSourcesJson(cwd);

  return {
    packages: sources?.packages || [],
    repos: sources?.repos || [],
  };
}
