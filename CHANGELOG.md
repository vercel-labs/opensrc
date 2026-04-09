# opensrc

<!-- release:start -->
## 0.6.0

### New Features

- **Global cache** — Switch from per-project `opensrc/` folder to a global `~/.opensrc/` cache, shared across all projects
- **`opensrc path` command** — Print absolute path to cached source for subshell usage: `rg "parse" $(opensrc path zod)`
- **Rust rewrite** — Replace the TypeScript CLI with a native Rust binary for ~10x faster startup
- **Docs site** — New Next.js documentation site with MDX content, syntax highlighting, dark mode, full-text search, and Ask AI chat
- **Turborepo monorepo** — Restructure as `packages/opensrc` (CLI) + `apps/docs` (Next.js)
- **Cross-platform binaries** — Build and distribute native binaries for 7 platforms (Linux x64/ARM64, Linux musl x64/ARM64, macOS x64/ARM64, Windows x64)
- **Agent skill** — Add opensrc skill for AI coding agents

### Improvements

- **Version sync** — Automated checks to keep `package.json` and `Cargo.toml` versions in sync
- **CI/CD** — Rust lint, format, and test checks; cross-platform release workflow with npm publish and GitHub releases

### Contributors

- @ctate
<!-- release:end -->
