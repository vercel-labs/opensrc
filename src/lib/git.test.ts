import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import {
  getOpensrcDir,
  getReposDir,
  getRepoPath,
  getRepoRelativePath,
  parseRepoUrl,
  getRepoDisplayName,
  repoExists,
  packageRepoExists,
  getPackageInfo,
  getRepoInfo,
  listSources,
  removePackageSource,
  removeRepoSource,
  sanitizeError,
} from "./git.js";

const TEST_DIR = join(process.cwd(), ".test-git");
const OPENSRC_DIR = join(TEST_DIR, "opensrc");

beforeEach(async () => {
  await mkdir(OPENSRC_DIR, { recursive: true });
});

afterEach(async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true, force: true });
  }
});

describe("path helpers", () => {
  describe("getOpensrcDir", () => {
    it("returns opensrc directory path", () => {
      expect(getOpensrcDir("/project")).toBe("/project/opensrc");
    });

    it("uses cwd by default", () => {
      expect(getOpensrcDir()).toBe(join(process.cwd(), "opensrc"));
    });
  });

  describe("getReposDir", () => {
    it("returns repos directory path", () => {
      expect(getReposDir("/project")).toBe("/project/opensrc/repos");
    });
  });

  describe("getRepoPath", () => {
    it("returns full path for repo", () => {
      expect(getRepoPath("github.com/vercel/ai", "/project")).toBe(
        "/project/opensrc/repos/github.com/vercel/ai",
      );
    });

    it("handles different hosts", () => {
      expect(getRepoPath("gitlab.com/owner/repo", "/project")).toBe(
        "/project/opensrc/repos/gitlab.com/owner/repo",
      );
    });
  });

  describe("getRepoRelativePath", () => {
    it("returns relative path for repo", () => {
      expect(getRepoRelativePath("github.com/vercel/ai")).toBe(
        "repos/github.com/vercel/ai",
      );
    });
  });
});

