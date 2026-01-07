# opensrc

Fetch source code for npm packages to give coding agents deeper context than types alone.

## Why?

When working with AI coding agents, types and documentation often aren't enough. Sometimes the agent needs to understand the *implementation* - how something works internally, not just its interface.

`opensrc` automates the process of fetching package source code so your agent can reference it when needed.

## Installation

```bash
npm install -g opensrc
```

Or use with npx:

```bash
npx opensrc <package>
```

## Usage

### npm Packages

```bash
# Fetch source for a package (auto-detects version from lockfile)
opensrc zod

# Fetch specific version
opensrc zod@3.22.0

# Fetch multiple packages
opensrc react react-dom next
```

Re-running `opensrc <package>` automatically updates to match your installed version—no flags needed.

### GitHub Repositories

You can also fetch source code directly from any public GitHub repository:

```bash
# Using github: prefix
opensrc github:owner/repo

# Using owner/repo shorthand
opensrc facebook/react

# Using full GitHub URL
opensrc https://github.com/colinhacks/zod

# Fetch a specific branch or tag
opensrc owner/repo@v1.0.0
opensrc owner/repo#main

# Mix packages and repos
opensrc zod facebook/react
```

GitHub repos are stored as `opensrc/owner--repo/`.

### Managing Sources

```bash
# List fetched sources
opensrc list

# Remove a source (package or repo)
opensrc remove zod
opensrc remove owner--repo
```

### File Modifications

On first run, opensrc will ask for permission to modify these files:

- `.gitignore` — adds `opensrc/` to ignore list
- `tsconfig.json` — excludes `opensrc/` from compilation
- `AGENTS.md` — adds a section pointing agents to the source code

Your choice is saved to `opensrc/settings.json` so you won't be prompted again.

To skip the prompt, use the `--modify` flag:

```bash
# Allow file modifications
opensrc zod --modify

# Deny file modifications
opensrc zod --modify=false
```

## How it works

1. Queries the npm registry to find the package's repository URL
2. Detects the installed version from your lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`)
3. Clones the repository at the matching git tag
4. Stores the source in `opensrc/<package-name>/`
5. If permitted: adds `opensrc/` to `.gitignore`, excludes from `tsconfig.json`, updates `AGENTS.md`

## Output

After running `opensrc zod`:

```
opensrc/
├── settings.json       # Your modification preferences
├── sources.json        # Index of fetched packages
└── zod/
    ├── src/
    ├── package.json
    └── ...
```

The `sources.json` file lists all fetched packages with their versions, so agents know what's available:

```json
{
  "packages": [
    { "name": "zod", "version": "3.22.0", "path": "opensrc/zod" }
  ]
}
```

The `settings.json` file stores your preferences:

```json
{
  "allowFileModifications": true
}
```

## License

Apache-2.0
