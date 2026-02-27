import {
  detectInputType,
  parsePackageSpec,
  resolvePackage,
} from "../lib/registries/index.js";
import { parseRepoSpec, resolveRepo } from "../lib/repo.js";
import { detectInstalledVersion } from "../lib/version.js";
import {
  fetchSource,
  fetchRepoSource,
  repoExists,
  packageRepoExists,
  listSources,
  getPackageInfo,
  getRepoInfo,
  getRepoRelativePath,
  getRepoDisplayName,
} from "../lib/git.js";
import { ensureGitignore } from "../lib/gitignore.js";
import { ensureTsconfigExclude } from "../lib/tsconfig.js";
import {
  updateAgentsMd,
  updatePackageIndex,
  type PackageEntry,
  type RepoEntry,
} from "../lib/agents.js";
import {
  getFileModificationPermission,
  setFileModificationPermission,
} from "../lib/settings.js";
import { confirm } from "../lib/prompt.js";
import type { FetchResult, Registry } from "../types.js";

export interface FetchOptions {
  cwd?: string;
  /** Override file modification permission: true = allow, false = deny, undefined = prompt */
  allowModifications?: boolean;
  /** Allow prerelease versions when resolving latest NuGet packages */
  allowPrerelease?: boolean;
}

/**
 * Check if file modifications are allowed
 */
async function checkFileModificationPermission(
  cwd: string,
  cliOverride?: boolean,
): Promise<boolean> {
  if (cliOverride !== undefined) {
    await setFileModificationPermission(cliOverride, cwd);
    if (cliOverride) {
      console.log("✓ File modifications enabled (--modify)");
    } else {
      console.log("✗ File modifications disabled (--modify=false)");
    }
    return cliOverride;
  }

  const storedPermission = await getFileModificationPermission(cwd);
  if (storedPermission !== undefined) {
    return storedPermission;
  }

  console.log(
    "\nopensrc can update the following files for better integration:",
  );
  console.log("  • .gitignore - add opensrc/ to ignore list");
  console.log("  • tsconfig.json - exclude opensrc/ from compilation");
  console.log("  • AGENTS.md - add source code reference section\n");

  const allowed = await confirm("Allow opensrc to modify these files?");

  await setFileModificationPermission(allowed, cwd);

  if (allowed) {
    console.log("✓ Permission granted - saved to opensrc/settings.json\n");
  } else {
    console.log("✗ Permission denied - saved to opensrc/settings.json\n");
  }

  return allowed;
}

/**
 * Get registry display name
 */
function getRegistryLabel(registry: Registry): string {
  switch (registry) {
    case "npm":
      return "npm";
    case "pypi":
      return "PyPI";
    case "crates":
      return "crates.io";
    case "nuget":
      return "NuGet";
  }
}

/**
 * Fetch a git repository
 */
