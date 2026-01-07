import { simpleGit, SimpleGit } from "simple-git";
import { rm, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { ResolvedPackage, ResolvedRepo, FetchResult } from "../types.js";

const OPENSRC_DIR = "opensrc";

/**
 * Get the opensrc directory path
 */
export function getOpensrcDir(cwd: string = process.cwd()): string {
  return join(cwd, OPENSRC_DIR);
}

/**
 * Get the path where a package's source will be stored
 */
export function getPackagePath(
  packageName: string,
  cwd: string = process.cwd(),
): string {
  // Handle scoped packages: @scope/name -> @scope/name (keep the structure)
  return join(getOpensrcDir(cwd), packageName);
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
  const opensrcDir = getOpensrcDir(cwd);

  // Ensure .opensrc directory exists
  if (!existsSync(opensrcDir)) {
    await mkdir(opensrcDir, { recursive: true });
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
      path: packagePath,
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
  let sourcePath = packagePath;
  if (resolved.repoDirectory) {
    sourcePath = join(packagePath, resolved.repoDirectory);
  }

  return {
    package: resolved.name,
    version: resolved.version,
    path: sourcePath,
    success: true,
    error: cloneResult.error, // May contain a warning about tag not found
  };
}

/**
 * Write metadata file for a fetched repository
 */
async function writeRepoMetadata(
  packagePath: string,
  resolved: ResolvedRepo,
): Promise<void> {
  const metadata = {
    name: resolved.displayName,
    version: resolved.ref,
    repoUrl: resolved.repoUrl,
    owner: resolved.owner,
    repo: resolved.repo,
    fetchedTag: resolved.ref,
    fetchedAt: new Date().toISOString(),
    isRepo: true,
  };

  const metadataPath = join(packagePath, ".opensrc-meta.json");
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
  const packagePath = getPackagePath(resolved.displayName, cwd);
  const opensrcDir = getOpensrcDir(cwd);

  // Ensure opensrc directory exists
  if (!existsSync(opensrcDir)) {
    await mkdir(opensrcDir, { recursive: true });
  }

  // Remove existing if present
  if (existsSync(packagePath)) {
    await rm(packagePath, { recursive: true, force: true });
  }

  // Clone the repository
  const cloneResult = await cloneAtRef(
    git,
    resolved.repoUrl,
    packagePath,
    resolved.ref,
  );

  if (!cloneResult.success) {
    return {
      package: resolved.displayName,
      version: resolved.ref,
      path: packagePath,
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
  await writeRepoMetadata(packagePath, resolved);

  return {
    package: resolved.displayName,
    version: resolved.ref,
    path: packagePath,
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
  owner: string;
  repo: string;
  fetchedTag: string;
  fetchedAt: string;
  isRepo: boolean;
} | null> {
  const packagePath = getPackagePath(displayName, cwd);
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
 * Remove source code for a package
 */
export async function removeSource(
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
    const scopeDir = join(getOpensrcDir(cwd), packageName.split("/")[0]);
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
 * List all fetched packages
 */
export async function listSources(cwd: string = process.cwd()): Promise<
  Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }>
> {
  const opensrcDir = getOpensrcDir(cwd);

  if (!existsSync(opensrcDir)) {
    return [];
  }

  const { readdir } = await import("fs/promises");
  const results: Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }> = [];

  const entries = await readdir(opensrcDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    if (entry.name.startsWith("@")) {
      // Scoped package - look inside
      const scopeDir = join(opensrcDir, entry.name);
      const scopeEntries = await readdir(scopeDir, { withFileTypes: true });

      for (const scopeEntry of scopeEntries) {
        if (!scopeEntry.isDirectory()) continue;

        const packageName = `${entry.name}/${scopeEntry.name}`;
        const metadata = await readMetadata(packageName, cwd);

        if (metadata) {
          results.push({
            name: packageName,
            version: metadata.version,
            path: getPackagePath(packageName, cwd),
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
          path: getPackagePath(entry.name, cwd),
          fetchedAt: metadata.fetchedAt,
        });
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
