import { describe, it, expect } from "vitest";
import {
  detectRegistry,
  parsePackageSpec,
  detectInputType,
} from "./index.js";

describe("detectRegistry", () => {
  describe("npm registry", () => {
    it("detects npm: prefix", () => {
      expect(detectRegistry("npm:lodash")).toEqual({
        registry: "npm",
        cleanSpec: "lodash",
      });
    });

    it("detects npm: prefix case-insensitive", () => {
      expect(detectRegistry("NPM:lodash")).toEqual({
        registry: "npm",
        cleanSpec: "lodash",
      });
    });

    it("defaults to npm without prefix", () => {
      expect(detectRegistry("lodash")).toEqual({
        registry: "npm",
        cleanSpec: "lodash",
      });
    });

    it("defaults to npm for scoped packages", () => {
      expect(detectRegistry("@babel/core")).toEqual({
        registry: "npm",
        cleanSpec: "@babel/core",
      });
    });
  });

  describe("pypi registry", () => {
    it("detects pypi: prefix", () => {
      expect(detectRegistry("pypi:requests")).toEqual({
        registry: "pypi",
        cleanSpec: "requests",
      });
    });

    it("detects pip: prefix", () => {
      expect(detectRegistry("pip:requests")).toEqual({
        registry: "pypi",
        cleanSpec: "requests",
      });
    });

    it("detects python: prefix", () => {
      expect(detectRegistry("python:requests")).toEqual({
        registry: "pypi",
        cleanSpec: "requests",
      });
    });

    it("handles case-insensitive prefixes", () => {
      expect(detectRegistry("PYPI:requests")).toEqual({
        registry: "pypi",
        cleanSpec: "requests",
      });
    });
  });

  describe("crates registry", () => {
    it("detects crates: prefix", () => {
      expect(detectRegistry("crates:serde")).toEqual({
        registry: "crates",
        cleanSpec: "serde",
      });
    });

    it("detects cargo: prefix", () => {
      expect(detectRegistry("cargo:serde")).toEqual({
        registry: "crates",
        cleanSpec: "serde",
      });
    });

    it("detects rust: prefix", () => {
      expect(detectRegistry("rust:serde")).toEqual({
        registry: "crates",
        cleanSpec: "serde",
      });
    });
  });

  describe("preserves version in cleanSpec", () => {
    it("npm with version", () => {
      expect(detectRegistry("npm:lodash@4.17.21")).toEqual({
        registry: "npm",
        cleanSpec: "lodash@4.17.21",
      });
    });

    it("pypi with version", () => {
      expect(detectRegistry("pypi:requests==2.31.0")).toEqual({
        registry: "pypi",
        cleanSpec: "requests==2.31.0",
      });
    });

    it("crates with version", () => {
      expect(detectRegistry("crates:serde@1.0.0")).toEqual({
        registry: "crates",
        cleanSpec: "serde@1.0.0",
      });
    });
  });
});

describe("parsePackageSpec", () => {
  describe("npm packages", () => {
    it("parses npm package without prefix", () => {
      expect(parsePackageSpec("lodash")).toEqual({
        registry: "npm",
        name: "lodash",
        version: undefined,
      });
    });

    it("parses npm package with prefix", () => {
      expect(parsePackageSpec("npm:lodash@4.17.21")).toEqual({
        registry: "npm",
        name: "lodash",
        version: "4.17.21",
      });
    });

    it("parses scoped npm package", () => {
      expect(parsePackageSpec("@babel/core@7.23.0")).toEqual({
        registry: "npm",
        name: "@babel/core",
        version: "7.23.0",
      });
    });
  });

  describe("pypi packages", () => {
    it("parses pypi package", () => {
      expect(parsePackageSpec("pypi:requests")).toEqual({
        registry: "pypi",
        name: "requests",
        version: undefined,
      });
    });

    it("parses pypi package with == version", () => {
      expect(parsePackageSpec("pypi:requests==2.31.0")).toEqual({
        registry: "pypi",
        name: "requests",
        version: "2.31.0",
      });
    });

    it("parses pypi package with @ version", () => {
      expect(parsePackageSpec("pip:django@4.2.0")).toEqual({
        registry: "pypi",
        name: "django",
        version: "4.2.0",
      });
    });
  });

  describe("crates packages", () => {
    it("parses crate", () => {
      expect(parsePackageSpec("crates:serde")).toEqual({
        registry: "crates",
        name: "serde",
        version: undefined,
      });
    });

    it("parses crate with version", () => {
      expect(parsePackageSpec("cargo:tokio@1.35.0")).toEqual({
        registry: "crates",
        name: "tokio",
        version: "1.35.0",
      });
    });
  });
});

describe("detectInputType", () => {
  describe("detects packages", () => {
    it("npm package (default)", () => {
      expect(detectInputType("lodash")).toBe("package");
    });

    it("npm package with prefix", () => {
      expect(detectInputType("npm:react")).toBe("package");
    });

    it("scoped npm package", () => {
      expect(detectInputType("@babel/core")).toBe("package");
    });

    it("pypi package", () => {
      expect(detectInputType("pypi:requests")).toBe("package");
    });

    it("crates package", () => {
      expect(detectInputType("crates:serde")).toBe("package");
    });

    it("package with version", () => {
      expect(detectInputType("lodash@4.17.21")).toBe("package");
    });
  });

  describe("detects repos", () => {
    it("github: prefix", () => {
      expect(detectInputType("github:vercel/ai")).toBe("repo");
    });

    it("GitHub URL", () => {
      expect(detectInputType("https://github.com/vercel/ai")).toBe("repo");
    });

    it("owner/repo format", () => {
      expect(detectInputType("vercel/ai")).toBe("repo");
    });

    it("host/owner/repo format", () => {
      expect(detectInputType("github.com/vercel/ai")).toBe("repo");
    });

    it("gitlab: prefix", () => {
      expect(detectInputType("gitlab:owner/repo")).toBe("repo");
    });

    it("GitLab URL", () => {
      expect(detectInputType("https://gitlab.com/owner/repo")).toBe("repo");
    });
  });
});
