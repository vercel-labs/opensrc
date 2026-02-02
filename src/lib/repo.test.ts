import { describe, it, expect } from "vitest";
import {
  parseRepoSpec,
  isRepoSpec,
  displayNameToSpec,
  displayNameToOwnerRepo,
} from "./repo.js";

describe("parseRepoSpec", () => {
  describe("github: prefix", () => {
    it("parses github:owner/repo", () => {
      const result = parseRepoSpec("github:vercel/next.js");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "next.js",
        ref: undefined,
      });
    });

    it("parses github:owner/repo@ref", () => {
      const result = parseRepoSpec("github:vercel/next.js@v14.0.0");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "next.js",
        ref: "v14.0.0",
      });
    });

    it("parses github:owner/repo#ref", () => {
      const result = parseRepoSpec("github:vercel/next.js#main");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "next.js",
        ref: "main",
      });
    });
  });

  describe("gitlab: prefix", () => {
    it("parses gitlab:owner/repo", () => {
      const result = parseRepoSpec("gitlab:gitlab-org/gitlab");
      expect(result).toEqual({
        host: "gitlab.com",
        owner: "gitlab-org",
        repo: "gitlab",
        ref: undefined,
      });
    });

    it("parses gitlab:owner/repo@ref", () => {
      const result = parseRepoSpec("gitlab:gitlab-org/gitlab@v16.0.0");
      expect(result).toEqual({
        host: "gitlab.com",
        owner: "gitlab-org",
        repo: "gitlab",
        ref: "v16.0.0",
      });
    });
  });

  describe("bitbucket: prefix", () => {
    it("parses bitbucket:owner/repo", () => {
      const result = parseRepoSpec("bitbucket:atlassian/python-bitbucket");
      expect(result).toEqual({
        host: "bitbucket.org",
        owner: "atlassian",
        repo: "python-bitbucket",
        ref: undefined,
      });
    });
  });

  describe("full URLs", () => {
    it("parses https://github.com/owner/repo", () => {
      const result = parseRepoSpec("https://github.com/vercel/ai");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "ai",
        ref: undefined,
      });
    });

    it("parses https://github.com/owner/repo#ref", () => {
      const result = parseRepoSpec("https://github.com/vercel/ai#canary");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "ai",
        ref: "canary",
      });
    });

    it("parses https://github.com/owner/repo#ref/with/slash", () => {
      const result = parseRepoSpec("https://github.com/vercel/ai#feature/foo");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "ai",
        ref: "feature/foo",
      });
    });

    it("parses https://github.com/owner/repo.git", () => {
      const result = parseRepoSpec("https://github.com/vercel/ai.git");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "ai",
        ref: undefined,
      });
    });

    it("parses https://github.com/owner/repo/tree/branch", () => {
      const result = parseRepoSpec("https://github.com/vercel/ai/tree/canary");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "ai",
        ref: "canary",
      });
    });

    it("parses https://gitlab.com/owner/repo", () => {
      const result = parseRepoSpec("https://gitlab.com/gitlab-org/gitlab");
      expect(result).toEqual({
        host: "gitlab.com",
        owner: "gitlab-org",
        repo: "gitlab",
        ref: undefined,
      });
    });

    it("parses http:// URLs", () => {
      const result = parseRepoSpec("http://github.com/owner/repo");
      expect(result).toEqual({
        host: "github.com",
        owner: "owner",
        repo: "repo",
        ref: undefined,
      });
    });
  });

  describe("host/owner/repo format", () => {
    it("parses github.com/owner/repo", () => {
      const result = parseRepoSpec("github.com/vercel/next.js");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "next.js",
        ref: undefined,
      });
    });

    it("parses gitlab.com/owner/repo", () => {
      const result = parseRepoSpec("gitlab.com/gitlab-org/gitlab");
      expect(result).toEqual({
        host: "gitlab.com",
        owner: "gitlab-org",
        repo: "gitlab",
        ref: undefined,
      });
    });
  });

  describe("owner/repo format (defaults to github.com)", () => {
    it("parses owner/repo", () => {
      const result = parseRepoSpec("vercel/next.js");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "next.js",
        ref: undefined,
      });
    });

    it("parses owner/repo@ref", () => {
      const result = parseRepoSpec("vercel/next.js@v14.0.0");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "next.js",
        ref: "v14.0.0",
      });
    });

    it("parses owner/repo#ref", () => {
      const result = parseRepoSpec("vercel/ai#main");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "ai",
        ref: "main",
      });
    });

    it("handles repos with dots", () => {
      const result = parseRepoSpec("vercel/next.js");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "next.js",
        ref: undefined,
      });
    });

    it("handles repos with hyphens", () => {
      const result = parseRepoSpec("facebook/react-native");
      expect(result).toEqual({
        host: "github.com",
        owner: "facebook",
        repo: "react-native",
        ref: undefined,
      });
    });
  });

  describe("invalid inputs", () => {
    it("returns null for scoped npm packages", () => {
      expect(parseRepoSpec("@babel/core")).toBeNull();
      expect(parseRepoSpec("@types/node")).toBeNull();
    });

    it("returns null for plain package names", () => {
      expect(parseRepoSpec("lodash")).toBeNull();
      expect(parseRepoSpec("react")).toBeNull();
    });

    it("returns null for invalid URL paths", () => {
      expect(parseRepoSpec("https://github.com/")).toBeNull();
      expect(parseRepoSpec("https://github.com/owner")).toBeNull();
    });
  });

  describe("whitespace handling", () => {
    it("trims whitespace", () => {
      const result = parseRepoSpec("  vercel/ai  ");
      expect(result).toEqual({
        host: "github.com",
        owner: "vercel",
        repo: "ai",
        ref: undefined,
      });
    });
  });
});

