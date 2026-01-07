import { join } from "path";
import { existsSync } from "fs";
import { rm, readFile } from "fs/promises";

const OPENSRC_DIR = "opensrc";

/**
 * Get the opensrc directory path
 */
export function getOpensrcDir(cwd: string = process.cwd()): string {
  return join(cwd, OPENSRC_DIR);
}

/**
 * Get the path where a package's source will be stored
 */
export function getPackagePath(
  packageName: string,
  cwd: string = process.cwd(),
): string {
  return join(getOpensrcDir(cwd), packageName);
}

/**
 * Check if a package source already exists
 */
export function packageExists(
  packageName: string,
  cwd: string = process.cwd(),
): boolean {
  return existsSync(getPackagePath(packageName, cwd));
}

/**
 * Read metadata for a fetched package
 */
export async function readMetadata(
  packageName: string,
  cwd: string = process.cwd(),
): Promise<{
  name: string;
  version: string;
  repoUrl: string;
  repoDirectory?: string;
  fetchedTag: string;
  fetchedAt: string;
  downloadMethod?: "git" | "npm";
} | null> {
  const packagePath = getPackagePath(packageName, cwd);
  const metadataPath = join(packagePath, ".opensrc-meta.json");

  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    const content = await readFile(metadataPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Remove source code for a package
 */
export async function removeSource(
  packageName: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  const packagePath = getPackagePath(packageName, cwd);

  if (!existsSync(packagePath)) {
    return false;
  }

  await rm(packagePath, { recursive: true, force: true });

  if (packageName.startsWith("@")) {
    const scopeDir = join(getOpensrcDir(cwd), packageName.split("/")[0]);
    try {
      const { readdir } = await import("fs/promises");
      const contents = await readdir(scopeDir);
      if (contents.length === 0) {
        await rm(scopeDir, { recursive: true, force: true });
      }
    } catch {}
  }

  return true;
}
