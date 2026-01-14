import { describe, it, expect } from "vitest";
import { parsePackagistSpec } from "./packagist.js";

describe("parsePackagistSpec", () => {
  describe("package name only", () => {
    it("parses simple vendor/package name", () => {
      expect(parsePackagistSpec("laravel/framework")).toEqual({
        name: "laravel/framework",
        version: undefined,
      });
    });

    it("parses package with hyphens", () => {
      expect(parsePackagistSpec("symfony/http-foundation")).toEqual({
        name: "symfony/http-foundation",
        version: undefined,
      });
    });

    it("parses package with underscores", () => {
      expect(parsePackagistSpec("doctrine/dbal")).toEqual({
        name: "doctrine/dbal",
        version: undefined,
      });
    });
  });

  describe("@ version specifier", () => {
    it("parses package@version", () => {
      expect(parsePackagistSpec("laravel/framework@11.0.0")).toEqual({
        name: "laravel/framework",
        version: "11.0.0",
      });
    });

    it("parses complex package name@version", () => {
      expect(parsePackagistSpec("symfony/http-foundation@7.0.0")).toEqual({
        name: "symfony/http-foundation",
        version: "7.0.0",
      });
    });

    it("parses with v prefix in version", () => {
      expect(parsePackagistSpec("guzzlehttp/guzzle@v7.8.0")).toEqual({
        name: "guzzlehttp/guzzle",
        version: "v7.8.0",
      });
    });
  });

  describe(": version specifier (Composer style)", () => {
    it("parses package:version", () => {
      expect(parsePackagistSpec("laravel/framework:11.0.0")).toEqual({
        name: "laravel/framework",
        version: "11.0.0",
      });
    });

    it("parses with caret constraint", () => {
      expect(parsePackagistSpec("monolog/monolog:^3.0")).toEqual({
        name: "monolog/monolog",
        version: "^3.0",
      });
    });

    it("parses with tilde constraint", () => {
      expect(parsePackagistSpec("phpunit/phpunit:~10.5")).toEqual({
        name: "phpunit/phpunit",
        version: "~10.5",
      });
    });
  });

  describe("edge cases", () => {
    it("handles whitespace trimming", () => {
      expect(parsePackagistSpec("  laravel/framework  ")).toEqual({
        name: "laravel/framework",
        version: undefined,
      });
    });

    it("handles dev versions", () => {
      expect(parsePackagistSpec("laravel/framework@dev-master")).toEqual({
        name: "laravel/framework",
        version: "dev-master",
      });
    });

    it("handles prerelease versions", () => {
      expect(parsePackagistSpec("laravel/framework@11.0.0-alpha.1")).toEqual({
        name: "laravel/framework",
        version: "11.0.0-alpha.1",
      });
    });

    it("handles beta versions", () => {
      expect(parsePackagistSpec("symfony/symfony:7.0.0-beta1")).toEqual({
        name: "symfony/symfony",
        version: "7.0.0-beta1",
      });
    });

    it("handles package without vendor prefix as-is", () => {
      expect(parsePackagistSpec("somepackage")).toEqual({
        name: "somepackage",
        version: undefined,
      });
    });
  });
});
