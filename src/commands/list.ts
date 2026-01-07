import { listSources } from "../lib/git.js";
import type { Registry } from "../types.js";

export interface ListOptions {
  cwd?: string;
  json?: boolean;
}

const REGISTRY_LABELS: Record<Registry, string> = {
  npm: "npm",
  pypi: "PyPI",
  crates: "crates.io",
};

/**
 * List all fetched package sources
 */
export async function listCommand(options: ListOptions = {}): Promise<void> {
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

  if (options.json) {
    console.log(JSON.stringify(sources, null, 2));
    return;
  }

  // Group packages by registry for display
  const packagesByRegistry: Record<Registry, typeof sources.packages> = {
    npm: [],
    pypi: [],
    crates: [],
  };

  for (const pkg of sources.packages) {
    packagesByRegistry[pkg.registry].push(pkg);
  }

  // Display packages by registry
  const registries: Registry[] = ["npm", "pypi", "crates"];
  let hasDisplayedPackages = false;

  for (const registry of registries) {
    const packages = packagesByRegistry[registry];
    if (packages.length === 0) continue;

    if (hasDisplayedPackages) {
      console.log(""); // Add spacing between registries
    }

    console.log(`${REGISTRY_LABELS[registry]} Packages:\n`);
    hasDisplayedPackages = true;

    for (const source of packages) {
      const date = new Date(source.fetchedAt);
      const formattedDate = date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      console.log(`  ${source.name}@${source.version}`);
      console.log(`    Path: opensrc/${source.path}`);
      console.log(`    Fetched: ${formattedDate}`);
      console.log("");
    }
  }

  // Display repos
  if (sources.repos.length > 0) {
    if (hasDisplayedPackages) {
      console.log(""); // Add spacing between sections
    }
    console.log("Repositories:\n");

    for (const source of sources.repos) {
      const date = new Date(source.fetchedAt);
      const formattedDate = date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      console.log(`  ${source.name}@${source.version}`);
      console.log(`    Path: opensrc/${source.path}`);
      console.log(`    Fetched: ${formattedDate}`);
      console.log("");
    }
  }

  // Summary by registry
  const registryCounts = registries
    .map((reg) => {
      const count = packagesByRegistry[reg].length;
      return count > 0 ? `${count} ${REGISTRY_LABELS[reg]}` : null;
    })
    .filter(Boolean)
    .join(", ");

  const summary = [
    registryCounts ? `${sources.packages.length} package(s) (${registryCounts})` : null,
    sources.repos.length > 0 ? `${sources.repos.length} repo(s)` : null,
  ]
    .filter(Boolean)
    .join(", ");

  console.log(`Total: ${summary}`);
}
