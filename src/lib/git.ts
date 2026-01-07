import { simpleGit, SimpleGit } from "simple-git";
import { rm, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { ResolvedPackage, ResolvedRepo, FetchResult } from "../types.js";

const OPENSRC_DIR = "opensrc";
const PACKAGES_DIR = "packages";
const REPOS_DIR = "repos";

/**
 * Get the opensrc directory path
 */
export function getOpensrcDir(cwd: string = process.cwd()): string {
  return join(cwd, OPENSRC_DIR);
}

/**
 * Get the packages directory path
 */
export function getPackagesDir(cwd: string = process.cwd()): string {
  return join(getOpensrcDir(cwd), PACKAGES_DIR);
}

/**
 * Get the repos directory path
 */
export function getReposDir(cwd: string = process.cwd()): string {
  return join(getOpensrcDir(cwd), REPOS_DIR);
}

/**
 * Get the path where a package's source will be stored
 */
export function getPackagePath(
  packageName: string,
  cwd: string = process.cwd(),
): string {
  // Handle scoped packages: @scope/name -> @scope/name (keep the structure)
  return join(getPackagesDir(cwd), packageName);
}

/**
 * Get the relative path for a package (for sources.json)
 */
export function getPackageRelativePath(packageName: string): string {
  return `${PACKAGES_DIR}/${packageName}`;
}

/**
 * Get the path where a repo's source will be stored
 */
export function getRepoPath(
  displayName: string,
  cwd: string = process.cwd(),
): string {
  // displayName is host/owner/repo, e.g., github.com/vercel/vercel
  return join(getReposDir(cwd), displayName);
}

/**
 * Get the relative path for a repo (for sources.json)
 */
export function getRepoRelativePath(displayName: string): string {
  return `${REPOS_DIR}/${displayName}`;
}

/**
 * Check if a package source already exists
 */
export function packageExists(
  packageName: string,
  cwd: string = process.cwd(),
): boolean {
  return existsSync(getPackagePath(packageName, cwd));
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
 * Try to clone at a specific tag, with fallbacks
 */
async function cloneAtTag(
  git: SimpleGit,
  repoUrl: string,
  targetPath: string,
  version: string,
): Promise<{ success: boolean; tag?: string; error?: string }> {
  // Tags to try in order of preference
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
      // Tag doesn't exist, try next
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
 * Write metadata file about the fetched source
 */
async function writeMetadata(
  packagePath: string,
  resolved: ResolvedPackage,
  actualTag: string,
): Promise<void> {
  const metadata = {
    name: resolved.name,
    version: resolved.version,
    repoUrl: resolved.repoUrl,
    repoDirectory: resolved.repoDirectory,
    fetchedTag: actualTag,
    fetchedAt: new Date().toISOString(),
    type: "package" as const,
  };

  const metadataPath = join(packagePath, ".opensrc-meta.json");
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
}

/**
 * Read metadata for a fetched package
 */
export async function readMetadata(
  packageName: string,
  cwd: string = process.cwd(),
): Promise<{
  name: string;
  version: string;
  repoUrl: string;
  repoDirectory?: string;
  fetchedTag: string;
  fetchedAt: string;
  type?: "package" | "repo";
} | null> {
  const packagePath = getPackagePath(packageName, cwd);
  const metadataPath = join(packagePath, ".opensrc-meta.json");

  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    const content = await readFile(metadataPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
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
  const packagePath = getPackagePath(resolved.name, cwd);
  const packagesDir = getPackagesDir(cwd);

  // Ensure packages directory exists
  if (!existsSync(packagesDir)) {
    await mkdir(packagesDir, { recursive: true });
  }

  // Remove existing if present
  if (existsSync(packagePath)) {
    await rm(packagePath, { recursive: true, force: true });
  }

  // Ensure parent directory exists for scoped packages
  const parentDir = join(packagePath, "..");
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  // Clone the repository
  const cloneResult = await cloneAtTag(
    git,
    resolved.repoUrl,
    packagePath,
    resolved.version,
  );

  if (!cloneResult.success) {
    return {
      package: resolved.name,
      version: resolved.version,
      path: getPackageRelativePath(resolved.name),
      success: false,
      error: cloneResult.error,
    };
  }

  // Remove .git directory to save space and avoid confusion
  const gitDir = join(packagePath, ".git");
  if (existsSync(gitDir)) {
    await rm(gitDir, { recursive: true, force: true });
  }

  // Write metadata
  await writeMetadata(packagePath, resolved, cloneResult.tag || "HEAD");

  // Determine the actual source path (for monorepos)
  let relativePath = getPackageRelativePath(resolved.name);
  if (resolved.repoDirectory) {
    relativePath = `${relativePath}/${resolved.repoDirectory}`;
  }

  return {
    package: resolved.name,
    version: resolved.version,
    path: relativePath,
    success: true,
    error: cloneResult.error, // May contain a warning about tag not found
  };
}

/**
 * Write metadata file for a fetched repository
 */
async function writeRepoMetadata(
  repoPath: string,
  resolved: ResolvedRepo,
): Promise<void> {
  const metadata = {
    name: resolved.displayName,
    version: resolved.ref,
    repoUrl: resolved.repoUrl,
    host: resolved.host,
    owner: resolved.owner,
    repo: resolved.repo,
    fetchedTag: resolved.ref,
    fetchedAt: new Date().toISOString(),
    type: "repo" as const,
  };

  const metadataPath = join(repoPath, ".opensrc-meta.json");
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
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
  // Try to clone with the specified ref first
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
    // Fall back to default branch
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
 * Fetch source code for a resolved GitHub repository
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

  // Write metadata
  await writeRepoMetadata(repoPath, resolved);

  return {
    package: resolved.displayName,
    version: resolved.ref,
    path: getRepoRelativePath(resolved.displayName),
    success: true,
    error: cloneResult.error, // May contain a warning about ref not found
  };
}

/**
 * Check if a repo source already exists and get its metadata
 */
export async function readRepoMetadata(
  displayName: string,
  cwd: string = process.cwd(),
): Promise<{
  name: string;
  version: string;
  repoUrl: string;
  host: string;
  owner: string;
  repo: string;
  fetchedTag: string;
  fetchedAt: string;
  type: "repo";
} | null> {
  const repoPath = getRepoPath(displayName, cwd);
  const metadataPath = join(repoPath, ".opensrc-meta.json");

  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    const content = await readFile(metadataPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Remove source code for a package
 */
export async function removePackageSource(
  packageName: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  const packagePath = getPackagePath(packageName, cwd);

  if (!existsSync(packagePath)) {
    return false;
  }

  await rm(packagePath, { recursive: true, force: true });

  // Clean up empty parent directories (for scoped packages)
  if (packageName.startsWith("@")) {
    const scopeDir = join(getPackagesDir(cwd), packageName.split("/")[0]);
    try {
      const { readdir } = await import("fs/promises");
      const contents = await readdir(scopeDir);
      if (contents.length === 0) {
        await rm(scopeDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors cleaning up scope dir
    }
  }

  return true;
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

  // Clean up empty parent directories (host/owner)
  const parts = displayName.split("/");
  if (parts.length === 3) {
    const { readdir } = await import("fs/promises");
    const reposDir = getReposDir(cwd);

    // Try to clean up owner directory
    const ownerDir = join(reposDir, parts[0], parts[1]);
    try {
      const ownerContents = await readdir(ownerDir);
      if (ownerContents.length === 0) {
        await rm(ownerDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors
    }

    // Try to clean up host directory
    const hostDir = join(reposDir, parts[0]);
    try {
      const hostContents = await readdir(hostDir);
      if (hostContents.length === 0) {
        await rm(hostDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors
    }
  }

  return true;
}

/**
 * @deprecated Use removePackageSource instead
 */
export async function removeSource(
  packageName: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  return removePackageSource(packageName, cwd);
}

/**
 * List all fetched packages
 */
export async function listPackages(cwd: string = process.cwd()): Promise<
  Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }>
> {
  const packagesDir = getPackagesDir(cwd);

  if (!existsSync(packagesDir)) {
    return [];
  }

  const { readdir } = await import("fs/promises");
  const results: Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }> = [];

  const entries = await readdir(packagesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    if (entry.name.startsWith("@")) {
      // Scoped package - look inside
      const scopeDir = join(packagesDir, entry.name);
      const scopeEntries = await readdir(scopeDir, { withFileTypes: true });

      for (const scopeEntry of scopeEntries) {
        if (!scopeEntry.isDirectory()) continue;

        const packageName = `${entry.name}/${scopeEntry.name}`;
        const metadata = await readMetadata(packageName, cwd);

        if (metadata) {
          results.push({
            name: packageName,
            version: metadata.version,
            path: getPackageRelativePath(packageName),
            fetchedAt: metadata.fetchedAt,
          });
        }
      }
    } else {
      // Regular package
      const metadata = await readMetadata(entry.name, cwd);

      if (metadata) {
        results.push({
          name: entry.name,
          version: metadata.version,
          path: getPackageRelativePath(entry.name),
          fetchedAt: metadata.fetchedAt,
        });
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List all fetched repos
 */
export async function listRepos(cwd: string = process.cwd()): Promise<
  Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }>
> {
  const reposDir = getReposDir(cwd);

  if (!existsSync(reposDir)) {
    return [];
  }

  const { readdir } = await import("fs/promises");
  const results: Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }> = [];

  // Recursively find all .opensrc-meta.json files in repos/
  async function scanDir(dir: string, depth: number = 0): Promise<void> {
    if (depth > 3) return; // host/owner/repo = 3 levels

    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const fullPath = join(dir, entry.name);
      const metadataPath = join(fullPath, ".opensrc-meta.json");

      if (existsSync(metadataPath)) {
        try {
          const content = await readFile(metadataPath, "utf-8");
          const metadata = JSON.parse(content);
          if (metadata.type === "repo") {
            results.push({
              name: metadata.name,
              version: metadata.version,
              path: getRepoRelativePath(metadata.name),
              fetchedAt: metadata.fetchedAt,
            });
          }
        } catch {
          // Ignore invalid metadata
        }
      } else {
        // Keep scanning subdirectories
        await scanDir(fullPath, depth + 1);
      }
    }
  }

  await scanDir(reposDir);

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List all fetched sources (packages + repos)
 */
export async function listSources(cwd: string = process.cwd()): Promise<{
  packages: Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }>;
  repos: Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }>;
}> {
  const [packages, repos] = await Promise.all([
    listPackages(cwd),
    listRepos(cwd),
  ]);

  return { packages, repos };
}
