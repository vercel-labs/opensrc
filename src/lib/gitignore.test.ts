import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import {
  hasOpensrcEntry,
  ensureGitignore,
  removeFromGitignore,
} from "./gitignore.js";

const TEST_DIR = join(process.cwd(), ".test-gitignore");
const GITIGNORE_PATH = join(TEST_DIR, ".gitignore");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true, force: true });
  }
});

describe("hasOpensrcEntry", () => {
  it("returns false if .gitignore does not exist", async () => {
    expect(await hasOpensrcEntry(TEST_DIR)).toBe(false);
  });

  it("returns false if .gitignore has no opensrc entry", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\ndist/\n");
    expect(await hasOpensrcEntry(TEST_DIR)).toBe(false);
  });

  it("returns true if .gitignore has .opensrc/ entry", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\n.opensrc/\n");
    expect(await hasOpensrcEntry(TEST_DIR)).toBe(true);
  });

  it("returns true if .gitignore has .opensrc entry (without slash)", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\n.opensrc\n");
    expect(await hasOpensrcEntry(TEST_DIR)).toBe(true);
  });

  it("returns true if .gitignore has legacy opensrc/ entry", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\nopensrc/\n");
    expect(await hasOpensrcEntry(TEST_DIR)).toBe(true);
  });

  it("returns true if .gitignore has legacy opensrc entry (without slash)", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\nopensrc\n");
    expect(await hasOpensrcEntry(TEST_DIR)).toBe(true);
  });

  it("handles whitespace around entry", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\n  .opensrc/  \n");
    expect(await hasOpensrcEntry(TEST_DIR)).toBe(true);
  });

  it("does not match partial entries", async () => {
    await writeFile(GITIGNORE_PATH, "my-opensrc/\nopensrc-backup/\n");
    expect(await hasOpensrcEntry(TEST_DIR)).toBe(false);
  });
});

describe("ensureGitignore", () => {
  it("creates .gitignore with .opensrc entry if file does not exist", async () => {
    const result = await ensureGitignore(TEST_DIR);
    expect(result).toBe(true);
    expect(existsSync(GITIGNORE_PATH)).toBe(true);

    const content = await readFile(GITIGNORE_PATH, "utf-8");
    expect(content).toContain(".opensrc/");
    expect(content).toContain("# opensrc");
  });

  it("appends .opensrc entry to existing .gitignore", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\ndist/");

    const result = await ensureGitignore(TEST_DIR);
    expect(result).toBe(true);

    const content = await readFile(GITIGNORE_PATH, "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain("dist/");
    expect(content).toContain(".opensrc/");
  });

  it("returns false if entry already exists", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\n.opensrc/\n");

    const result = await ensureGitignore(TEST_DIR);
    expect(result).toBe(false);
  });

  it("returns false if legacy entry already exists", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\nopensrc/\n");

    const result = await ensureGitignore(TEST_DIR);
    expect(result).toBe(false);
  });

  it("adds newline before entry if file does not end with newline", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/");

    await ensureGitignore(TEST_DIR);

    const content = await readFile(GITIGNORE_PATH, "utf-8");
    // Should have proper separation
    expect(content).toMatch(/node_modules\/\n\n[\s\S]*?\.opensrc/);
  });

  it("adds separator newline if file has content", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\n");

    await ensureGitignore(TEST_DIR);

    const content = await readFile(GITIGNORE_PATH, "utf-8");
    // Should have blank line for separation
    expect(content).toContain("node_modules/\n\n");
  });
});

describe("removeFromGitignore", () => {
  it("returns false if .gitignore does not exist", async () => {
    const result = await removeFromGitignore(TEST_DIR);
    expect(result).toBe(false);
  });

  it("returns false if no opensrc entry exists", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\ndist/\n");

    const result = await removeFromGitignore(TEST_DIR);
    expect(result).toBe(false);
  });

  it("removes .opensrc/ entry", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\n.opensrc/\ndist/\n");

    const result = await removeFromGitignore(TEST_DIR);
    expect(result).toBe(true);

    const content = await readFile(GITIGNORE_PATH, "utf-8");
    expect(content).not.toContain(".opensrc/");
    expect(content).toContain("node_modules/");
    expect(content).toContain("dist/");
  });

  it("removes legacy opensrc/ entry", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\nopensrc/\ndist/\n");

    const result = await removeFromGitignore(TEST_DIR);
    expect(result).toBe(true);

    const content = await readFile(GITIGNORE_PATH, "utf-8");
    expect(content).not.toContain("opensrc");
    expect(content).toContain("node_modules/");
    expect(content).toContain("dist/");
  });

  it("removes .opensrc entry (without slash)", async () => {
    await writeFile(GITIGNORE_PATH, "node_modules/\n.opensrc\ndist/\n");

    await removeFromGitignore(TEST_DIR);

    const content = await readFile(GITIGNORE_PATH, "utf-8");
    expect(content).not.toContain(".opensrc");
  });

  it("removes marker comment", async () => {
    await writeFile(
      GITIGNORE_PATH,
      "node_modules/\n\n# opensrc - source code for packages\n.opensrc/\n",
    );

    await removeFromGitignore(TEST_DIR);

    const content = await readFile(GITIGNORE_PATH, "utf-8");
    expect(content).not.toContain("# opensrc");
    expect(content).not.toContain(".opensrc/");
  });

  it("cleans up multiple consecutive blank lines", async () => {
    await writeFile(
      GITIGNORE_PATH,
      "node_modules/\n\n\n\n.opensrc/\n\n\n\ndist/\n",
    );

    await removeFromGitignore(TEST_DIR);

    const content = await readFile(GITIGNORE_PATH, "utf-8");
    // Should not have more than 2 consecutive newlines
    expect(content).not.toMatch(/\n{3,}/);
  });
});
