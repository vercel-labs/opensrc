#!/usr/bin/env node

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { fetchCommand } from "./commands/fetch.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";
import { cleanCommand } from "./commands/clean.js";
import type { Registry } from "./types.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export function createProgram(): Command {
  const program = new Command();

  program
    .name("opensrc")
    .description(
      "Fetch source code for packages to give coding agents deeper context",
    )
    .version(pkg.version)
    .enablePositionalOptions();

  // Default command: fetch packages
  program
    .argument(
      "[packages...]",
      "packages or repos to fetch (e.g., zod, pypi:requests, crates:serde, owner/repo)",
    )
    .option("--cwd <path>", "working directory (default: current directory)")
    .option(
      "--modify [value]",
      "allow/deny modifying .gitignore, tsconfig.json, AGENTS.md",
      (val) => {
        if (val === undefined || val === "" || val === "true") return true;
        if (val === "false") return false;
        return true;
      },
    )
    .action(
      async (
        packages: string[],
        options: { cwd?: string; modify?: boolean },
      ) => {
        if (packages.length === 0) {
          program.help();
          return;
        }

        await fetchCommand(packages, {
          cwd: options.cwd,
          allowModifications: options.modify,
        });
      },
    );

  // List command
  program
    .command("list")
    .description("List all fetched package sources")
    .option("--json", "output as JSON")
    .option("--cwd <path>", "working directory (default: current directory)")
    .action(async (options: { json?: boolean; cwd?: string }) => {
      await listCommand({
        json: options.json,
        cwd: options.cwd,
      });
    });

  // Remove command
  program
    .command("remove <packages...>")
    .alias("rm")
    .description("Remove fetched source code for packages or repos")
    .option("--cwd <path>", "working directory (default: current directory)")
    .action(async (packages: string[], options: { cwd?: string }) => {
      await removeCommand(packages, {
        cwd: options.cwd,
      });
    });

  // Clean command
  program
    .command("clean")
    .description("Remove all fetched packages and/or repos")
    .option("--packages", "only remove packages (all registries)")
    .option("--repos", "only remove repos")
    .option("--npm", "only remove npm packages")
    .option("--pypi", "only remove PyPI packages")
    .option("--crates", "only remove crates.io packages")
    .option("--cwd <path>", "working directory (default: current directory)")
    .action(
      async (options: {
        packages?: boolean;
        repos?: boolean;
        npm?: boolean;
        pypi?: boolean;
        crates?: boolean;
        cwd?: string;
      }) => {
        let registry: Registry | undefined;
        if (options.npm) registry = "npm";
        else if (options.pypi) registry = "pypi";
        else if (options.crates) registry = "crates";

        await cleanCommand({
          packages: options.packages || !!registry,
          repos: options.repos,
          registry,
          cwd: options.cwd,
        });
      },
    );

  return program;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createProgram().parse();
}
