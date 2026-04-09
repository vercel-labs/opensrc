const REPO = "vercel-labs/opensrc";
const REVALIDATE = 86400; // 24 hours — stars don't change fast

export async function getStarCount(): Promise<string> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers,
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return "";
    const data = await res.json();
    const count = data.stargazers_count;
    if (typeof count !== "number") return "";
    if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
    return String(count);
  } catch {
    return "";
  }
}
