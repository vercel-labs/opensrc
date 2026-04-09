import { beforeEach, describe, expect, it, vi } from "vitest";
import { __internal, parseNuGetSpec, resolveNuGetPackage } from "./nuget.js";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(data: string, status = 200): Response {
  return new Response(data, {
    status,
    headers: { "content-type": "application/xml" },
  });
}

describe("parseNuGetSpec", () => {
  it("parses package name only", () => {
    expect(parseNuGetSpec("Newtonsoft.Json")).toEqual({
      name: "Newtonsoft.Json",
      version: undefined,
    });
  });

  it("parses package with version", () => {
    expect(parseNuGetSpec("Serilog@3.1.0")).toEqual({
      name: "Serilog",
      version: "3.1.0",
    });
  });
});

describe("normalizeNuGetRepoUrl", () => {
  it("normalizes git+ URL and strips tree path", () => {
    expect(
      __internal.normalizeNuGetRepoUrl(
        "git+https://github.com/serilog/serilog.git/tree/dev?x=1#frag",
      ),
    ).toBe("https://github.com/serilog/serilog");
  });

  it("rejects non-repo URLs", () => {
    expect(__internal.normalizeNuGetRepoUrl("https://github.com/serilog")).toBe(
      null,
    );
  });
});

describe("resolveNuGetPackage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses registration repository metadata when available", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);

        if (url.endsWith("/v3/index.json")) {
          return jsonResponse({
            resources: [
              { "@type": "RegistrationsBaseUrl/3.6.0", "@id": "https://reg/" },
              { "@type": "PackageBaseAddress/3.0.0", "@id": "https://flat/" },
            ],
          });
        }

        if (url === "https://reg/newtonsoft.json/index.json") {
          return jsonResponse({
            items: [
              {
                items: [
                  {
                    catalogEntry: {
                      version: "13.0.3",
                      repository: {
                        type: "git",
                        url: "https://github.com/jamesnk/newtonsoft.json.git",
                      },
                    },
                  },
                ],
              },
            ],
          });
        }

        throw new Error(`unexpected fetch URL: ${url}`);
      });

    const resolved = await resolveNuGetPackage("Newtonsoft.Json");

    expect(resolved.registry).toBe("nuget");
    expect(resolved.version).toBe("13.0.3");
    expect(resolved.repoUrl).toBe("https://github.com/jamesnk/newtonsoft.json");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to nuspec repository metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/v3/index.json")) {
        return jsonResponse({
          resources: [
            { "@type": "RegistrationsBaseUrl/3.6.0", "@id": "https://reg/" },
            { "@type": "PackageBaseAddress/3.0.0", "@id": "https://flat/" },
          ],
        });
      }

      if (url === "https://reg/serilog/index.json") {
        return jsonResponse({
          items: [{ items: [{ catalogEntry: { version: "3.1.0" } }] }],
        });
      }

      if (url === "https://flat/serilog/3.1.0/serilog.nuspec") {
        return textResponse(
          '<package><metadata><repository type="git" url="https://github.com/serilog/serilog.git" /></metadata></package>',
        );
      }

      throw new Error(`unexpected fetch URL: ${url}`);
    });

    const resolved = await resolveNuGetPackage("Serilog", "3.1.0");
    expect(resolved.repoUrl).toBe("https://github.com/serilog/serilog");
  });

  it("defaults to latest stable when newer prerelease exists", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/v3/index.json")) {
        return jsonResponse({
          resources: [
            { "@type": "RegistrationsBaseUrl/3.6.0", "@id": "https://reg/" },
            { "@type": "PackageBaseAddress/3.0.0", "@id": "https://flat/" },
          ],
        });
      }

      if (url === "https://reg/serilog/index.json") {
        return jsonResponse({
          items: [
            {
              items: [
                {
                  catalogEntry: {
                    version: "4.3.2-dev-02419",
                    repository: {
                      type: "git",
                      url: "https://github.com/serilog/serilog.git",
                    },
                  },
                },
                {
                  catalogEntry: {
                    version: "4.3.1",
                    repository: {
                      type: "git",
                      url: "https://github.com/serilog/serilog.git",
                    },
                  },
                },
              ],
            },
          ],
        });
      }

      throw new Error(`unexpected fetch URL: ${url}`);
    });

    const resolved = await resolveNuGetPackage("Serilog");
    expect(resolved.version).toBe("4.3.1");
  });

  it("fails when package has only prerelease versions and no explicit version", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/v3/index.json")) {
        return jsonResponse({
          resources: [
            { "@type": "RegistrationsBaseUrl/3.6.0", "@id": "https://reg/" },
            { "@type": "PackageBaseAddress/3.0.0", "@id": "https://flat/" },
          ],
        });
      }

      if (url === "https://reg/example.pkg/index.json") {
        return jsonResponse({
          items: [
            {
              items: [
                {
                  catalogEntry: {
                    version: "1.0.0-beta.1",
                    repository: {
                      type: "git",
                      url: "https://github.com/org/repo.git",
                    },
                  },
                },
              ],
            },
          ],
        });
      }

      throw new Error(`unexpected fetch URL: ${url}`);
    });

    await expect(resolveNuGetPackage("Example.Pkg")).rejects.toThrow(
      /No stable version found for "Example.Pkg"/,
    );
  });

  it("uses latest prerelease when allowPrerelease is true", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/v3/index.json")) {
        return jsonResponse({
          resources: [
            { "@type": "RegistrationsBaseUrl/3.6.0", "@id": "https://reg/" },
            { "@type": "PackageBaseAddress/3.0.0", "@id": "https://flat/" },
          ],
        });
      }

      if (url === "https://reg/serilog/index.json") {
        return jsonResponse({
          items: [
            {
              items: [
                {
                  catalogEntry: {
                    version: "4.3.2-dev-02419",
                    repository: {
                      type: "git",
                      url: "https://github.com/serilog/serilog.git",
                    },
                  },
                },
                {
                  catalogEntry: {
                    version: "4.3.1",
                    repository: {
                      type: "git",
                      url: "https://github.com/serilog/serilog.git",
                    },
                  },
                },
              ],
            },
          ],
        });
      }

      throw new Error(`unexpected fetch URL: ${url}`);
    });

    const resolved = await resolveNuGetPackage("Serilog", undefined, {
      allowPrerelease: true,
    });
    expect(resolved.version).toBe("4.3.2-dev-02419");
  });

  it("fails when only invalid projectUrl is available", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/v3/index.json")) {
        return jsonResponse({
          resources: [
            { "@type": "RegistrationsBaseUrl/3.6.0", "@id": "https://reg/" },
            { "@type": "PackageBaseAddress/3.0.0", "@id": "https://flat/" },
          ],
        });
      }

      if (url === "https://reg/example.pkg/index.json") {
        return jsonResponse({
          items: [
            {
              items: [
                {
                  catalogEntry: {
                    version: "1.0.0",
                    projectUrl: "https://github.com/org",
                  },
                },
              ],
            },
          ],
        });
      }

      if (url === "https://flat/example.pkg/1.0.0/example.pkg.nuspec") {
        return textResponse("<package><metadata /></package>");
      }

      throw new Error(`unexpected fetch URL: ${url}`);
    });

    await expect(resolveNuGetPackage("Example.Pkg", "1.0.0")).rejects.toThrow(
      /Invalid non-cloneable projectUrl URL/,
    );
  });
});
