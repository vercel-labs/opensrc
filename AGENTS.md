# AGENTS.md

Instructions for AI coding agents working with this codebase.

## Monorepo Structure

This is a **Turborepo** monorepo with pnpm workspaces:

- `packages/opensrc/` — Rust CLI distributed via npm
- `apps/docs/` — Next.js documentation site

## CLI (packages/opensrc)

The CLI is a **Rust** binary with an npm shim. The Rust crate lives in `packages/opensrc/cli/`.

- Build: `cargo build --manifest-path packages/opensrc/cli/Cargo.toml`
- Test: `cargo test --manifest-path packages/opensrc/cli/Cargo.toml`
- Format: `cargo fmt --manifest-path packages/opensrc/cli/Cargo.toml`
- Lint: `cargo clippy --manifest-path packages/opensrc/cli/Cargo.toml -- -D warnings`
- Release build + copy to bin/: `cd packages/opensrc && npm run build:native`

## Docs (apps/docs)

- Dev: `cd apps/docs && pnpm dev`
- Build: `cd apps/docs && pnpm build`

Or from root: `turbo dev`, `turbo build`

## Releasing

Releases are manual, single-PR affairs. The maintainer controls the changelog voice and format.

To prepare a release:

1. Create a branch (e.g. `prepare-v0.7.0`)
2. Bump `version` in `packages/opensrc/package.json`
3. Run `cd packages/opensrc && npm run version:sync` to update `cli/Cargo.toml` and `cli/Cargo.lock`
4. Write the changelog entry in `CHANGELOG.md` at the top, under a new `## <version>` heading, wrapped in `<!-- release:start -->` and `<!-- release:end -->` markers. Remove the markers from the previous release entry so only the new release has markers.
5. Open a PR and merge to `main`

When the PR merges, CI compares `packages/opensrc/package.json` version to what's on npm. If it differs, it builds all 7 platform binaries, publishes to npm, and creates the GitHub release automatically. The GitHub release body is extracted from the content between the `<!-- release:start -->` and `<!-- release:end -->` markers in `CHANGELOG.md`.

### Writing the changelog

Review the git log since the last release and write the entry in `CHANGELOG.md`. Follow the existing format and voice. Group changes under `### New Features`, `### Bug Fixes`, `### Improvements`, etc. Bold the feature/fix name, then describe it concisely. Reference PR numbers in parentheses.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package> # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package> # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package> # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo> # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->
