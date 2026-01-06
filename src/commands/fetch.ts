import { parsePackageSpec, resolvePackage } from "../lib/registry.js";
import { detectInstalledVersion } from "../lib/version.js";
import {
  fetchSource,
  packageExists,
  listSources,
  readMetadata,
} from "../lib/git.js";
import { ensureGitignore } from "../lib/gitignore.js";
import { ensureTsconfigExclude } from "../lib/tsconfig.js";
import { updateAgentsMd } from "../lib/agents.js";
import type { FetchResult } from "../types.js";

export interface FetchOptions {
  cwd?: string;
}

/**
 * Fetch source code for one or more packages
 */
export async function fetchCommand(
  packages: string[],
  options: FetchOptions = {},
): Promise<FetchResult[]> {
  const cwd = options.cwd || process.cwd();
  const results: FetchResult[] = [];

  // Ensure .gitignore has opensrc/ entry
  const gitignoreUpdated = await ensureGitignore(cwd);
  if (gitignoreUpdated) {
    console.log("✓ Added opensrc/ to .gitignore");
  }

  // Ensure tsconfig.json excludes opensrc/
  const tsconfigUpdated = await ensureTsconfigExclude(cwd);
  if (tsconfigUpdated) {
    console.log("✓ Added opensrc/ to tsconfig.json exclude");
  }

  for (const spec of packages) {
    const { name, version: explicitVersion } = parsePackageSpec(spec);

    console.log(`\nFetching ${name}...`);

    try {
      // Determine target version
      let version = explicitVersion;

      if (!version) {
        // Try to detect from installed packages
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

      // Check if already exists with the same version
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

      // Resolve package info from npm registry
      console.log(`  → Resolving repository...`);
      const resolved = await resolvePackage(name, version);
      console.log(`  → Found: ${resolved.repoUrl}`);

      if (resolved.repoDirectory) {
        console.log(`  → Monorepo path: ${resolved.repoDirectory}`);
      }

      // Fetch the source
      console.log(`  → Cloning at ${resolved.gitTag}...`);
      const result = await fetchSource(resolved, cwd);

      if (result.success) {
        console.log(`  ✓ Saved to ${result.path}`);
        if (result.error) {
          // Warning message (e.g., tag not found)
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

  // Summary
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\nDone: ${successful} succeeded, ${failed} failed`);

  // Update AGENTS.md with all fetched sources
  if (successful > 0) {
    const allSources = await listSources(cwd);
    const agentsUpdated = await updateAgentsMd(allSources, cwd);
    if (agentsUpdated) {
      console.log("✓ Updated AGENTS.md");
    }
  }

  return results;
}
