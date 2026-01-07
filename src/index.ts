#!/usr/bin/env node

import { Command } from "commander";
import { fetchCommand } from "./commands/fetch.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";
import { cleanCommand } from "./commands/clean.js";

const program = new Command();

program
  .name("opensrc")
  .description(
    "Fetch source code for npm packages to give coding agents deeper context",
  )
  .version("0.1.0");

// Default command: fetch packages
program
  .argument(
    "[packages...]",
    "packages or repos to fetch (e.g., zod, react@18.2.0, github:owner/repo, owner/repo)",
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
    async (packages: string[], options: { cwd?: string; modify?: boolean }) => {
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
  .option("--packages", "only remove packages")
  .option("--repos", "only remove repos")
  .option("--cwd <path>", "working directory (default: current directory)")
  .action(
    async (options: { packages?: boolean; repos?: boolean; cwd?: string }) => {
      await cleanCommand({
        packages: options.packages,
        repos: options.repos,
        cwd: options.cwd,
      });
    },
  );

program.parse();
