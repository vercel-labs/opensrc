import { rm } from "fs/promises";
import { existsSync } from "fs";
import { getReposDir, listSources } from "../lib/git.js";
import { updateAgentsMd, type PackageEntry, type RepoEntry } from "../lib/agents.js";
import type { Registry } from "../types.js";

export interface CleanOptions {
  cwd?: string;
  /** Only clean packages (all registries) */
  packages?: boolean;
  /** Only clean repos */
  repos?: boolean;
  /** Only clean specific registry */
  registry?: Registry;
}

/**
 * Remove all fetched packages and/or repositories
 */
export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const cleanPackages =
    options.packages || (!options.packages && !options.repos);
  const cleanRepos =
    options.repos || (!options.packages && !options.repos && !options.registry);

  let packagesRemoved = 0;
  let reposRemoved = 0;

  // Get current sources
  const sources = await listSources(cwd);

  // Remaining after clean
  let remainingPackages: PackageEntry[] = [...sources.packages];
  let remainingRepos: RepoEntry[] = [...sources.repos];

  // Determine which packages to remove
  let packagesToRemove: PackageEntry[] = [];
  if (cleanPackages) {
    if (options.registry) {
      packagesToRemove = sources.packages.filter(p => p.registry === options.registry);
      remainingPackages = sources.packages.filter(p => p.registry !== options.registry);
    } else {
      packagesToRemove = sources.packages;
      remainingPackages = [];
    }
    packagesRemoved = packagesToRemove.length;
  }

  // Determine which repos to remove
  let reposToRemove: RepoEntry[] = [];
  if (cleanRepos) {
    reposToRemove = sources.repos;
    remainingRepos = [];
    reposRemoved = reposToRemove.length;
  }

  // Extract repo path from full path (removes monorepo subdirectory)
  const extractRepoPath = (fullPath: string): string => {
    const parts = fullPath.split("/");
    if (parts.length >= 4 && parts[0] === "repos") {
      return parts.slice(0, 4).join("/");
    }
    return fullPath;
  };

  // Get unique repo paths from packages being removed
  const packageRepoPaths = new Set(packagesToRemove.map(p => extractRepoPath(p.path)));
  
  // Get repo paths from repos being removed
  const repoRepoPaths = new Set(reposToRemove.map(r => r.path));

  // Get repo paths that are still needed by remaining packages
  const neededRepoPaths = new Set(remainingPackages.map(p => extractRepoPath(p.path)));

  // Combine all repo paths to potentially remove
  const allRepoPaths = new Set([...packageRepoPaths, ...repoRepoPaths]);

  // Remove repos that are no longer needed
  const reposDir = getReposDir(cwd);
  for (const repoPath of allRepoPaths) {
    if (!neededRepoPaths.has(repoPath)) {
      const fullPath = `${cwd}/opensrc/${repoPath}`;
      if (existsSync(fullPath)) {
        await rm(fullPath, { recursive: true, force: true });
      }
    }
  }

  // Clean up empty directories in repos/
  if (existsSync(reposDir)) {
    await cleanupEmptyDirs(reposDir);
  }

  // Summary
  if (cleanPackages) {
    if (options.registry) {
      console.log(`✓ Removed ${packagesRemoved} ${options.registry} package(s)`);
    } else if (packagesRemoved > 0) {
      console.log(`✓ Removed ${packagesRemoved} package(s)`);
    } else {
      console.log("No packages to remove");
    }
  }

  if (cleanRepos) {
    if (reposRemoved > 0) {
      console.log(`✓ Removed ${reposRemoved} repo(s)`);
    } else {
      console.log("No repos to remove");
    }
  }

  const totalRemoved = packagesRemoved + reposRemoved;

  if (totalRemoved > 0) {
    // Update sources.json and AGENTS.md
    await updateAgentsMd({ packages: remainingPackages, repos: remainingRepos }, cwd);

    const totalRemaining = remainingPackages.length + remainingRepos.length;

    if (totalRemaining === 0) {
      console.log("✓ Updated sources.json");
    }
  }

  console.log(`\nCleaned ${totalRemoved} source(s)`);
}

/**
 * Recursively clean up empty directories
 */
async function cleanupEmptyDirs(dir: string): Promise<boolean> {
  const { readdir, rmdir } = await import("fs/promises");
  
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    // Recursively clean subdirectories first
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subdir = `${dir}/${entry.name}`;
        await cleanupEmptyDirs(subdir);
      }
    }
    
    // Check if directory is now empty
    const remaining = await readdir(dir);
    if (remaining.length === 0) {
      await rmdir(dir);
      return true;
    }
  } catch {
    // Ignore errors
  }
  
  return false;
}