describe("parseRepoUrl", () => {
  it("parses HTTPS GitHub URL", () => {
    expect(parseRepoUrl("https://github.com/vercel/ai")).toEqual({
      host: "github.com",
      owner: "vercel",
      repo: "ai",
    });
  });

  it("parses HTTPS URL with .git suffix", () => {
    expect(parseRepoUrl("https://github.com/vercel/ai.git")).toEqual({
      host: "github.com",
      owner: "vercel",
      repo: "ai",
    });
  });

  it("parses HTTPS GitLab URL", () => {
    expect(parseRepoUrl("https://gitlab.com/owner/repo")).toEqual({
      host: "gitlab.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses SSH URL", () => {
    expect(parseRepoUrl("git@github.com:vercel/ai.git")).toEqual({
      host: "github.com",
      owner: "vercel",
      repo: "ai",
    });
  });

  it("returns null for invalid URL", () => {
    expect(parseRepoUrl("invalid")).toBeNull();
  });
});

describe("getRepoDisplayName", () => {
  it("extracts display name from HTTPS URL", () => {
    expect(getRepoDisplayName("https://github.com/vercel/ai")).toBe(
      "github.com/vercel/ai",
    );
  });

  it("extracts display name from SSH URL", () => {
    expect(getRepoDisplayName("git@github.com:colinhacks/zod.git")).toBe(
      "github.com/colinhacks/zod",
    );
  });

  it("returns null for invalid URL", () => {
    expect(getRepoDisplayName("invalid")).toBeNull();
  });
});

describe("existence checks", () => {
  describe("repoExists", () => {
    it("returns false if repo does not exist", () => {
      expect(repoExists("github.com/vercel/ai", TEST_DIR)).toBe(false);
    });

    it("returns true if repo exists", async () => {
      const repoDir = join(OPENSRC_DIR, "repos", "github.com", "vercel", "ai");
      await mkdir(repoDir, { recursive: true });

      expect(repoExists("github.com/vercel/ai", TEST_DIR)).toBe(true);
    });
  });

  describe("packageRepoExists", () => {
    it("returns false if repo does not exist", () => {
      expect(packageRepoExists("https://github.com/vercel/ai", TEST_DIR)).toBe(
        false,
      );
    });

    it("returns true if repo exists", async () => {
      const repoDir = join(OPENSRC_DIR, "repos", "github.com", "vercel", "ai");
      await mkdir(repoDir, { recursive: true });

      expect(packageRepoExists("https://github.com/vercel/ai", TEST_DIR)).toBe(
        true,
      );
    });

    it("returns false for invalid URL", () => {
      expect(packageRepoExists("invalid", TEST_DIR)).toBe(false);
    });
  });
});

describe("sources.json reading", () => {
  describe("getPackageInfo", () => {
    it("returns null if sources.json does not exist", async () => {
      expect(await getPackageInfo("zod", TEST_DIR, "npm")).toBeNull();
    });

    it("returns null if package not in sources.json", async () => {
      await writeFile(
        join(OPENSRC_DIR, "sources.json"),
        JSON.stringify({ packages: [] }),
      );

      expect(await getPackageInfo("zod", TEST_DIR, "npm")).toBeNull();
    });

    it("returns package info if found", async () => {
      await writeFile(
        join(OPENSRC_DIR, "sources.json"),
        JSON.stringify({
          packages: [
            {
              name: "zod",
              version: "3.22.0",
              registry: "npm",
              path: "repos/github.com/colinhacks/zod",
              fetchedAt: "2024-01-01",
            },
          ],
        }),
      );

      const info = await getPackageInfo("zod", TEST_DIR, "npm");
      expect(info).toEqual({
        name: "zod",
        version: "3.22.0",
        registry: "npm",
        path: "repos/github.com/colinhacks/zod",
        fetchedAt: "2024-01-01",
      });
    });

    it("returns null for wrong registry", async () => {
      await writeFile(
        join(OPENSRC_DIR, "sources.json"),
        JSON.stringify({
          packages: [
            {
              name: "zod",
              version: "3.22.0",
              registry: "npm",
              path: "repos/github.com/colinhacks/zod",
              fetchedAt: "2024-01-01",
            },
          ],
        }),
      );

      expect(await getPackageInfo("zod", TEST_DIR, "pypi")).toBeNull();
    });
  });

  describe("getRepoInfo", () => {
    it("returns null if sources.json does not exist", async () => {
      expect(await getRepoInfo("github.com/vercel/ai", TEST_DIR)).toBeNull();
    });

    it("returns null if repo not in sources.json", async () => {
      await writeFile(
        join(OPENSRC_DIR, "sources.json"),
        JSON.stringify({ repos: [] }),
      );

      expect(await getRepoInfo("github.com/vercel/ai", TEST_DIR)).toBeNull();
    });

    it("returns repo info if found", async () => {
      await writeFile(
        join(OPENSRC_DIR, "sources.json"),
        JSON.stringify({
          repos: [
            {
              name: "github.com/vercel/ai",
              version: "main",
              path: "repos/github.com/vercel/ai",
              fetchedAt: "2024-01-01",
            },
          ],
        }),
      );

      const info = await getRepoInfo("github.com/vercel/ai", TEST_DIR);
      expect(info).toEqual({
        name: "github.com/vercel/ai",
        version: "main",
        path: "repos/github.com/vercel/ai",
        fetchedAt: "2024-01-01",
      });
    });
  });

  describe("listSources", () => {
    it("returns empty if sources.json does not exist", async () => {
      const sources = await listSources(TEST_DIR);
      expect(sources).toEqual({
        packages: [],
        repos: [],
      });
    });

    it("returns sources from sources.json", async () => {
      await writeFile(
        join(OPENSRC_DIR, "sources.json"),
        JSON.stringify({
          packages: [
            {
              name: "zod",
              version: "3.22.0",
              registry: "npm",
              path: "repos/github.com/colinhacks/zod",
              fetchedAt: "2024-01-01",
            },
            {
              name: "requests",
              version: "2.31.0",
              registry: "pypi",
              path: "repos/github.com/psf/requests",
              fetchedAt: "2024-01-01",
            },
          ],
          repos: [
            {
              name: "github.com/vercel/ai",
              version: "main",
              path: "repos/github.com/vercel/ai",
              fetchedAt: "2024-01-01",
            },
          ],
        }),
      );

      const sources = await listSources(TEST_DIR);

      expect(sources.packages).toHaveLength(2);
      expect(sources.packages[0].registry).toBe("npm");
      expect(sources.packages[1].registry).toBe("pypi");
      expect(sources.repos).toHaveLength(1);
    });
  });
});

describe("sanitizeError", () => {
  it("strips GitHub token from HTTPS clone URL", () => {
    const msg =
      "Failed to clone repository: fatal: could not read from https://x-access-token:ghp_abc123@github.com/owner/repo";
    expect(sanitizeError(msg)).toBe(
      "Failed to clone repository: fatal: could not read from https://***@github.com/owner/repo",
    );
  });

  it("strips GitLab token from HTTPS clone URL", () => {
    const msg =
      "Failed to clone repository: fatal: could not read from https://oauth2:glpat-xyz789@gitlab.com/owner/repo";
    expect(sanitizeError(msg)).toBe(
      "Failed to clone repository: fatal: could not read from https://***@gitlab.com/owner/repo",
    );
  });

  it("strips multiple tokens from a single message", () => {
    const msg =
      "tried https://user:token1@github.com/a/b then https://user:token2@gitlab.com/c/d";
    expect(sanitizeError(msg)).toBe(
      "tried https://***@github.com/a/b then https://***@gitlab.com/c/d",
    );
  });

  it("leaves non-authenticated URLs unchanged", () => {
    const msg =
      "Failed to clone repository: fatal: could not read from https://github.com/owner/repo";
    expect(sanitizeError(msg)).toBe(msg);
  });

  it("leaves messages without URLs unchanged", () => {
    const msg = "Something went wrong";
    expect(sanitizeError(msg)).toBe(msg);
  });
});

describe("removal functions", () => {
  describe("removePackageSource", () => {
    it("returns removed:false if package not in sources", async () => {
      const result = await removePackageSource("zod", TEST_DIR, "npm");
      expect(result.removed).toBe(false);
      expect(result.repoRemoved).toBe(false);
    });

    it("removes repo when package is the only user", async () => {
      const repoDir = join(
        OPENSRC_DIR,
        "repos",
        "github.com",
        "colinhacks",
        "zod",
      );
      await mkdir(repoDir, { recursive: true });
      await writeFile(join(repoDir, "package.json"), "{}");
      await writeFile(
        join(OPENSRC_DIR, "sources.json"),
        JSON.stringify({
          packages: [
            {
              name: "zod",
              version: "3.22.0",
              registry: "npm",
              path: "repos/github.com/colinhacks/zod",
              fetchedAt: "2024-01-01",
            },
          ],
        }),
      );

      const result = await removePackageSource("zod", TEST_DIR, "npm");
      expect(result.removed).toBe(true);
      expect(result.repoRemoved).toBe(true);
      expect(existsSync(repoDir)).toBe(false);
    });

    it("does not remove repo when other packages share it", async () => {
      const repoDir = join(
        OPENSRC_DIR,
        "repos",
        "github.com",
        "owner",
        "monorepo",
      );
      await mkdir(repoDir, { recursive: true });
      await writeFile(join(repoDir, "package.json"), "{}");
      await writeFile(
        join(OPENSRC_DIR, "sources.json"),
        JSON.stringify({
          packages: [
            {
              name: "pkg-a",
              version: "1.0.0",
              registry: "npm",
              path: "repos/github.com/owner/monorepo/packages/a",
              fetchedAt: "2024-01-01",
            },
            {
              name: "pkg-b",
              version: "1.0.0",
              registry: "npm",
              path: "repos/github.com/owner/monorepo/packages/b",
              fetchedAt: "2024-01-01",
            },
          ],
        }),
      );

      const result = await removePackageSource("pkg-a", TEST_DIR, "npm");
      expect(result.removed).toBe(true);
      expect(result.repoRemoved).toBe(false);
      expect(existsSync(repoDir)).toBe(true);
    });
  });

  describe("removeRepoSource", () => {
    it("returns false if repo does not exist", async () => {
      const result = await removeRepoSource("github.com/vercel/ai", TEST_DIR);
      expect(result).toBe(false);
    });

    it("removes repo directory", async () => {
      const repoDir = join(OPENSRC_DIR, "repos", "github.com", "vercel", "ai");
      await mkdir(repoDir, { recursive: true });
      await writeFile(join(repoDir, "README.md"), "# AI");

      const result = await removeRepoSource("github.com/vercel/ai", TEST_DIR);
      expect(result).toBe(true);
      expect(existsSync(repoDir)).toBe(false);
    });

    it("cleans up empty owner and host directories", async () => {
      const repoDir = join(OPENSRC_DIR, "repos", "github.com", "vercel", "ai");
      await mkdir(repoDir, { recursive: true });

      await removeRepoSource("github.com/vercel/ai", TEST_DIR);

      expect(
        existsSync(join(OPENSRC_DIR, "repos", "github.com", "vercel")),
      ).toBe(false);
      expect(existsSync(join(OPENSRC_DIR, "repos", "github.com"))).toBe(false);
    });

    it("does not remove owner dir if other repos exist", async () => {
      const repo1Dir = join(OPENSRC_DIR, "repos", "github.com", "vercel", "ai");
      const repo2Dir = join(
        OPENSRC_DIR,
        "repos",
        "github.com",
        "vercel",
        "next.js",
      );
      await mkdir(repo1Dir, { recursive: true });
      await mkdir(repo2Dir, { recursive: true });

      await removeRepoSource("github.com/vercel/ai", TEST_DIR);

      expect(existsSync(repo1Dir)).toBe(false);
      expect(
        existsSync(join(OPENSRC_DIR, "repos", "github.com", "vercel")),
      ).toBe(true);
    });
  });
});
