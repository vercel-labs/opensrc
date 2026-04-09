import type { ResolvedPackage } from "../../types.js";

const NUGET_SERVICE_INDEX = "https://api.nuget.org/v3/index.json";
const ALLOWED_GIT_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org"]);

interface NuGetServiceIndex {
  resources?: Array<{
    "@id"?: string;
    "@type"?: string;
  }>;
}

interface RegistrationLeaf {
  catalogEntry?: {
    version?: string;
    repository?: {
      type?: string;
      url?: string;
      branch?: string;
      commit?: string;
    };
    projectUrl?: string;
  };
}

interface RegistrationPage {
  items?: RegistrationLeaf[];
  "@id"?: string;
}

interface RegistrationIndex {
  items?: RegistrationPage[];
}

interface NuGetMetadataCandidate {
  source: "repository" | "projectUrl";
  url: string;
}

function toComparableVersion(version: string): string {
  return version.trim().toLowerCase();
}

function isPrereleaseVersion(version: string): boolean {
  return version.includes("-");
}

function comparePrereleaseIdentifiers(a: string, b: string): number {
  const aParts = a.split(".");
  const bParts = b.split(".");
  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i += 1) {
    const aPart = aParts[i];
    const bPart = bParts[i];

    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;

    const aNum = /^\d+$/.test(aPart);
    const bNum = /^\d+$/.test(bPart);

    if (aNum && bNum) {
      const diff = Number(aPart) - Number(bPart);
      if (diff !== 0) return diff;
      continue;
    }

    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;

    const cmp = aPart.localeCompare(bPart);
    if (cmp !== 0) return cmp;
  }

  return 0;
}

function compareNuGetVersions(a: string, b: string): number {
  const [aMain, aMeta] = a.split("+", 2);
  const [bMain, bMeta] = b.split("+", 2);
  const [aCore, aPre] = aMain.split("-", 2);
  const [bCore, bPre] = bMain.split("-", 2);

  const aCoreParts = aCore.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const bCoreParts = bCore.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const maxCoreLen = Math.max(aCoreParts.length, bCoreParts.length);

  for (let i = 0; i < maxCoreLen; i += 1) {
    const aVal = aCoreParts[i] ?? 0;
    const bVal = bCoreParts[i] ?? 0;
    if (aVal !== bVal) {
      return aVal - bVal;
    }
  }

  if (!aPre && bPre) return 1;
  if (aPre && !bPre) return -1;
  if (aPre && bPre) {
    const preCmp = comparePrereleaseIdentifiers(aPre, bPre);
    if (preCmp !== 0) return preCmp;
  }

  return (aMeta ?? "").localeCompare(bMeta ?? "");
}

function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "opensrc-cli",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch NuGet metadata: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

function getNuGetResource(index: NuGetServiceIndex, typePrefix: string): string {
  const resource = index.resources?.find((entry) =>
    entry["@type"]?.toLowerCase().startsWith(typePrefix.toLowerCase()),
  );

  if (!resource?.["@id"]) {
    throw new Error(
      `NuGet service index does not provide required resource: ${typePrefix}`,
    );
  }

  return resource["@id"];
}

async function fetchRegistrationLeaves(
  registrationsBaseUrl: string,
  packageId: string,
): Promise<RegistrationLeaf[]> {
  const packageLower = packageId.toLowerCase();
  const indexUrl = joinUrl(registrationsBaseUrl, `${packageLower}/index.json`);
  const response = await fetch(indexUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "opensrc-cli",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error(
      `Failed to fetch NuGet metadata: ${response.status} ${response.statusText}`,
    );
  }

  const index = (await response.json()) as RegistrationIndex;

  const leaves: RegistrationLeaf[] = [];

  for (const page of index.items ?? []) {
    if (page.items && page.items.length > 0) {
      leaves.push(...page.items);
      continue;
    }

    if (page["@id"]) {
      const expandedPage = await fetchJson<RegistrationPage>(page["@id"]);
      leaves.push(...(expandedPage.items ?? []));
    }
  }

  return leaves;
}

