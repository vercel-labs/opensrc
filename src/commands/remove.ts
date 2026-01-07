import {
  removePackageSource,
  removeRepoSource,
  packageExists,
  repoExists,
  listSources,
} from "../lib/git.js";
import { updateAgentsMd } from "../lib/agents.js";
import { isRepoSpec } from "../lib/repo.js";

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

  for (const item of items) {
    // Check if it's a repo or package based on format
    const isRepo = isRepoSpec(item) || item.includes("/");

    if (isRepo) {
      // Try to remove as repo first
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
      } else {
        console.log(`  ✗ Failed to remove ${displayName}`);
      }
    } else {
      // Remove as package
      if (!packageExists(item, cwd)) {
        console.log(`  ⚠ ${item} not found`);
        notFound++;
        continue;
      }

      const success = await removePackageSource(item, cwd);

      if (success) {
        console.log(`  ✓ Removed ${item}`);
        removed++;
      } else {
        console.log(`  ✗ Failed to remove ${item}`);
      }
    }
  }

  console.log(
    `\nRemoved ${removed} source(s)${notFound > 0 ? `, ${notFound} not found` : ""}`,
  );

  // Update AGENTS.md with remaining sources (or remove section if empty)
  if (removed > 0) {
    const remainingSources = await listSources(cwd);
    const agentsUpdated = await updateAgentsMd(remainingSources, cwd);
    if (agentsUpdated) {
      const totalRemaining =
        remainingSources.packages.length + remainingSources.repos.length;
      if (totalRemaining === 0) {
        console.log("✓ Removed opensrc section from AGENTS.md");
      } else {
        console.log("✓ Updated AGENTS.md");
      }
    }
  }
}
