import { describe, it, expect } from "vitest";
import { buildUpdateSpecs } from "./update.js";
import type { PackageEntry, RepoEntry } from "../lib/agents.js";

const sources = {
  packages: [
    {
      name: "zod",
      version: "3.22.0",
      registry: "npm",
      path: "zod",
      fetchedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      name: "requests",
      version: "2.31.0",
      registry: "pypi",
      path: "requests",
      fetchedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      name: "serde",
      version: "1.0.0",
      registry: "crates",
      path: "serde",
      fetchedAt: "2024-01-01T00:00:00.000Z",
    },
  ],
  repos: [
    {
      name: "github.com/vercel/ai",
      version: "main",
      path: "repos/github.com/vercel/ai",
      fetchedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      name: "example.com/foo/bar",
      version: "HEAD",
      path: "repos/example.com/foo/bar",
      fetchedAt: "2024-01-01T00:00:00.000Z",
    },
  ],
} satisfies { packages: PackageEntry[]; repos: RepoEntry[] };

describe("buildUpdateSpecs", () => {
  it("builds specs for all sources by default", () => {
    const { specs, packageCount, repoCount } = buildUpdateSpecs(sources);

    expect(packageCount).toBe(3);
    expect(repoCount).toBe(2);
    expect(specs).toEqual([
      "npm:zod",
      "pypi:requests",
      "crates:serde",
      "https://github.com/vercel/ai#main",
      "https://example.com/foo/bar",
    ]);
  });

  it("filters by registry", () => {
    const { specs, packageCount, repoCount } = buildUpdateSpecs(sources, {
      registry: "pypi",
    });

    expect(packageCount).toBe(1);
    expect(repoCount).toBe(0);
    expect(specs).toEqual(["pypi:requests"]);
  });

  it("updates only packages when requested", () => {
    const { specs, packageCount, repoCount } = buildUpdateSpecs(sources, {
      packages: true,
      repos: false,
    });

    expect(packageCount).toBe(3);
    expect(repoCount).toBe(0);
    expect(specs).toEqual(["npm:zod", "pypi:requests", "crates:serde"]);
  });

  it("updates only repos when requested", () => {
    const { specs, packageCount, repoCount } = buildUpdateSpecs(sources, {
      packages: false,
      repos: true,
    });

    expect(packageCount).toBe(0);
    expect(repoCount).toBe(2);
    expect(specs).toEqual([
      "https://github.com/vercel/ai#main",
      "https://example.com/foo/bar",
    ]);
  });
});
