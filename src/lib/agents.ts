import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { Registry } from "../types.js";

const AGENTS_FILE = "AGENTS.md";
const OPENSRC_DIR = "opensrc";
const SOURCES_FILE = "sources.json";
const SECTION_START = "## Source Code Reference";
const SECTION_MARKER = "<!-- opensrc:start -->";
const SECTION_END_MARKER = "<!-- opensrc:end -->";

/**
 * Get the section content (without leading newline for comparison)
 */
function getSectionContent(): string {
  return `${SECTION_MARKER}

${SECTION_START}

Source code for dependencies is available in \`opensrc/\` for deeper understanding of implementation details.

See \`opensrc/sources.json\` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

\`\`\`bash
npx opensrc <package>              # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>         # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>       # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc packagist:<package>    # PHP package (e.g., npx opensrc packagist:laravel/framework)
npx opensrc <owner>/<repo>         # GitHub repo (e.g., npx opensrc vercel/ai)
\`\`\`

${SECTION_END_MARKER}`;
}

export interface PackageEntry {
  name: string;
  version: string;
  registry: Registry;
  path: string;
  fetchedAt: string;
}

export interface RepoEntry {
  name: string;
  version: string;
  path: string;
  fetchedAt: string;
}

export interface SourcesIndex {
  packages?: PackageEntry[];
  repos?: RepoEntry[];
  updatedAt: string;
}

/**
 * Update the sources.json file in opensrc/
 */
export async function updatePackageIndex(
  sources: {
    packages: PackageEntry[];
    repos: RepoEntry[];
  },
  cwd: string = process.cwd(),
): Promise<void> {
  const opensrcDir = join(cwd, OPENSRC_DIR);
  const sourcesPath = join(opensrcDir, SOURCES_FILE);

  if (sources.packages.length === 0 && sources.repos.length === 0) {
    // Remove index file if no sources
    if (existsSync(sourcesPath)) {
      const { rm } = await import("fs/promises");
      await rm(sourcesPath, { force: true });
    }
    return;
  }

  const index: SourcesIndex = {
    updatedAt: new Date().toISOString(),
  };

  if (sources.packages.length > 0) {
    index.packages = sources.packages.map((p) => ({
      name: p.name,
      version: p.version,
      registry: p.registry,
      path: p.path,
      fetchedAt: p.fetchedAt,
    }));
  }

  if (sources.repos.length > 0) {
    index.repos = sources.repos.map((r) => ({
      name: r.name,
      version: r.version,
      path: r.path,
      fetchedAt: r.fetchedAt,
    }));
  }

  await writeFile(sourcesPath, JSON.stringify(index, null, 2), "utf-8");
}

/**
 * Check if AGENTS.md has an opensrc section
 */
export async function hasOpensrcSection(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const agentsPath = join(cwd, AGENTS_FILE);

  if (!existsSync(agentsPath)) {
    return false;
  }

  try {
    const content = await readFile(agentsPath, "utf-8");
    return content.includes(SECTION_MARKER);
  } catch {
    return false;
  }
}

/**
 * Extract the current opensrc section from a file
 */
function extractSection(content: string): string | null {
  const startIdx = content.indexOf(SECTION_MARKER);
  const endIdx = content.indexOf(SECTION_END_MARKER);

  if (startIdx === -1 || endIdx === -1) {
    return null;
  }

  return content.slice(startIdx, endIdx + SECTION_END_MARKER.length);
}

/**
 * Ensure AGENTS.md has the opensrc section (add or update)
 */
export async function ensureAgentsMd(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const agentsPath = join(cwd, AGENTS_FILE);
  const newSection = getSectionContent();

  if (existsSync(agentsPath)) {
    const content = await readFile(agentsPath, "utf-8");

    if (content.includes(SECTION_MARKER)) {
      // Section exists - check if it needs updating
      const existingSection = extractSection(content);

      if (existingSection === newSection) {
        // Content is the same, no update needed
        return false;
      }

      // Update the existing section
      const startIdx = content.indexOf(SECTION_MARKER);
      const endIdx = content.indexOf(SECTION_END_MARKER);

      const before = content.slice(0, startIdx);
      const after = content.slice(endIdx + SECTION_END_MARKER.length);

      const newContent = before + newSection + after;
      await writeFile(agentsPath, newContent, "utf-8");
      return true;
    } else {
      // Section doesn't exist - add it
      let newContent = content;
      if (newContent.length > 0 && !newContent.endsWith("\n")) {
        newContent += "\n";
      }
      newContent += "\n" + newSection;
      await writeFile(agentsPath, newContent, "utf-8");
      return true;
    }
  } else {
    // Create new file
    const content = `# AGENTS.md

Instructions for AI coding agents working with this codebase.

${newSection}
`;
    await writeFile(agentsPath, content, "utf-8");
    return true;
  }
}

/**
 * Update AGENTS.md and the package index
 */
export async function updateAgentsMd(
  sources: {
    packages: PackageEntry[];
    repos: RepoEntry[];
  },
  cwd: string = process.cwd(),
): Promise<boolean> {
  // Always update the index file
  await updatePackageIndex(sources, cwd);

  // Add or update section in AGENTS.md if there are sources
  if (sources.packages.length > 0 || sources.repos.length > 0) {
    return ensureAgentsMd(cwd);
  }

  return false;
}

/**
 * Remove the opensrc section from AGENTS.md
 */
export async function removeOpensrcSection(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const agentsPath = join(cwd, AGENTS_FILE);

  if (!existsSync(agentsPath)) {
    return false;
  }

  try {
    const content = await readFile(agentsPath, "utf-8");

    if (!content.includes(SECTION_MARKER)) {
      return false;
    }

    const startIdx = content.indexOf(SECTION_MARKER);
    const endIdx = content.indexOf(SECTION_END_MARKER);

    if (startIdx === -1 || endIdx === -1) {
      return false;
    }

    const before = content.slice(0, startIdx).trimEnd();
    const after = content.slice(endIdx + SECTION_END_MARKER.length).trimStart();

    let newContent = before;
    if (after) {
      newContent += "\n\n" + after;
    }

    // Clean up multiple consecutive newlines
    newContent = newContent.replace(/\n{3,}/g, "\n\n").trim() + "\n";

    await writeFile(agentsPath, newContent, "utf-8");
    return true;
  } catch {
    return false;
  }
}