async function fetchRepoInput(spec: string, cwd: string): Promise<FetchResult> {
  const repoSpec = parseRepoSpec(spec);

  if (!repoSpec) {
    return {
      package: spec,
      version: "",
      path: "",
      success: false,
      error: `Invalid repository format: ${spec}`,
    };
  }

  const displayName = `${repoSpec.host}/${repoSpec.owner}/${repoSpec.repo}`;
  console.log(
    `\nFetching ${repoSpec.owner}/${repoSpec.repo} from ${repoSpec.host}...`,
  );

  try {
    // Check if already exists with the same ref
    if (repoExists(displayName, cwd)) {
      const existing = await getRepoInfo(displayName, cwd);
      if (existing && repoSpec.ref && existing.version === repoSpec.ref) {
        console.log(`  ✓ Already up to date (${repoSpec.ref})`);
        return {
          package: displayName,
          version: existing.version,
          path: getRepoRelativePath(displayName),
          success: true,
        };
      } else if (existing) {
        console.log(
          `  → Updating ${existing.version} → ${repoSpec.ref || "default branch"}`,
        );
      }
    }

    // Resolve repo info from API
    console.log(`  → Resolving repository...`);
    const resolved = await resolveRepo(repoSpec);
    console.log(`  → Found: ${resolved.repoUrl}`);
    console.log(`  → Ref: ${resolved.ref}`);

    // Fetch the source
    console.log(`  → Cloning at ${resolved.ref}...`);
    const result = await fetchRepoSource(resolved, cwd);

    if (result.success) {
      console.log(`  ✓ Saved to opensrc/${result.path}`);
      if (result.error) {
        console.log(`  ⚠ ${result.error}`);
      }
    } else {
      console.log(`  ✗ Failed: ${result.error}`);
    }

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ Error: ${errorMessage}`);
    return {
      package: displayName,
      version: "",
      path: "",
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Fetch a package from any registry
 */
async function fetchPackageInput(
  spec: string,
  cwd: string,
  options: FetchOptions,
): Promise<FetchResult> {
  const packageSpec = parsePackageSpec(spec);
  const { registry, name } = packageSpec;
  let { version } = packageSpec;

  const registryLabel = getRegistryLabel(registry);
  console.log(`\nFetching ${name} from ${registryLabel}...`);

  try {
    // For npm, try to detect installed version if not specified
    if (!version && registry === "npm") {
      const installedVersion = await detectInstalledVersion(name, cwd);
      if (installedVersion) {
        version = installedVersion;
        console.log(`  → Detected installed version: ${version}`);
      } else {
        console.log(`  → No installed version found, using latest`);
      }
    } else if (!version) {
      console.log(`  → Using latest version`);
    } else {
      console.log(`  → Using specified version: ${version}`);
    }

    // Check if already exists with the same version
    const existingPkg = await getPackageInfo(name, cwd, registry);
    if (existingPkg && existingPkg.version === version) {
      console.log(`  ✓ Already up to date (${version})`);
      return {
        package: name,
        version: existingPkg.version,
        path: existingPkg.path,
        success: true,
        registry,
      };
    } else if (existingPkg) {
      console.log(
        `  → Updating ${existingPkg.version} → ${version || "latest"}`,
      );
    }

    // Resolve package info from registry
    console.log(`  → Resolving repository...`);
    const resolved = await resolvePackage({
      registry,
      name,
      version,
      allowPrerelease: options.allowPrerelease,
    });

    const repoDisplayName = getRepoDisplayName(resolved.repoUrl);
    console.log(`  → Found: ${resolved.repoUrl}`);

    if (resolved.repoDirectory) {
      console.log(`  → Monorepo path: ${resolved.repoDirectory}`);
    }

    // Check if the repo already exists (might be shared with another package)
    if (packageRepoExists(resolved.repoUrl, cwd)) {
      console.log(`  → Repo already cloned, checking version...`);
    }

    // Fetch the source
    console.log(`  → Cloning at ${resolved.gitTag}...`);
    const result = await fetchSource(resolved, cwd);

    if (result.success) {
      console.log(`  ✓ Saved to opensrc/${result.path}`);
      if (result.error) {
        console.log(`  ⚠ ${result.error}`);
      }
    } else {
      console.log(`  ✗ Failed: ${result.error}`);
    }

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ Error: ${errorMessage}`);
    return {
      package: name,
      version: "",
      path: "",
      success: false,
      error: errorMessage,
      registry,
    };
  }
}

/**
 * Merge new results into existing sources
 */
function mergeResults(
  existing: {
    packages: PackageEntry[];
    repos: RepoEntry[];
  },
  results: FetchResult[],
): {
  packages: PackageEntry[];
  repos: RepoEntry[];
} {
  const now = new Date().toISOString();

  for (const result of results) {
    if (!result.success) continue;

    if (result.registry) {
      // It's a package
      const idx = existing.packages.findIndex(
        (p) => p.name === result.package && p.registry === result.registry,
      );
      const entry: PackageEntry = {
        name: result.package,
        version: result.version,
        registry: result.registry,
        path: result.path,
        fetchedAt: now,
      };

      if (idx >= 0) {
        existing.packages[idx] = entry;
      } else {
        existing.packages.push(entry);
      }
    } else {
      // It's a repo
      const idx = existing.repos.findIndex((r) => r.name === result.package);
      const entry: RepoEntry = {
        name: result.package,
        version: result.version,
        path: result.path,
        fetchedAt: now,
      };

      if (idx >= 0) {
        existing.repos[idx] = entry;
      } else {
        existing.repos.push(entry);
      }
    }
  }

  return existing;
}

/**
 * Fetch source code for one or more packages or repositories
 */
export async function fetchCommand(
  packages: string[],
  options: FetchOptions = {},
): Promise<FetchResult[]> {
  const cwd = options.cwd || process.cwd();
  const results: FetchResult[] = [];

  // Check if we're allowed to modify files
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
    const inputType = detectInputType(spec);

    if (inputType === "repo") {
      const result = await fetchRepoInput(spec, cwd);
      results.push(result);
    } else {
      const result = await fetchPackageInput(spec, cwd, options);
      results.push(result);
    }
  }

  // Summary
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`\nDone: ${successful.length} succeeded, ${failed.length} failed`);

  if (successful.length > 0) {
    console.log("\nSource code available at:");
    for (const result of successful) {
      console.log(`  ${result.package} → opensrc/${result.path}`);
    }
  }

  // Update sources.json with all fetched sources
  if (successful.length > 0) {
    const existingSources = await listSources(cwd);
    const mergedSources = mergeResults(existingSources, results);

    if (canModifyFiles) {
      const agentsUpdated = await updateAgentsMd(mergedSources, cwd);
      if (agentsUpdated) {
        console.log("✓ Updated AGENTS.md");
      }
    } else {
      await updatePackageIndex(mergedSources, cwd);
    }
  }

  return results;
}
