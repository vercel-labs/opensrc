export interface PackageInfo {
  name: string;
  version: string;
  repository?: {
    type: string;
    url: string;
    directory?: string;
  };
}

export interface RegistryResponse {
  name: string;
  "dist-tags": {
    latest: string;
    [key: string]: string;
  };
  versions: {
    [version: string]: PackageInfo;
  };
  repository?: {
    type: string;
    url: string;
    directory?: string;
  };
}

export interface ResolvedPackage {
  name: string;
  version: string;
  repoUrl: string;
  repoDirectory?: string;
  gitTag: string;
}

export interface FetchResult {
  package: string;
  version: string;
  path: string;
  success: boolean;
  error?: string;
}

export interface InstalledPackage {
  name: string;
  version: string;
}

/**
 * Parsed repository specification
 */
export interface RepoSpec {
  owner: string;
  repo: string;
  ref?: string; // branch, tag, or commit
}

/**
 * Type of input: npm package or GitHub repo
 */
export type InputType = "package" | "repo";

/**
 * Resolved repository information (for direct GitHub repos)
 */
export interface ResolvedRepo {
  owner: string;
  repo: string;
  ref: string; // branch, tag, or commit (resolved)
  repoUrl: string;
  displayName: string; // e.g., "owner--repo"
}
