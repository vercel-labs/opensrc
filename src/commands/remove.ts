import {
  removePackageSource,
  removeRepoSource,
  repoExists,
  listSources,
  getPackageInfo,
} from "../lib/git.js";
import {
  updateAgentsMd,
  updatePackageIndex,
  type PackageEntry,
  type RepoEntry,
} from "../lib/agents.js";
import { isRepoSpec } from "../lib/repo.js";
import { getFileModificationPermission } from "../lib/settings.js";
import { detectRegistry } from "../lib/registries/index.js";
import type { Registry } from "../types.js";

export interface RemoveOptions {
  cwd?: string;
}

/**
 * Remove source code for one or more packages or repositories
 */
export async function removeCommand(
  items: string[],
  options: RemoveOptions = {},
): Promise<void> {
  const cwd = options.cwd || process.cwd();
  let removed = 0;
  let notFound = 0;

  // Track packages and repos to update in sources.json
  const removedPackages: Array<{ name: string; registry: Registry }> = [];
  const removedRepos: string[] = [];

  for (const item of items) {
    // Check if it's a repo or package based on format
    const isRepo =
      isRepoSpec(item) || (item.includes("/") && !item.includes(":"));

    if (isRepo) {
      // Try to remove as repo
      // Convert formats like "vercel/vercel" to "github.com/vercel/vercel" if needed
      let displayName = item;
      if (item.split("/").length === 2 && !item.startsWith("http")) {
        displayName = `github.com/${item}`;
      }

      if (!repoExists(displayName, cwd)) {
        // Try the item as-is (might already be full path like github.com/owner/repo)
        if (repoExists(item, cwd)) {
          displayName = item;
        } else {
          console.log(`  ⚠ ${item} not found`);
          notFound++;
          continue;
        }
      }

      const success = await removeRepoSource(displayName, cwd);

      if (success) {
        console.log(`  ✓ Removed ${displayName}`);
        removed++;
        removedRepos.push(displayName);
      } else {
        console.log(`  ✗ Failed to remove ${displayName}`);
      }
    } else {
      // Remove as package - detect registry from prefix or default to npm
      const { registry, cleanSpec } = detectRegistry(item);

      // Find the package in sources
      let pkgInfo = await getPackageInfo(cleanSpec, cwd, registry);
      let actualRegistry = registry;

      if (!pkgInfo) {
        // Try other registries if default didn't work
        const registries: Registry[] = ["npm", "pypi", "crates"];
        for (const reg of registries) {
          if (reg !== registry) {
            pkgInfo = await getPackageInfo(cleanSpec, cwd, reg);
            if (pkgInfo) {
              actualRegistry = reg;
              break;
            }
          }
        }
      }

      if (!pkgInfo) {
        console.log(`  ⚠ ${cleanSpec} not found`);
        notFound++;
        continue;
      }

      const result = await removePackageSource(cleanSpec, cwd, actualRegistry);

      if (result.removed) {
        console.log(`  ✓ Removed ${cleanSpec} (${actualRegistry})`);
        if (result.repoRemoved) {
          console.log(`    → Also removed repo (no other packages use it)`);
        }
        removed++;
        removedPackages.push({ name: cleanSpec, registry: actualRegistry });
      } else {
        console.log(`  ✗ Failed to remove ${cleanSpec}`);
      }
    }
  }

  console.log(
    `\nRemoved ${removed} source(s)${notFound > 0 ? `, ${notFound} not found` : ""}`,
  );

  // Update sources.json with remaining sources
  if (removed > 0) {
    const sources = await listSources(cwd);

    // Filter out removed packages
    const remainingPackages: PackageEntry[] = sources.packages.filter(
      (p) =>
        !removedPackages.some(
          (rp) => rp.name === p.name && rp.registry === p.registry,
        ),
    );

    // Filter out removed repos
    const remainingRepos: RepoEntry[] = sources.repos.filter(
      (r) => !removedRepos.includes(r.name),
    );

    // Check if file modifications are allowed
    const canModifyFiles = await getFileModificationPermission(cwd);

    if (canModifyFiles) {
      const agentsUpdated = await updateAgentsMd(
        { packages: remainingPackages, repos: remainingRepos },
        cwd,
      );
      if (agentsUpdated) {
        const totalRemaining = remainingPackages.length + remainingRepos.length;
        if (totalRemaining === 0) {
          console.log("✓ Removed opensrc section from AGENTS.md");
        } else {
          console.log("✓ Updated AGENTS.md");
        }
      }
    } else {
      await updatePackageIndex(
        { packages: remainingPackages, repos: remainingRepos },
        cwd,
      );
    }
  }
}
