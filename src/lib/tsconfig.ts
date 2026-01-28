import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const OPENSRC_DIR = ".opensrc";

interface TsConfig {
  exclude?: string[];
  [key: string]: unknown;
}

/**
 * Check if tsconfig.json exists
 */
export function hasTsConfig(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, "tsconfig.json"));
}

/**
 * Check if tsconfig.json already excludes opensrc/
 */
export async function hasOpensrcExclude(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const tsconfigPath = join(cwd, "tsconfig.json");

  if (!existsSync(tsconfigPath)) {
    return false;
  }

  try {
    const content = await readFile(tsconfigPath, "utf-8");
    const config = JSON.parse(content) as TsConfig;

    if (!config.exclude) {
      return false;
    }

    return config.exclude.some(
      (entry) =>
        entry === OPENSRC_DIR ||
        entry === `${OPENSRC_DIR}/` ||
        entry === `./${OPENSRC_DIR}` ||
        // Legacy entries (before the rename to .opensrc)
        entry === "opensrc" ||
        entry === "opensrc/" ||
        entry === "./opensrc",
    );
  } catch {
    return false;
  }
}

/**
 * Add opensrc/ to tsconfig.json exclude array
 */
export async function ensureTsconfigExclude(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const tsconfigPath = join(cwd, "tsconfig.json");

  if (!existsSync(tsconfigPath)) {
    return false;
  }

  // Already excluded
  if (await hasOpensrcExclude(cwd)) {
    return false;
  }

  try {
    const content = await readFile(tsconfigPath, "utf-8");
    const config = JSON.parse(content) as TsConfig;

    if (!config.exclude) {
      config.exclude = [];
    }

    config.exclude.push(OPENSRC_DIR);

    // Preserve formatting by using 2-space indent (most common for tsconfig)
    await writeFile(
      tsconfigPath,
      JSON.stringify(config, null, 2) + "\n",
      "utf-8",
    );
    return true;
  } catch {
    return false;
  }
}
