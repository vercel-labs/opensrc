import { listSources } from "../lib/git.js";
import type { Registry } from "../types.js";
import { fetchCommand } from "./fetch.js";

export interface UpdateOptions {
  cwd?: string;
  /** Only update packages (all registries) */
  packages?: boolean;
  /** Only update repos */
  repos?: boolean;
  /** Only update specific registry */
  registry?: Registry;
  /** Override file modification permission */
  allowModifications?: boolean;
}

type Sources = Awaited<ReturnType<typeof listSources>>;

function shouldUpdatePackages(options: UpdateOptions): boolean {
  return options.packages || (!options.packages && !options.repos);
}

function shouldUpdateRepos(options: UpdateOptions): boolean {
  return (
    options.repos || (!options.packages && !options.repos && !options.registry)
  );
}

function buildRepoSpec(name: string, version: string): string {
  const base = `https://${name}`;
  if (!version || version === "HEAD") {
    return base;
  }
  return `${base}#${version}`;
}

export function buildUpdateSpecs(
  sources: Sources,
  options: UpdateOptions = {},
): { specs: string[]; packageCount: number; repoCount: number } {
  const updatePackages = shouldUpdatePackages(options);
  const updateRepos = shouldUpdateRepos(options);

  let packages = updatePackages ? sources.packages : [];
  if (options.registry) {
    packages = packages.filter((p) => p.registry === options.registry);
  }

  const repos = updateRepos ? sources.repos : [];

  const specs: string[] = [];
  const seen = new Set<string>();

  for (const pkg of packages) {
    const spec = `${pkg.registry}:${pkg.name}`;
    if (!seen.has(spec)) {
      specs.push(spec);
      seen.add(spec);
    }
  }

  for (const repo of repos) {
    const spec = buildRepoSpec(repo.name, repo.version);
    if (!seen.has(spec)) {
      specs.push(spec);
      seen.add(spec);
    }
  }

  return { specs, packageCount: packages.length, repoCount: repos.length };
}

/**
 * Update all fetched packages and/or repositories
 */
export async function updateCommand(
  options: UpdateOptions = {},
): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const sources = await listSources(cwd);
  const totalCount = sources.packages.length + sources.repos.length;

  if (totalCount === 0) {
    console.log("No sources fetched yet.");
    console.log(
      "\nUse `opensrc <package>` to fetch source code for a package.",
    );
    console.log("Use `opensrc <owner>/<repo>` to fetch a GitHub repository.");
    console.log("\nSupported registries:");
    console.log("  • npm:      opensrc zod, opensrc npm:react");
    console.log("  • PyPI:     opensrc pypi:requests");
    console.log("  • crates:   opensrc crates:serde");
    return;
  }

  const { specs, packageCount, repoCount } = buildUpdateSpecs(sources, options);

  if (specs.length === 0) {
    const updatePackages = shouldUpdatePackages(options);
    const updateRepos = shouldUpdateRepos(options);

    if (options.registry) {
      console.log(`No ${options.registry} packages to update.`);
    } else {
      if (updatePackages && packageCount === 0) {
        console.log("No packages to update");
      }
      if (updateRepos && repoCount === 0) {
        console.log("No repos to update");
      }
    }

    console.log("\nNothing to update.");
    return;
  }

  console.log(`Updating ${specs.length} source(s)...`);

  await fetchCommand(specs, {
    cwd,
    allowModifications: options.allowModifications,
  });
}
