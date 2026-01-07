import { parsePackageSpec, resolvePackage } from "../lib/registry.js";
import { detectInstalledVersion } from "../lib/version.js";
import { fetchSource as fetchSourceGit } from "../lib/git.js";
import { fetchSource as fetchSourceNpm, listSources } from "../lib/npm.js";
import { packageExists, readMetadata } from "../lib/common.js";
import { ensureGitignore } from "../lib/gitignore.js";
import { ensureTsconfigExclude } from "../lib/tsconfig.js";
import { updateAgentsMd } from "../lib/agents.js";
import {
  getFileModificationPermission,
  setFileModificationPermission,
} from "../lib/settings.js";
import { confirm } from "../lib/prompt.js";
import type { FetchResult } from "../types.js";

export type SourceType = "git" | "npm";

export interface FetchOptions {
  cwd?: string;
  /** Override file modification permission: true = allow, false = deny, undefined = prompt */
  allowModifications?: boolean;
  /** Source download method: git (clone from GitHub) or npm (download tarball) */
  source?: SourceType;
}

/**
 * Check if file modifications are allowed
 * Priority:
 * 1. CLI flag override (--modify / --no-modify)
 * 2. Stored preference in settings.json
 * 3. Prompt user
 */
async function checkFileModificationPermission(
  cwd: string,
  cliOverride?: boolean,
): Promise<boolean> {
  // CLI flag takes precedence
  if (cliOverride !== undefined) {
    // Save the preference for future runs
    await setFileModificationPermission(cliOverride, cwd);
    if (cliOverride) {
      console.log("✓ File modifications enabled (--modify)");
    } else {
      console.log("✗ File modifications disabled (--modify=false)");
    }
    return cliOverride;
  }

  // Check settings file for stored preference
  const storedPermission = await getFileModificationPermission(cwd);
  if (storedPermission !== undefined) {
    return storedPermission;
  }

  // Prompt user for permission
  console.log(
    "\nopensrc can update the following files for better integration:",
  );
  console.log("  • .gitignore - add opensrc/ to ignore list");
  console.log("  • tsconfig.json - exclude opensrc/ from compilation");
  console.log("  • AGENTS.md - add source code reference section\n");

  const allowed = await confirm("Allow opensrc to modify these files?");

  // Save the preference to settings.json
  await setFileModificationPermission(allowed, cwd);

  if (allowed) {
    console.log("✓ Permission granted - saved to opensrc/settings.json\n");
  } else {
    console.log("✗ Permission denied - saved to opensrc/settings.json\n");
  }

  return allowed;
}

/**
 * Fetch source code for one or more packages
 */
export async function fetchCommand(
  packages: string[],
  options: FetchOptions = {},
): Promise<FetchResult[]> {
  const cwd = options.cwd || process.cwd();
  const source = options.source || "git";
  const results: FetchResult[] = [];

  const canModifyFiles = await checkFileModificationPermission(
    cwd,
    options.allowModifications,
  );

  if (canModifyFiles) {
    const gitignoreUpdated = await ensureGitignore(cwd);
    if (gitignoreUpdated) {
      console.log("✓ Added opensrc/ to .gitignore");
    }

    const tsconfigUpdated = await ensureTsconfigExclude(cwd);
    if (tsconfigUpdated) {
      console.log("✓ Added opensrc/ to tsconfig.json exclude");
    }
  }

  for (const spec of packages) {
    const { name, version: explicitVersion } = parsePackageSpec(spec);

    console.log(`\nFetching ${name}...`);

    try {
      let version = explicitVersion;

      if (!version) {
        const installedVersion = await detectInstalledVersion(name, cwd);
        if (installedVersion) {
          version = installedVersion;
          console.log(`  → Detected installed version: ${version}`);
        } else {
          console.log(`  → No installed version found, using latest`);
        }
      } else {
        console.log(`  → Using specified version: ${version}`);
      }

      if (packageExists(name, cwd)) {
        const existingMeta = await readMetadata(name, cwd);
        if (existingMeta && existingMeta.version === version) {
          console.log(`  ✓ Already up to date (${version})`);
          results.push({
            package: name,
            version: existingMeta.version,
            path: existingMeta.repoDirectory
              ? `${cwd}/opensrc/${name}/${existingMeta.repoDirectory}`
              : `${cwd}/opensrc/${name}`,
            success: true,
          });
          continue;
        } else if (existingMeta) {
          console.log(
            `  → Updating ${existingMeta.version} → ${version || "latest"}`,
          );
        }
      }

      const resolved = await resolvePackage(name, version);
      console.log(`  → Found: ${resolved.repoUrl}`);

      if (resolved.repoDirectory) {
        console.log(`  → Monorepo path: ${resolved.repoDirectory}`);
      }

      const fetchFunc = source === "npm" ? fetchSourceNpm : fetchSourceGit;
      const sourceMsg =
        source === "npm"
          ? "Downloading from npm..."
          : `Cloning at ${resolved.gitTag}...`;
      console.log(`  → ${sourceMsg}`);
      const result = await fetchFunc(resolved, cwd);

      if (result.success) {
        console.log(`  ✓ Saved to ${result.path}`);
        if (result.error) {
          console.log(`  ⚠ ${result.error}`);
        }
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
      }

      results.push(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ Error: ${errorMessage}`);
      results.push({
        package: name,
        version: "",
        path: "",
        success: false,
        error: errorMessage,
      });
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\nDone: ${successful} succeeded, ${failed} failed`);

  if (successful > 0 && canModifyFiles) {
    const allSources = await listSources(cwd);
    const agentsUpdated = await updateAgentsMd(allSources, cwd);
    if (agentsUpdated) {
      console.log("✓ Updated AGENTS.md");
    }
  } else if (successful > 0 && !canModifyFiles) {
    const allSources = await listSources(cwd);
    const { updatePackageIndex } = await import("../lib/agents.js");
    await updatePackageIndex(allSources, cwd);
  }

  return results;
}