function resolveVersionFromLeaves(
  leaves: RegistrationLeaf[],
  packageName: string,
  requestedVersion?: string,
  allowPrerelease: boolean = false,
): string {
  if (requestedVersion) {
    const wanted = toComparableVersion(requestedVersion);
    const matched = leaves.find(
      (leaf) => toComparableVersion(leaf.catalogEntry?.version ?? "") === wanted,
    );

    if (!matched?.catalogEntry?.version) {
      throw new Error(`Version "${requestedVersion}" not found on NuGet`);
    }

    return matched.catalogEntry.version;
  }

  const versions = leaves
    .map((leaf) => leaf.catalogEntry?.version)
    .filter((value): value is string => Boolean(value));

  if (versions.length === 0) {
    throw new Error("NuGet package has no published versions");
  }

  if (allowPrerelease) {
    return versions.reduce((latest, current) =>
      compareNuGetVersions(current, latest) > 0 ? current : latest,
    );
  }

  const stableVersions = versions.filter((value) => !isPrereleaseVersion(value));

  if (stableVersions.length > 0) {
    return stableVersions.reduce((latest, current) =>
      compareNuGetVersions(current, latest) > 0 ? current : latest,
    );
  }

  throw new Error(
    `No stable version found for "${packageName}" on NuGet. Specify a prerelease version explicitly (for example: nuget:${packageName}@<version>)`,
  );
}

function findLeafByVersion(
  leaves: RegistrationLeaf[],
  version: string,
): RegistrationLeaf | null {
  const wanted = toComparableVersion(version);
  return (
    leaves.find(
      (leaf) => toComparableVersion(leaf.catalogEntry?.version ?? "") === wanted,
    ) ?? null
  );
}

function extractRepositoryFromLeaf(leaf: RegistrationLeaf): NuGetMetadataCandidate | null {
  const repository = leaf.catalogEntry?.repository;

  if (
    repository?.url &&
    (!repository.type || repository.type.toLowerCase() === "git")
  ) {
    return { source: "repository", url: repository.url };
  }

  if (leaf.catalogEntry?.projectUrl) {
    return { source: "projectUrl", url: leaf.catalogEntry.projectUrl };
  }

  return null;
}

function extractRepositoryFromNuspecXml(
  xml: string,
): NuGetMetadataCandidate | null {
  const repositoryMatch = xml.match(/<repository\b[^>]*>/i);
  if (repositoryMatch) {
    const repositoryTag = repositoryMatch[0];
    const typeMatch = repositoryTag.match(/\btype\s*=\s*"([^"]+)"/i);
    const urlMatch = repositoryTag.match(/\burl\s*=\s*"([^"]+)"/i);

    if (urlMatch && (!typeMatch || typeMatch[1].toLowerCase() === "git")) {
      return {
        source: "repository",
        url: urlMatch[1],
      };
    }
  }

  const projectUrlMatch = xml.match(/<projectUrl>\s*([^<]+?)\s*<\/projectUrl>/i);
  if (projectUrlMatch) {
    return {
      source: "projectUrl",
      url: projectUrlMatch[1],
    };
  }

  return null;
}

