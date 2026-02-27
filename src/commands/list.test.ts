import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/git.js", () => ({
  listSources: vi.fn(),
}));

import { listCommand } from "./list.js";
import { listSources } from "../lib/git.js";

describe("listCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints NuGet in supported registries when empty", async () => {
    vi.mocked(listSources).mockResolvedValue({ packages: [], repos: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listCommand();

    const output = logSpy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("NuGet");
    expect(output).toContain("nuget:Newtonsoft.Json");
  });

  it("groups NuGet packages in their own section", async () => {
    vi.mocked(listSources).mockResolvedValue({
      packages: [
        {
          name: "Serilog",
          version: "3.1.0",
          registry: "nuget",
          path: "repos/github.com/serilog/serilog",
          fetchedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      repos: [],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await listCommand();

    const output = logSpy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(output).toContain("NuGet Packages:");
    expect(output).toContain("1 NuGet");
  });
});
