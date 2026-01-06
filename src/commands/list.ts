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

  if (sources.length === 0) {
    console.log("No sources fetched yet.");
    console.log(
      "\nUse `opensrc <package>` to fetch source code for a package.",
    );
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(sources, null, 2));
    return;
  }

  console.log("Fetched sources:\n");

  for (const source of sources) {
    const date = new Date(source.fetchedAt);
    const formattedDate = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    console.log(`  ${source.name}@${source.version}`);
    console.log(`    Path: ${source.path}`);
    console.log(`    Fetched: ${formattedDate}`);
    console.log("");
  }

  console.log(`Total: ${sources.length} package(s)`);
}