async function fetchNuspecMetadata(
  packageBaseAddress: string,
  packageId: string,
  version: string,
): Promise<NuGetMetadataCandidate | null> {
  const packageLower = packageId.toLowerCase();
  const versionLower = version.toLowerCase();
  const nuspecUrl = joinUrl(
    packageBaseAddress,
    `${packageLower}/${versionLower}/${packageLower}.nuspec`,
  );

  const response = await fetch(nuspecUrl, {
    headers: {
      Accept: "application/xml,text/xml",
      "User-Agent": "opensrc-cli",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(
      `Failed to fetch .nuspec metadata: ${response.status} ${response.statusText}`,
    );
  }

  const xml = await response.text();
  return extractRepositoryFromNuspecXml(xml);
}

function normalizeNuGetRepoUrl(rawUrl: string): string | null {
  let normalized = rawUrl.trim();
  if (!normalized) return null;

  normalized = normalized
    .replace(/^git\+/, "")
    .replace(/^git:\/\//i, "https://")
    .replace(/^ssh:\/\/git@/i, "https://")
    .replace(/^git\+ssh:\/\/git@/i, "https://")
    .replace(/^git@github.com:/i, "https://github.com/")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  url.hash = "";
  url.search = "";

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_GIT_HOSTS.has(host)) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob")) {
    url.pathname = `/${parts[0]}/${parts[1]}`;
  }

  const cleanedParts = url.pathname.split("/").filter(Boolean);
  if (cleanedParts.length !== 2) {
    return null;
  }

  cleanedParts[1] = cleanedParts[1].replace(/\.git$/i, "");

  url.pathname = `/${cleanedParts[0]}/${cleanedParts[1]}`;
  return url.toString().replace(/\/+$/, "");
}

function getRepositoryCandidate(
  leafCandidate: NuGetMetadataCandidate | null,
  nuspecCandidate: NuGetMetadataCandidate | null,
): NuGetMetadataCandidate | null {
  if (leafCandidate?.source === "repository") {
    return leafCandidate;
  }

  if (nuspecCandidate?.source === "repository") {
    return nuspecCandidate;
  }

  if (leafCandidate?.source === "projectUrl") {
    return leafCandidate;
  }

  if (nuspecCandidate?.source === "projectUrl") {
    return nuspecCandidate;
  }

  return null;
}

function getPackageLevelFallbackCandidate(
  leaves: RegistrationLeaf[],
): NuGetMetadataCandidate | null {
  for (let i = leaves.length - 1; i >= 0; i -= 1) {
    const candidate = extractRepositoryFromLeaf(leaves[i]);
    if (candidate?.source === "repository") {
      return candidate;
    }
  }

  for (let i = leaves.length - 1; i >= 0; i -= 1) {
    const candidate = extractRepositoryFromLeaf(leaves[i]);
    if (candidate?.source === "projectUrl") {
      return candidate;
    }
  }

  return null;
}

/**
 * Parse a NuGet package specifier like "Newtonsoft.Json@13.0.3"
 */
export function parseNuGetSpec(spec: string): {
  name: string;
  version?: string;
} {
  const trimmed = spec.trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex > 0) {
    return {
      name: trimmed.slice(0, atIndex).trim(),
      version: trimmed.slice(atIndex + 1).trim(),
    };
  }

  return { name: trimmed };
}

/**
 * Resolve a NuGet package to its upstream repository information
 */
export async function resolveNuGetPackage(
  packageName: string,
  version?: string,
  options: { allowPrerelease?: boolean } = {},
): Promise<ResolvedPackage> {
  const { name } = parseNuGetSpec(packageName);
  if (!name) {
    throw new Error("NuGet package name is required");
  }

  const serviceIndex = await fetchJson<NuGetServiceIndex>(NUGET_SERVICE_INDEX);
  const registrationsBaseUrl = getNuGetResource(
    serviceIndex,
    "RegistrationsBaseUrl",
  );
  const packageBaseAddress = getNuGetResource(serviceIndex, "PackageBaseAddress");

  const leaves = await fetchRegistrationLeaves(registrationsBaseUrl, name);
  if (leaves.length === 0) {
    throw new Error(`Package "${name}" not found on NuGet`);
  }

  const resolvedVersion = resolveVersionFromLeaves(
    leaves,
    name,
    version,
    options.allowPrerelease ?? false,
  );
  const matchingLeaf = findLeafByVersion(leaves, resolvedVersion);

  if (!matchingLeaf) {
    throw new Error(
      `Version "${resolvedVersion}" not found for "${name}" on NuGet`,
    );
  }

  const leafCandidate = extractRepositoryFromLeaf(matchingLeaf);
  const nuspecCandidate =
    leafCandidate?.source === "repository"
      ? null
      : await fetchNuspecMetadata(packageBaseAddress, name, resolvedVersion);

  const candidate = getRepositoryCandidate(leafCandidate, nuspecCandidate);
  const selectedCandidate = candidate ?? getPackageLevelFallbackCandidate(leaves);

  if (!selectedCandidate) {
    throw new Error(
      `No repository metadata found for "${name}@${resolvedVersion}" on NuGet (checked repository and projectUrl fields)`,
    );
  }

  const repoUrl = normalizeNuGetRepoUrl(selectedCandidate.url);
  if (!repoUrl) {
    throw new Error(
      `Invalid non-cloneable ${selectedCandidate.source} URL for "${name}@${resolvedVersion}": ${selectedCandidate.url}`,
    );
  }

  return {
    registry: "nuget",
    name,
    version: resolvedVersion,
    repoUrl,
    gitTag: `v${resolvedVersion}`,
  };
}

export const __internal = {
  normalizeNuGetRepoUrl,
  extractRepositoryFromNuspecXml,
};
