import { listSources } from "../lib/git.js";

export interface ListOptions {
  cwd?: string;
  json?: boolean;
}

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
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(sources, null, 2));
    return;
  }

  // Display packages
  if (sources.packages.length > 0) {
    console.log("Packages:\n");

    for (const source of sources.packages) {
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
    if (sources.packages.length > 0) {
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

  console.log(
    `Total: ${sources.packages.length} package(s), ${sources.repos.length} repo(s)`,
  );
}