describe("isRepoSpec", () => {
  describe("returns true for repo specs", () => {
    it("github: prefix", () => {
      expect(isRepoSpec("github:vercel/ai")).toBe(true);
    });

    it("gitlab: prefix", () => {
      expect(isRepoSpec("gitlab:owner/repo")).toBe(true);
    });

    it("bitbucket: prefix", () => {
      expect(isRepoSpec("bitbucket:owner/repo")).toBe(true);
    });

    it("GitHub URLs", () => {
      expect(isRepoSpec("https://github.com/vercel/ai")).toBe(true);
      expect(isRepoSpec("http://github.com/vercel/ai")).toBe(true);
    });

    it("GitLab URLs", () => {
      expect(isRepoSpec("https://gitlab.com/owner/repo")).toBe(true);
    });

    it("Bitbucket URLs", () => {
      expect(isRepoSpec("https://bitbucket.org/owner/repo")).toBe(true);
    });

    it("non-standard host URLs with git signals", () => {
      expect(isRepoSpec("https://git.example.com/owner/repo")).toBe(true);
      expect(isRepoSpec("https://example.com/owner/repo.git")).toBe(true);
      expect(isRepoSpec("https://example.com/owner/repo/tree/main")).toBe(true);
    });

    it("host/owner/repo format", () => {
      expect(isRepoSpec("github.com/vercel/ai")).toBe(true);
    });

    it("owner/repo format", () => {
      expect(isRepoSpec("vercel/ai")).toBe(true);
      expect(isRepoSpec("facebook/react")).toBe(true);
    });

    it("owner/repo with ref", () => {
      expect(isRepoSpec("vercel/ai@main")).toBe(true);
      expect(isRepoSpec("vercel/ai#canary")).toBe(true);
    });
  });

  describe("returns false for non-repo specs", () => {
    it("scoped npm packages", () => {
      expect(isRepoSpec("@babel/core")).toBe(false);
      expect(isRepoSpec("@types/node")).toBe(false);
      expect(isRepoSpec("@scope/package@1.0.0")).toBe(false);
    });

    it("plain package names", () => {
      expect(isRepoSpec("lodash")).toBe(false);
      expect(isRepoSpec("react")).toBe(false);
      expect(isRepoSpec("zod")).toBe(false);
    });

    it("package names with version", () => {
      expect(isRepoSpec("lodash@4.17.0")).toBe(false);
      expect(isRepoSpec("react@18.2.0")).toBe(false);
    });

    it("non-standard host URLs without git signals", () => {
      expect(isRepoSpec("https://example.com/owner/repo")).toBe(false);
    });
  });
});

describe("displayNameToSpec", () => {
  it("parses host/owner/repo format", () => {
    expect(displayNameToSpec("github.com/vercel/ai")).toEqual({
      host: "github.com",
      owner: "vercel",
      repo: "ai",
    });
  });

  it("parses gitlab host", () => {
    expect(displayNameToSpec("gitlab.com/owner/repo")).toEqual({
      host: "gitlab.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("returns null for invalid format", () => {
    expect(displayNameToSpec("vercel/ai")).toBeNull();
    expect(displayNameToSpec("vercel--ai")).toBeNull();
    expect(displayNameToSpec("invalid")).toBeNull();
  });
});

describe("displayNameToOwnerRepo", () => {
  it("handles old format (owner--repo)", () => {
    expect(displayNameToOwnerRepo("vercel--ai")).toEqual({
      owner: "vercel",
      repo: "ai",
    });
  });

  it("handles new format (host/owner/repo)", () => {
    expect(displayNameToOwnerRepo("github.com/vercel/ai")).toEqual({
      owner: "vercel",
      repo: "ai",
    });
  });

  it("returns null for invalid format", () => {
    expect(displayNameToOwnerRepo("invalid")).toBeNull();
    expect(displayNameToOwnerRepo("vercel/ai")).toBeNull();
  });
});
