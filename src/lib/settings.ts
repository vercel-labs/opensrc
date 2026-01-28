import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const OPENSRC_DIR = ".opensrc";
const SETTINGS_FILE = "settings.json";

export interface OpensrcSettings {
  allowFileModifications?: boolean;
}

/**
 * Get the path to the settings file
 */
function getSettingsPath(cwd: string): string {
  return join(cwd, OPENSRC_DIR, SETTINGS_FILE);
}

/**
 * Ensure the opensrc directory exists
 */
async function ensureOpensrcDir(cwd: string): Promise<void> {
  const opensrcDir = join(cwd, OPENSRC_DIR);
  if (!existsSync(opensrcDir)) {
    await mkdir(opensrcDir, { recursive: true });
  }
}

/**
 * Read settings from opensrc/settings.json
 */
export async function readSettings(
  cwd: string = process.cwd(),
): Promise<OpensrcSettings> {
  const settingsPath = getSettingsPath(cwd);

  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const content = await readFile(settingsPath, "utf-8");
    return JSON.parse(content) as OpensrcSettings;
  } catch {
    return {};
  }
}

/**
 * Write settings to opensrc/settings.json
 */
export async function writeSettings(
  settings: OpensrcSettings,
  cwd: string = process.cwd(),
): Promise<void> {
  await ensureOpensrcDir(cwd);
  const settingsPath = getSettingsPath(cwd);
  await writeFile(
    settingsPath,
    JSON.stringify(settings, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Check if file modifications are allowed
 * Returns: true if allowed, false if denied, undefined if not set
 */
export async function getFileModificationPermission(
  cwd: string = process.cwd(),
): Promise<boolean | undefined> {
  const settings = await readSettings(cwd);
  return settings.allowFileModifications;
}

/**
 * Save the file modification permission setting
 */
export async function setFileModificationPermission(
  allowed: boolean,
  cwd: string = process.cwd(),
): Promise<void> {
  const settings = await readSettings(cwd);
  settings.allowFileModifications = allowed;
  await writeSettings(settings, cwd);
}
