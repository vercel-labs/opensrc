import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAuthenticatedCloneUrl } from "./auth.js";

describe("getAuthenticatedCloneUrl", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OPENSRC_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.OPENSRC_GITLAB_TOKEN;
    delete process.env.GITLAB_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("GitHub", () => {
    it("returns authenticated URL when OPENSRC_GITHUB_TOKEN is set", () => {
      process.env.OPENSRC_GITHUB_TOKEN = "ghp_test123";
      expect(getAuthenticatedCloneUrl("https://github.com/owner/repo")).toBe(
        "https://x-access-token:ghp_test123@github.com/owner/repo",
      );
    });

    it("falls back to GITHUB_TOKEN", () => {
      process.env.GITHUB_TOKEN = "ghp_fallback";
      expect(getAuthenticatedCloneUrl("https://github.com/owner/repo")).toBe(
        "https://x-access-token:ghp_fallback@github.com/owner/repo",
      );
    });

    it("prefers OPENSRC_GITHUB_TOKEN over GITHUB_TOKEN", () => {
      process.env.OPENSRC_GITHUB_TOKEN = "ghp_primary";
      process.env.GITHUB_TOKEN = "ghp_fallback";
      expect(getAuthenticatedCloneUrl("https://github.com/owner/repo")).toBe(
        "https://x-access-token:ghp_primary@github.com/owner/repo",
      );
    });

    it("returns undefined when no token is set", () => {
      expect(
        getAuthenticatedCloneUrl("https://github.com/owner/repo"),
      ).toBeUndefined();
    });

    it("strips .git suffix from URL", () => {
      process.env.OPENSRC_GITHUB_TOKEN = "ghp_test";
      expect(
        getAuthenticatedCloneUrl("https://github.com/owner/repo.git"),
      ).toBe("https://x-access-token:ghp_test@github.com/owner/repo");
    });
  });

  describe("GitLab", () => {
    it("returns authenticated URL when OPENSRC_GITLAB_TOKEN is set", () => {
      process.env.OPENSRC_GITLAB_TOKEN = "glpat_test123";
      expect(getAuthenticatedCloneUrl("https://gitlab.com/owner/repo")).toBe(
        "https://oauth2:glpat_test123@gitlab.com/owner/repo",
      );
    });

    it("falls back to GITLAB_TOKEN", () => {
      process.env.GITLAB_TOKEN = "glpat_fallback";
      expect(getAuthenticatedCloneUrl("https://gitlab.com/owner/repo")).toBe(
        "https://oauth2:glpat_fallback@gitlab.com/owner/repo",
      );
    });

    it("returns undefined when no token is set", () => {
      expect(
        getAuthenticatedCloneUrl("https://gitlab.com/owner/repo"),
      ).toBeUndefined();
    });
  });

  describe("unsupported hosts", () => {
    it("returns undefined for bitbucket", () => {
      expect(
        getAuthenticatedCloneUrl("https://bitbucket.org/owner/repo"),
      ).toBeUndefined();
    });

    it("returns undefined for unknown hosts", () => {
      expect(
        getAuthenticatedCloneUrl("https://example.com/owner/repo"),
      ).toBeUndefined();
    });
  });

  describe("invalid input", () => {
    it("returns undefined for non-URL strings", () => {
      expect(getAuthenticatedCloneUrl("not-a-url")).toBeUndefined();
    });
  });
});
