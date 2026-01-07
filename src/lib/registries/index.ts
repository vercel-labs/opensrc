import type { Registry, PackageSpec, ResolvedPackage } from "../../types.js";
import { parseNpmSpec, resolveNpmPackage } from "./npm.js";
import { parsePyPISpec, resolvePyPIPackage } from "./pypi.js";
import { parseCratesSpec, resolveCrate } from "./crates.js";
import { isRepoSpec } from "../repo.js";

export { resolveNpmPackage } from "./npm.js";
export { resolvePyPIPackage } from "./pypi.js";
export { resolveCrate } from "./crates.js";

/**
 * Registry prefixes for explicit specification
 */
const REGISTRY_PREFIXES: Record<string, Registry> = {
  "npm:": "npm",
  "pypi:": "pypi",
  "pip:": "pypi",
  "python:": "pypi",
  "crates:": "crates",
  "cargo:": "crates",
  "rust:": "crates",
};

/**
 * Detect the registry from a package specifier
 * Returns the registry and the cleaned spec (without prefix)
 */
export function detectRegistry(spec: string): {
  registry: Registry;
  cleanSpec: string;
} {
  const trimmed = spec.trim();

  // Check for explicit prefix
  for (const [prefix, registry] of Object.entries(REGISTRY_PREFIXES)) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return {
        registry,
        cleanSpec: trimmed.slice(prefix.length),
      };
    }
  }

  // Default to npm if no prefix
  return {
    registry: "npm",
    cleanSpec: trimmed,
  };
}

/**
 * Parse a package specifier with registry detection
 */
export function parsePackageSpec(spec: string): PackageSpec {
  const { registry, cleanSpec } = detectRegistry(spec);

  let name: string;
  let version: string | undefined;

  switch (registry) {
    case "npm":
      ({ name, version } = parseNpmSpec(cleanSpec));
      break;
    case "pypi":
      ({ name, version } = parsePyPISpec(cleanSpec));
      break;
    case "crates":
      ({ name, version } = parseCratesSpec(cleanSpec));
      break;
  }

  return { registry, name, version };
}

/**
 * Resolve a package to its repository information
 */
export async function resolvePackage(
  spec: PackageSpec,
): Promise<ResolvedPackage> {
  const { registry, name, version } = spec;

  switch (registry) {
    case "npm":
      return resolveNpmPackage(name, version);
    case "pypi":
      return resolvePyPIPackage(name, version);
    case "crates":
      return resolveCrate(name, version);
  }
}

/**
 * Detect whether the input is a package or a repo
 */
export function detectInputType(
  spec: string,
): "package" | "repo" {
  const trimmed = spec.trim();

  // Check for explicit registry prefix -> package
  for (const prefix of Object.keys(REGISTRY_PREFIXES)) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return "package";
    }
  }

  // Check if it looks like a repo spec
  if (isRepoSpec(trimmed)) {
    return "repo";
  }

  // Default to package
  return "package";
}

