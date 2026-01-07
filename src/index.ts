#!/usr/bin/env node

import { Command } from "commander";
import { fetchCommand } from "./commands/fetch.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";

const program = new Command();

program
  .name("opensrc")
  .description(
    "Fetch source code for npm packages to give coding agents deeper context",
  )
  .version("0.1.0");

// Default command: fetch packages
program
  .argument("[packages...]", "packages to fetch (e.g., zod, react@18.2.0)")
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
  .option("--source <type>", "download source from npm or git", "git")
  .action(
    async (
      packages: string[],
      options: { cwd?: string; modify?: boolean; source?: string },
    ) => {
      if (packages.length === 0) {
        program.help();
        return;
      }

      await fetchCommand(packages, {
        cwd: options.cwd,
        allowModifications: options.modify,
        source: options.source as "git" | "npm",
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
  .description("Remove fetched source code for packages")
  .option("--cwd <path>", "working directory (default: current directory)")
  .action(async (packages: string[], options: { cwd?: string }) => {
    await removeCommand(packages, {
      cwd: options.cwd,
    });
  });

program.parse();
