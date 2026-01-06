import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { InstalledPackage } from '../types.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackageLockJson {
  packages?: Record<string, { version?: string }>;
  dependencies?: Record<string, { version: string }>;
}

/**
 * Strip version range prefixes like ^, ~, >=, etc.
 */
function stripVersionPrefix(version: string): string {
  return version.replace(/^[\^~>=<]+/, '');
}

/**
 * Try to get installed version from node_modules
 */
async function getVersionFromNodeModules(
  packageName: string,
  cwd: string
): Promise<string | null> {
  const packageJsonPath = join(cwd, 'node_modules', packageName, 'package.json');
  
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  
  try {
    const content = await readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Try to get installed version from package-lock.json
 */
async function getVersionFromPackageLock(
  packageName: string,
  cwd: string
): Promise<string | null> {
  const lockPath = join(cwd, 'package-lock.json');
  
  if (!existsSync(lockPath)) {
    return null;
  }
  
  try {
    const content = await readFile(lockPath, 'utf-8');
    const lock = JSON.parse(content) as PackageLockJson;
    
    // npm v7+ format uses "packages"
    if (lock.packages) {
      const key = `node_modules/${packageName}`;
      if (lock.packages[key]?.version) {
        return lock.packages[key].version;
      }
    }
    
    // npm v6 and earlier format uses "dependencies"
    if (lock.dependencies?.[packageName]?.version) {
      return lock.dependencies[packageName].version;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Try to get installed version from pnpm-lock.yaml
 * This is a simplified parser - pnpm lockfiles are complex
 */
async function getVersionFromPnpmLock(
  packageName: string,
  cwd: string
): Promise<string | null> {
  const lockPath = join(cwd, 'pnpm-lock.yaml');
  
  if (!existsSync(lockPath)) {
    return null;
  }
  
  try {
    const content = await readFile(lockPath, 'utf-8');
    
    // Look for the package in the lockfile
    // pnpm format: 'packageName@version(peer-deps):' or 'packageName@version:'
    // We need to stop at '(' or ')' (peer deps), ':' (end of key), or quotes
    // The ')' case handles matching inside another package's peer deps like ai@6.0.6(zod@4.3.4)
    const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`['"]?${escapedName}@([^(':"\\s)]+)`, 'g');
    const matches = [...content.matchAll(regex)];
    
    if (matches.length > 0) {
      // Return the first match's version
      return matches[0][1];
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Try to get version from yarn.lock
 */
async function getVersionFromYarnLock(
  packageName: string,
  cwd: string
): Promise<string | null> {
  const lockPath = join(cwd, 'yarn.lock');
  
  if (!existsSync(lockPath)) {
    return null;
  }
  
  try {
    const content = await readFile(lockPath, 'utf-8');
    
    // Yarn lockfile format:
    // "packageName@^version":
    //   version "actual-version"
    const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `"?${escapedName}@[^":\\n]+[":]?\\s*\\n\\s*version\\s+["']?([^"'\\n]+)`,
      'g'
    );
    const matches = [...content.matchAll(regex)];
    
    if (matches.length > 0) {
      return matches[0][1];
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Get version from package.json dependencies (as fallback)
 */
async function getVersionFromPackageJson(
  packageName: string,
  cwd: string
): Promise<string | null> {
  const packageJsonPath = join(cwd, 'package.json');
  
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  
  try {
    const content = await readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as PackageJson;
    
    const version =
      pkg.dependencies?.[packageName] ||
      pkg.devDependencies?.[packageName] ||
      pkg.peerDependencies?.[packageName];
    
    if (version) {
      return stripVersionPrefix(version);
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect the installed version of a package
 * Priority: node_modules > lockfile > package.json
 */
export async function detectInstalledVersion(
  packageName: string,
  cwd: string = process.cwd()
): Promise<string | null> {
  // 1. Try node_modules (most accurate for what's actually installed)
  const nodeModulesVersion = await getVersionFromNodeModules(packageName, cwd);
  if (nodeModulesVersion) {
    return nodeModulesVersion;
  }
  
  // 2. Try lockfiles
  const packageLockVersion = await getVersionFromPackageLock(packageName, cwd);
  if (packageLockVersion) {
    return packageLockVersion;
  }
  
  const pnpmLockVersion = await getVersionFromPnpmLock(packageName, cwd);
  if (pnpmLockVersion) {
    return pnpmLockVersion;
  }
  
  const yarnLockVersion = await getVersionFromYarnLock(packageName, cwd);
  if (yarnLockVersion) {
    return yarnLockVersion;
  }
  
  // 3. Fall back to package.json
  const packageJsonVersion = await getVersionFromPackageJson(packageName, cwd);
  if (packageJsonVersion) {
    return packageJsonVersion;
  }
  
  return null;
}

/**
 * List all dependencies from package.json
 */
export async function listDependencies(
  cwd: string = process.cwd()
): Promise<InstalledPackage[]> {
  const packageJsonPath = join(cwd, 'package.json');
  
  if (!existsSync(packageJsonPath)) {
    return [];
  }
  
  try {
    const content = await readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as PackageJson;
    
    const deps: InstalledPackage[] = [];
    
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    
    for (const [name, version] of Object.entries(allDeps)) {
      deps.push({
        name,
        version: stripVersionPrefix(version),
      });
    }
    
    return deps;
  } catch {
    return [];
  }
}
