import { mkdir, readFile, writeFile, rm } from "fs/promises";
import { join } from "path";
import { pipeline } from "stream/promises";
import { createWriteStream, existsSync } from "fs";
import { extract } from "tar";
import { getOpensrcDir, getPackagePath, packageExists } from "./common.js";
import type { ResolvedPackage, FetchResult } from "../types.js";

/**
 * Download tarball from npm registry
 */
async function downloadTarball(
  tarballUrl: string,
  targetPath: string,
): Promise<void> {
  const response = await fetch(tarballUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to download tarball: ${response.status} ${response.statusText}`,
    );
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const fileStream = createWriteStream(targetPath);
  await pipeline(response.body, fileStream);
}

/**
 * Extract tarball to target directory
 */
async function extractTarball(
  tarballPath: string,
  targetPath: string,
): Promise<void> {
  await extract({
    file: tarballPath,
    cwd: targetPath,
    strip: 1,
  });

  await rm(tarballPath, { force: true });
}

/**
 * Write metadata file about the fetched source
 */
async function writeMetadata(
  packagePath: string,
  resolved: ResolvedPackage,
): Promise<void> {
  const metadata = {
    name: resolved.name,
    version: resolved.version,
    repoUrl: resolved.repoUrl,
    repoDirectory: resolved.repoDirectory,
    fetchedTag: resolved.gitTag,
    fetchedAt: new Date().toISOString(),
    downloadMethod: "npm" as const,
  };

  const metadataPath = join(packagePath, ".opensrc-meta.json");
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
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
 * Fetch source code from npm tarball
 */
export async function fetchSource(
  resolved: ResolvedPackage,
  cwd: string = process.cwd(),
): Promise<FetchResult> {
  const packagePath = getPackagePath(resolved.name, cwd);
  const opensrcDir = getOpensrcDir(cwd);

  if (!existsSync(opensrcDir)) {
    await mkdir(opensrcDir, { recursive: true });
  }

  if (existsSync(packagePath)) {
    await rm(packagePath, { recursive: true, force: true });
  }

  const parentDir = join(packagePath, "..");
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  console.log(`  → Getting npm tarball URL...`);
  const tarballUrl = await getTarballUrl(resolved.name, resolved.version);
  console.log(`  → Downloading from npm...`);

  const tempTarballPath = join(
    opensrcDir,
    `${resolved.name.replace(/\//g, "-")}.tgz`,
  );

  try {
    await downloadTarball(tarballUrl, tempTarballPath);
    await mkdir(packagePath, { recursive: true });
    await extractTarball(tempTarballPath, packagePath);
    await writeMetadata(packagePath, resolved);

    let sourcePath = packagePath;
    if (resolved.repoDirectory) {
      sourcePath = join(packagePath, resolved.repoDirectory);
    }

    return {
      package: resolved.name,
      version: resolved.version,
      path: sourcePath,
      success: true,
    };
  } catch (error) {
    if (existsSync(packagePath)) {
      await rm(packagePath, { recursive: true, force: true });
    }
    if (existsSync(tempTarballPath)) {
      await rm(tempTarballPath, { force: true });
    }

    throw error;
  }
}

/**
 * Get tarball URL for a specific package version
 */
async function getTarballUrl(
  packageName: string,
  version: string,
): Promise<string> {
  const NPM_REGISTRY = "https://registry.npmjs.org";
  const url = `${NPM_REGISTRY}/${encodeURIComponent(packageName).replace("%40", "@")}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch package info: ${response.status}`);
  }

  const info = (await response.json()) as {
    versions: {
      [version: string]: {
        dist: {
          tarball: string;
        };
      };
    };
  };

  const versionInfo = info.versions[version];
  if (!versionInfo) {
    throw new Error(`Version ${version} not found for ${packageName}`);
  }

  return versionInfo.dist.tarball;
}

/**
 * List all fetched packages
 */
export async function listSources(cwd: string = process.cwd()): Promise<
  Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }>
> {
  const opensrcDir = getOpensrcDir(cwd);

  if (!existsSync(opensrcDir)) {
    return [];
  }

  const { readdir } = await import("fs/promises");
  const results: Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }> = [];

  const entries = await readdir(opensrcDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    if (entry.name.startsWith("@")) {
      const scopeDir = join(opensrcDir, entry.name);
      const scopeEntries = await readdir(scopeDir, { withFileTypes: true });

      for (const scopeEntry of scopeEntries) {
        if (!scopeEntry.isDirectory()) continue;

        const packageName = `${entry.name}/${scopeEntry.name}`;
        const metadata = await readMetadata(packageName, cwd);

        if (metadata) {
          results.push({
            name: packageName,
            version: metadata.version,
            path: getPackagePath(packageName, cwd),
            fetchedAt: metadata.fetchedAt,
          });
        }
      }
    } else {
      const metadata = await readMetadata(entry.name, cwd);

      if (metadata) {
        results.push({
          name: entry.name,
          version: metadata.version,
          path: getPackagePath(entry.name, cwd),
          fetchedAt: metadata.fetchedAt,
        });
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
