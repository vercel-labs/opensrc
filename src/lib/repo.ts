import type { RepoSpec, ResolvedRepo } from "../types.js";

/**
 * Parse a repository specification into owner and repo
 * Supports:
 * - github:owner/repo
 * - github:owner/repo@ref
 * - github:owner/repo#ref
 * - owner/repo (when contains / and no @scope)
 * - owner/repo@ref
 * - owner/repo#ref
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/branch
 */
export function parseRepoSpec(spec: string): RepoSpec | null {
  let input = spec.trim();
  let ref: string | undefined;

  // Handle github: prefix
  if (input.startsWith("github:")) {
    input = input.slice(7); // Remove "github:"
  }
  // Handle https://github.com/ URLs
  else if (
    input.startsWith("https://github.com/") ||
    input.startsWith("http://github.com/")
  ) {
    // Extract path after github.com/
    const url = new URL(input);
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

    // Handle /tree/branch or /blob/branch URLs
    if (
      pathParts.length >= 4 &&
      (pathParts[2] === "tree" || pathParts[2] === "blob")
    ) {
      ref = pathParts[3];
    }

    return { owner, repo, ref };
  }
  // Not a repo format if it starts with @ (scoped npm package)
  else if (input.startsWith("@")) {
    return null;
  }
  // Must contain exactly one / to be a repo (owner/repo)
  else if (!input.includes("/")) {
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

  // Explicit github: prefix
  if (trimmed.startsWith("github:")) {
    return true;
  }

  // GitHub URL
  if (
    trimmed.startsWith("https://github.com/") ||
    trimmed.startsWith("http://github.com/")
  ) {
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
    // Valid GitHub usernames and repos: alphanumeric, hyphens, underscores
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

/**
 * Resolve a repo spec to full repository information using GitHub API
 */
export async function resolveRepo(spec: RepoSpec): Promise<ResolvedRepo> {
  const { owner, repo, ref } = spec;
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

  // Use provided ref or fall back to default branch
  const resolvedRef = ref || data.default_branch;

  return {
    owner,
    repo,
    ref: resolvedRef,
    repoUrl: `https://github.com/${owner}/${repo}`,
    displayName: `${owner}--${repo}`,
  };
}

/**
 * Convert a repo display name back to owner/repo format
 */
export function displayNameToOwnerRepo(displayName: string): {
  owner: string;
  repo: string;
} | null {
  const parts = displayName.split("--");
  if (parts.length !== 2) {
    return null;
  }
  return { owner: parts[0], repo: parts[1] };
}
