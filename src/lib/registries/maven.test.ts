import { describe, it, expect } from "vitest";
import { parseMavenSpec } from "./maven.js";

describe("parseMavenSpec", () => {
  describe("groupId:artifactId format", () => {
    it("parses groupId:artifactId without version", () => {
      expect(parseMavenSpec("org.springframework:spring-core")).toEqual({
        groupId: "org.springframework",
        artifactId: "spring-core",
        version: undefined,
      });
    });

    it("parses groupId:artifactId:version (Maven native)", () => {
      expect(parseMavenSpec("org.springframework:spring-core:6.1.0")).toEqual({
        groupId: "org.springframework",
        artifactId: "spring-core",
        version: "6.1.0",
      });
    });

    it("parses groupId:artifactId@version (registry style)", () => {
      expect(
        parseMavenSpec("com.fasterxml.jackson.core:jackson-databind@2.16.0"),
      ).toEqual({
        groupId: "com.fasterxml.jackson.core",
        artifactId: "jackson-databind",
        version: "2.16.0",
      });
    });

    it("prefers @ version over colon version when both present", () => {
      // @ takes precedence
      expect(
        parseMavenSpec("org.springframework:spring-core:6.0.0@6.1.0"),
      ).toEqual({
        groupId: "org.springframework",
        artifactId: "spring-core",
        version: "6.1.0",
      });
    });
  });

  describe("deep groupId", () => {
    it("handles multi-segment groupIds", () => {
      expect(
        parseMavenSpec("com.fasterxml.jackson.core:jackson-databind:2.16.0"),
      ).toEqual({
        groupId: "com.fasterxml.jackson.core",
        artifactId: "jackson-databind",
        version: "2.16.0",
      });
    });

    it("handles single-segment groupId", () => {
      expect(parseMavenSpec("junit:junit:4.13.2")).toEqual({
        groupId: "junit",
        artifactId: "junit",
        version: "4.13.2",
      });
    });
  });

  describe("version formats", () => {
    it("handles SNAPSHOT versions", () => {
      expect(
        parseMavenSpec("org.springframework:spring-core:6.2.0-SNAPSHOT"),
      ).toEqual({
        groupId: "org.springframework",
        artifactId: "spring-core",
        version: "6.2.0-SNAPSHOT",
      });
    });

    it("handles release candidate versions", () => {
      expect(
        parseMavenSpec("org.springframework:spring-core:6.1.0-RC1"),
      ).toEqual({
        groupId: "org.springframework",
        artifactId: "spring-core",
        version: "6.1.0-RC1",
      });
    });

    it("handles milestone versions", () => {
      expect(
        parseMavenSpec("org.springframework:spring-core:6.1.0-M2"),
      ).toEqual({
        groupId: "org.springframework",
        artifactId: "spring-core",
        version: "6.1.0-M2",
      });
    });
  });

  describe("whitespace handling", () => {
    it("trims surrounding whitespace", () => {
      expect(parseMavenSpec("  org.springframework:spring-core  ")).toEqual({
        groupId: "org.springframework",
        artifactId: "spring-core",
        version: undefined,
      });
    });
  });

  describe("invalid specs", () => {
    it("throws on missing colon separator", () => {
      expect(() => parseMavenSpec("springframework")).toThrow(
        "Invalid Maven specifier",
      );
    });

    it("throws on empty groupId", () => {
      expect(() => parseMavenSpec(":spring-core")).toThrow(
        "Invalid Maven specifier",
      );
    });

    it("throws on empty artifactId", () => {
      expect(() => parseMavenSpec("org.springframework:")).toThrow(
        "Invalid Maven specifier",
      );
    });
  });
});
