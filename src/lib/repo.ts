import type { RepoSpec, ResolvedRepo } from "../types.js";

// Supported git hosts
const SUPPORTED_HOSTS = ["github.com", "gitlab.com", "bitbucket.org"];
const DEFAULT_HOST = "github.com";

/**
 * Parse a repository specification into host, owner and repo
 * Supports:
 * - github:owner/repo
 * - github:owner/repo@ref
 * - gitlab:owner/repo
 * - owner/repo (defaults to github.com)
 * - owner/repo@ref
 * - owner/repo#ref
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo#ref
 * - https://gitlab.com/owner/repo
 * - https://github.com/owner/repo/tree/branch
 * - github.com/owner/repo
 */
export function parseRepoSpec(spec: string): RepoSpec | null {
  let input = spec.trim();
  let ref: string | undefined;
  let host: string = DEFAULT_HOST;

  // Handle shorthand prefixes: github:, gitlab:, bitbucket:
  if (input.startsWith("github:")) {
    host = "github.com";
    input = input.slice(7);
  } else if (input.startsWith("gitlab:")) {
    host = "gitlab.com";
    input = input.slice(7);
  } else if (input.startsWith("bitbucket:")) {
    host = "bitbucket.org";
    input = input.slice(10);
  }
  // Handle full URLs: https://github.com/owner/repo
  else if (input.match(/^https?:\/\//)) {
    try {
      const url = new URL(input);
      host = url.hostname;
      const pathParts = url.pathname.slice(1).split("/").filter(Boolean);

      if (pathParts.length < 2) {
        return null;
      }

      const owner = pathParts[0];
      let repo = pathParts[1];

      // Remove .git suffix if present
      if (repo.endsWith(".git")) {
        repo = repo.slice(0, -4);
      }

      const hashRef = url.hash ? decodeURIComponent(url.hash.slice(1)) : "";
      if (hashRef) {
        ref = hashRef;
      } else if (
        pathParts.length >= 4 &&
        (pathParts[2] === "tree" || pathParts[2] === "blob")
      ) {
        // Handle /tree/branch or /blob/branch URLs
        ref = pathParts[3];
      }

      return { host, owner, repo, ref };
    } catch {
      return null;
    }
  }
  // Handle host/owner/repo format: github.com/owner/repo
  else if (SUPPORTED_HOSTS.some((h) => input.startsWith(`${h}/`))) {
    const firstSlash = input.indexOf("/");
    host = input.slice(0, firstSlash);
    input = input.slice(firstSlash + 1);
  }
  // Not a repo format if it starts with @ (scoped npm package)
  else if (input.startsWith("@")) {
    return null;
  }
  // Must contain exactly one / to be a repo (owner/repo)
  else if (input.split("/").length !== 2) {
    return null;
  }

  // Extract ref from @ or # suffix
  // owner/repo@v1.0.0 or owner/repo#main
  const atIndex = input.indexOf("@");
  const hashIndex = input.indexOf("#");

  if (atIndex > 0) {
    ref = input.slice(atIndex + 1);
    input = input.slice(0, atIndex);
  } else if (hashIndex > 0) {
    ref = input.slice(hashIndex + 1);
    input = input.slice(0, hashIndex);
  }

  // Split into owner/repo
  const parts = input.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  return {
    host,
    owner: parts[0],
    repo: parts[1],
    ref,
  };
}

/**
 * Check if a string looks like a repo spec rather than an npm package
 */
export function isRepoSpec(spec: string): boolean {
  const trimmed = spec.trim();

  // Explicit prefix (github:, gitlab:, bitbucket:)
  if (
    trimmed.startsWith("github:") ||
    trimmed.startsWith("gitlab:") ||
    trimmed.startsWith("bitbucket:")
  ) {
    return true;
  }

  // Git host URL (any host)
  if (trimmed.match(/^https?:\/\//)) {
    try {
      const url = new URL(trimmed);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return true;
      }
    } catch {
      // Fall through
    }
  }

  // host/owner/repo format
  if (SUPPORTED_HOSTS.some((h) => trimmed.startsWith(`${h}/`))) {
    return true;
  }

  // Scoped npm packages start with @
  if (trimmed.startsWith("@")) {
    return false;
  }

  // owner/repo format (must have exactly one /)
  // But need to distinguish from things that aren't repos
  const parts = trimmed.split("/");
  if (parts.length === 2 && parts[0] && parts[1]) {
    // Extract the repo part (before any @ or #)
    const repoPart = parts[1].split("@")[0].split("#")[0];
    // Valid usernames and repos: alphanumeric, hyphens, underscores
    // Repos can also have dots
    const validOwner = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(parts[0]);
    const validRepo = /^[a-zA-Z0-9._-]+$/.test(repoPart);
    return validOwner && validRepo;
  }

  return false;
}

interface GitHubApiResponse {
  default_branch: string;
  clone_url: string;
  html_url: string;
}

interface GitLabApiResponse {
  default_branch: string;
  http_url_to_repo: string;
  web_url: string;
}

/**
 * Resolve a repo spec to full repository information using the appropriate API
 */
export async function resolveRepo(spec: RepoSpec): Promise<ResolvedRepo> {
  const { host, owner, repo, ref } = spec;

  if (host === "github.com") {
    return resolveGitHubRepo(host, owner, repo, ref);
  } else if (host === "gitlab.com") {
    return resolveGitLabRepo(host, owner, repo, ref);
  } else {
    // For unsupported hosts, assume default branch is "main"
    return {
      host,
      owner,
      repo,
      ref: ref || "main",
      repoUrl: `https://${host}/${owner}/${repo}`,
      displayName: `${host}/${owner}/${repo}`,
    };
  }
}

async function resolveGitHubRepo(
  host: string,
  owner: string,
  repo: string,
  ref?: string,
): Promise<ResolvedRepo> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "opensrc-cli",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Repository "${owner}/${repo}" not found on GitHub. ` +
          `Make sure it exists and is public.`,
      );
    }
    if (response.status === 403) {
      throw new Error(
        `GitHub API rate limit exceeded. Try again later or authenticate.`,
      );
    }
    throw new Error(
      `Failed to fetch repository info: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as GitHubApiResponse;
  const resolvedRef = ref || data.default_branch;

  return {
    host,
    owner,
    repo,
    ref: resolvedRef,
    repoUrl: `https://github.com/${owner}/${repo}`,
    displayName: `${host}/${owner}/${repo}`,
  };
}

