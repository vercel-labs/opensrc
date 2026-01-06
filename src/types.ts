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
