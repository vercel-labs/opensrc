import { rm } from "fs/promises";
import { existsSync } from "fs";
import { getPackagesDir, getReposDir, listSources } from "../lib/git.js";
import { updateAgentsMd } from "../lib/agents.js";

export interface CleanOptions {
  cwd?: string;
  /** Only clean packages */
  packages?: boolean;
  /** Only clean repos */
  repos?: boolean;
}

/**
 * Remove all fetched packages and/or repositories
 */
export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const cleanPackages = options.packages || (!options.packages && !options.repos);
  const cleanRepos = options.repos || (!options.packages && !options.repos);

  let packagesRemoved = 0;
  let reposRemoved = 0;

  // Get current counts before cleaning
  const sources = await listSources(cwd);

  if (cleanPackages) {
    const packagesDir = getPackagesDir(cwd);
    if (existsSync(packagesDir)) {
      packagesRemoved = sources.packages.length;
      await rm(packagesDir, { recursive: true, force: true });
      console.log(`✓ Removed ${packagesRemoved} package(s)`);
    } else {
      console.log("No packages to remove");
    }
  }

  if (cleanRepos) {
    const reposDir = getReposDir(cwd);
    if (existsSync(reposDir)) {
      reposRemoved = sources.repos.length;
      await rm(reposDir, { recursive: true, force: true });
      console.log(`✓ Removed ${reposRemoved} repo(s)`);
    } else {
      console.log("No repos to remove");
    }
  }

  const totalRemoved = packagesRemoved + reposRemoved;

  if (totalRemoved > 0) {
    // Update sources.json and AGENTS.md
    const remainingSources = await listSources(cwd);
    await updateAgentsMd(remainingSources, cwd);

    const totalRemaining =
      remainingSources.packages.length + remainingSources.repos.length;

    if (totalRemaining === 0) {
      console.log("✓ Updated sources.json");
    }
  }

  console.log(`\nCleaned ${totalRemoved} source(s)`);
}