async function resolveGitLabRepo(
  host: string,
  owner: string,
  repo: string,
  ref?: string,
): Promise<ResolvedRepo> {
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const apiUrl = `https://gitlab.com/api/v4/projects/${projectPath}`;

  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "opensrc-cli",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Repository "${owner}/${repo}" not found on GitLab. ` +
          `Make sure it exists and is public.`,
      );
    }
    throw new Error(
      `Failed to fetch repository info: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as GitLabApiResponse;
  const resolvedRef = ref || data.default_branch;

  return {
    host,
    owner,
    repo,
    ref: resolvedRef,
    repoUrl: `https://gitlab.com/${owner}/${repo}`,
    displayName: `${host}/${owner}/${repo}`,
  };
}

/**
 * Convert a repo display name back to host/owner/repo format
 */
export function displayNameToSpec(displayName: string): {
  host: string;
  owner: string;
  repo: string;
} | null {
  const parts = displayName.split("/");
  if (parts.length !== 3) {
    return null;
  }
  return { host: parts[0], owner: parts[1], repo: parts[2] };
}

/**
 * @deprecated Use displayNameToSpec instead
 */
export function displayNameToOwnerRepo(displayName: string): {
  owner: string;
  repo: string;
} | null {
  // Handle old format: owner--repo
  if (displayName.includes("--") && !displayName.includes("/")) {
    const parts = displayName.split("--");
    if (parts.length !== 2) {
      return null;
    }
    return { owner: parts[0], repo: parts[1] };
  }

  // Handle new format: host/owner/repo
  const spec = displayNameToSpec(displayName);
  if (!spec) {
    return null;
  }
  return { owner: spec.owner, repo: spec.repo };
}
