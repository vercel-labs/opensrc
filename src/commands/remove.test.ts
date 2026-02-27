import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/git.js", () => ({
  removePackageSource: vi.fn(),
  removeRepoSource: vi.fn(),
  repoExists: vi.fn(),
  listSources: vi.fn(),
  getPackageInfo: vi.fn(),
}));

vi.mock("../lib/agents.js", () => ({
  updateAgentsMd: vi.fn(),
  updatePackageIndex: vi.fn(),
}));

vi.mock("../lib/settings.js", () => ({
  getFileModificationPermission: vi.fn(),
}));

vi.mock("../lib/repo.js", () => ({
  isRepoSpec: vi.fn(() => false),
}));

vi.mock("../lib/registries/index.js", () => ({
  detectRegistry: vi.fn(() => ({ registry: "npm", cleanSpec: "Serilog" })),
}));

import { removeCommand } from "./remove.js";
import { getFileModificationPermission } from "../lib/settings.js";
import { detectRegistry } from "../lib/registries/index.js";
import { getPackageInfo, removePackageSource, listSources } from "../lib/git.js";

describe("removeCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFileModificationPermission).mockResolvedValue(false);
    vi.mocked(listSources).mockResolvedValue({ packages: [], repos: [] });
  });

  it("falls back through nuget registry when default lookup misses", async () => {
    vi.mocked(detectRegistry).mockReturnValue({
      registry: "npm",
      cleanSpec: "Serilog",
    });

    vi.mocked(getPackageInfo)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        name: "Serilog",
        version: "3.1.0",
        registry: "nuget",
        path: "repos/github.com/serilog/serilog",
        fetchedAt: "2026-01-01T00:00:00.000Z",
      });

    vi.mocked(removePackageSource).mockResolvedValue({
      removed: true,
      repoRemoved: false,
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await removeCommand(["Serilog"]);

    expect(getPackageInfo).toHaveBeenCalledWith("Serilog", expect.any(String), "nuget");
    expect(removePackageSource).toHaveBeenCalledWith(
      "Serilog",
      expect.any(String),
      "nuget",
    );

    const output = logSpy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("(nuget)");
  });
});
