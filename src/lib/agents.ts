import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const AGENTS_FILE = "AGENTS.md";
const OPENSRC_DIR = "opensrc";
const SOURCES_FILE = "sources.json";
const SECTION_START = "## Source Code Reference";
const SECTION_MARKER = "<!-- opensrc:start -->";
const SECTION_END_MARKER = "<!-- opensrc:end -->";

/**
 * The static AGENTS.md section that points to the index file
 */
const STATIC_SECTION = `
${SECTION_MARKER}

${SECTION_START}

Source code for dependencies is available in \`opensrc/\` for deeper understanding of implementation details.

See \`opensrc/sources.json\` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

${SECTION_END_MARKER}
`;

export interface PackageIndex {
  packages: Array<{
    name: string;
    version: string;
    path: string;
    repoUrl?: string;
    repoDirectory?: string;
    fetchedAt: string;
  }>;
  updatedAt: string;
}

/**
 * Update the index.json file in .opensrc/
 */
export async function updatePackageIndex(
  packages: Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }>,
  cwd: string = process.cwd(),
): Promise<void> {
  const opensrcDir = join(cwd, OPENSRC_DIR);
  const sourcesPath = join(opensrcDir, SOURCES_FILE);

  if (packages.length === 0) {
    // Remove index file if no packages
    if (existsSync(sourcesPath)) {
      const { rm } = await import("fs/promises");
      await rm(sourcesPath, { force: true });
    }
    return;
  }

  const index: PackageIndex = {
    packages: packages.map((p) => ({
      name: p.name,
      version: p.version,
      path: p.path,
      fetchedAt: p.fetchedAt,
    })),
    updatedAt: new Date().toISOString(),
  };

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
 * Ensure AGENTS.md has the static opensrc section
 */
export async function ensureAgentsMd(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const agentsPath = join(cwd, AGENTS_FILE);

  // Already has section
  if (await hasOpensrcSection(cwd)) {
    return false;
  }

  let content = "";

  if (existsSync(agentsPath)) {
    content = await readFile(agentsPath, "utf-8");
    // Ensure there's a newline at the end before we append
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
  } else {
    // Create new file
    content = `# AGENTS.md

Instructions for AI coding agents working with this codebase.
`;
  }

  content += STATIC_SECTION;

  await writeFile(agentsPath, content, "utf-8");
  return true;
}

/**
 * Update AGENTS.md and the package index
 */
export async function updateAgentsMd(
  packages: Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }>,
  cwd: string = process.cwd(),
): Promise<boolean> {
  // Always update the index file
  await updatePackageIndex(packages, cwd);

  // Only add section to AGENTS.md if there are packages and section doesn't exist
  if (packages.length > 0) {
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
