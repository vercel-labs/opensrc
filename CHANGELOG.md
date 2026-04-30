# opensrc

## 0.7.2

<!-- release:start -->
### New Features

- **`opensrc fetch` subcommand** — Cache a package's source without printing paths, for use in scripts and CI where you just want the source downloaded (#53)
- **Bitbucket Cloud support** — Fetch source from Bitbucket repos, with private repo authentication via `BITBUCKET_TOKEN` (#52)
- **Authentication docs** — New docs page covering private repo authentication across GitHub, GitLab, and Bitbucket (#52)

### Improvements

- **Lockfile parsers** — Rewrite lockfile parsers with proper transitive dependency resolution for pnpm workspaces (#51)
- **Skills location** — Move agent skill to a top-level `skills/` directory for easier discovery (#46)
- **Docs favicon** — Add favicon to the docs site (#50)

### Contributors

- @ctate
<!-- release:end -->

## 0.7.1

### New Features

- **Private repo support** — Authenticate with GitHub and GitLab private repos via `GITHUB_TOKEN` and `GITLAB_TOKEN` environment variables (#38)

### Bug Fixes

- **`remove` command** — Accept the same repo formats as `fetch` (e.g. `github:owner/repo`, full URLs) instead of only `owner/repo` (#39)

## 0.7.0

### New Features

- **Rust rewrite** — Replace the TypeScript CLI with a native Rust binary for ~10x faster startup
- **Global cache** — Switch from per-project `opensrc/` folder to a global `~/.opensrc/` cache, shared across all projects
- **`opensrc path` command** — Print absolute path to cached source for subshell usage: `rg "parse" $(opensrc path zod)`
- **Docs site** — New Next.js documentation site with MDX content, syntax highlighting, dark mode, full-text search, and Ask AI chat
- **Turborepo monorepo** — Restructure as `packages/opensrc` (CLI) + `apps/docs` (Next.js)
- **Cross-platform binaries** — Build and distribute native binaries for 7 platforms (Linux x64/ARM64, Linux musl x64/ARM64, macOS x64/ARM64, Windows x64)

### Improvements

- **Version sync** — Automated checks to keep `package.json` and `Cargo.toml` versions in sync
- **CI/CD** — Rust lint, format, and test checks; cross-platform release workflow with npm publish and GitHub releases

### Contributors

- @ctate

## 0.6.0

### New Features

- **Multi-registry support** — Fetch source from crates.io and PyPI in addition to npm
- **GitHub/GitLab repo support** — Fetch source directly from repositories with `owner/repo` syntax
- **Private repo support** — Authenticate via `OPENSRC_GITHUB_TOKEN` and `OPENSRC_GITLAB_TOKEN`
- **Agent skill** — Add opensrc agent skill for AI coding agents (#34)

### Bug Fixes

- Fixed **`allowFileModifications`** not being respected in the remove command (#8)
- Fixed **`--cwd`** not propagating to subcommands (#13)
- Fixed **fetch output** not showing local paths after fetch (#7)

## 0.5.0

### New Features

- **`--modify` flag** — Explicitly control whether opensrc can modify project files like AGENTS.md

## 0.4.4

### New Features

- **File modification prompt** — Ask before modifying project files, with persistent preference in `opensrc/settings.json`

## 0.4.3

### Improvements

- Excluded `opensrc/` directory from TypeScript compilation

## 0.4.2

### Improvements

- Internal formatting and cleanup

## 0.4.1

### Improvements

- Updated README with better usage documentation

## 0.4.0

### Improvements

- **Smart re-fetch** — Replace `--force` flag with automatic version-aware updates that skip re-fetching when source is already up to date

## 0.3.3

### Bug Fixes

- Fixed version resolution edge cases

## 0.3.2

### Bug Fixes

- Fixed version resolution bugs

## 0.3.1

### Bug Fixes

- Fixed AGENTS.md marker parsing

## 0.3.0

### Improvements

- **`opensrc/` directory** — Store fetched sources in a dedicated `opensrc/` folder

## 0.2.0

### New Features

- **AGENTS.md auto-update** — Automatically inject source code references into AGENTS.md for AI coding agents
- **`sources.json` index** — Track fetched packages in a package manifest

## 0.1.0

### New Features

- **`fetch` command** — Download source code for npm packages
- **`list` command** — List all fetched sources
- **`remove` command** — Remove fetched sources
- **Version resolution** — Automatically detect installed versions from lockfiles
- **`.gitignore` auto-update** — Automatically add source directories to `.gitignore`
