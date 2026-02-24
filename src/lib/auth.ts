/**
 * Build an authenticated clone URL for a repo if a matching token is available.
 * Returns undefined when no token is set for the host.
 */
export function getAuthenticatedCloneUrl(
  repoUrl: string,
): string | undefined {
  let host: string;
  let path: string;

  try {
    const url = new URL(repoUrl);
    host = url.hostname;
    path = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    return undefined;
  }

  if (host === "github.com") {
    const token =
      process.env.OPENSRC_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      return `https://x-access-token:${token}@github.com/${path}`;
    }
  } else if (host === "gitlab.com") {
    const token =
      process.env.OPENSRC_GITLAB_TOKEN || process.env.GITLAB_TOKEN;
    if (token) {
      return `https://oauth2:${token}@gitlab.com/${path}`;
    }
  }

  return undefined;
}
