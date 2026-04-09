---
name: opensrc
description: Fetch dependency source code to give AI agents deeper implementation context. Use when the agent needs to understand how a library works internally, read source code for a package, fetch implementation details for a dependency, or explore how an npm/PyPI/crates.io package is built. Triggers include "fetch source for", "read the source of", "how does X work internally", "get the implementation of", "npx opensrc", or any task requiring access to dependency source code beyond types and docs.
allowed-tools: Bash(npx opensrc:*), Bash(opensrc:*)
---

# Source Code Fetching with opensrc

Fetches dependency source code so agents can read implementations, not just types. Clones repositories at the correct version tag and stores them locally in `opensrc/`.

## Quick Start

```bash
npx opensrc zod
```

Source lands in `opensrc/repos/github.com/colinhacks/zod/`. An index at `opensrc/sources.json` tracks all fetched sources.

## Fetching Source Code

```bash
# npm packages (default registry)
opensrc zod
opensrc zod@3.22.0
opensrc react react-dom next

# Python packages
opensrc pypi:requests
opensrc pypi:flask@3.0.0

# Rust crates
opensrc crates:serde
opensrc crates:tokio@1.35.0

# GitHub repositories
opensrc facebook/react
opensrc github:owner/repo
opensrc https://github.com/colinhacks/zod
opensrc owner/repo@v1.0.0
opensrc owner/repo#main

# GitLab repositories
opensrc gitlab:owner/repo

# Mix packages and repos in one command
opensrc zod pypi:requests facebook/react
```

### Version Resolution

For npm packages, opensrc auto-detects the installed version from lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`), then falls back to `package.json` ranges, then latest. Re-running updates to your current installed version.

For PyPI and crates.io, explicit versions or latest are used.

For repos, use `@ref` or `#ref` to pin a branch, tag, or commit. Without a ref, the default branch is cloned.

## Managing Sources

```bash
# List all fetched sources
opensrc list
opensrc list --json

# Remove specific sources
opensrc remove zod
opensrc remove facebook/react

# Clean everything
opensrc clean

# Clean selectively
opensrc clean --packages        # All packages, keep repos
opensrc clean --repos           # All repos, keep packages
opensrc clean --npm             # Only npm packages
opensrc clean --pypi            # Only PyPI packages
opensrc clean --crates          # Only crates.io packages
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--cwd <path>` | Set working directory (all commands) |
| `--modify` | Allow modifying `.gitignore`, `tsconfig.json`, `AGENTS.md` |
| `--modify=false` | Deny file modifications |
| `--json` | JSON output (list command) |

## Project Integration

On first run, opensrc prompts to modify project files. Use `--modify` or `--modify=false` to skip the prompt. The choice persists in `opensrc/settings.json`.

When allowed, opensrc:
- Adds `opensrc/` to `.gitignore`
- Excludes `opensrc/` from `tsconfig.json`
- Adds a source code reference section to `AGENTS.md` (fenced with `<!-- opensrc:start -->` / `<!-- opensrc:end -->`)

## Reading Fetched Source

After fetching, source code is available under `opensrc/repos/`. The `opensrc/sources.json` index lists everything:

```json
{
  "packages": [
    { "name": "zod", "version": "3.24.4", "registry": "npm", "path": "opensrc/repos/github.com/colinhacks/zod" }
  ],
  "repos": [
    { "name": "github.com/facebook/react", "version": "main", "path": "opensrc/repos/github.com/facebook/react" }
  ],
  "updatedAt": "2025-01-01T00:00:00.000Z"
}
```

Use this to locate source files. For monorepo packages (e.g., `next` from `vercel/next.js`), the path points to the relevant subdirectory.

## When to Fetch Source

Fetch source when you need to:
- Understand internal behavior that types don't reveal
- Debug unexpected library behavior
- Learn patterns from well-known implementations
- Verify how a function handles edge cases
- Contribute patches or understand extension points

Don't fetch source for simple API usage questions that docs or types can answer.
