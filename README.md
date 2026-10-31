# opensrc

<p>
  <a href="https://vercel.com/labs#active-experiments"><img alt="Vercel Labs Experiment" src="https://img.shields.io/badge/LABS-EXPERIMENT-0a0a0a.svg?style=for-the-badge&amp;logo=Vercel&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/opensrc"><img alt="npm version: opensrc" src="https://img.shields.io/npm/v/opensrc.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://github.com/vercel-labs/opensrc/blob/main/LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/github/license/vercel-labs/opensrc.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/opensrc"><img alt="npm downloads per month: opensrc" src="https://img.shields.io/npm/dm/opensrc.svg?style=for-the-badge&amp;labelColor=000000&amp;label=npm%20downloads" height="28"></a>
</p>

Give coding agents access to any package's source code.

## Quick Start

```bash
npm install -g opensrc
```

```bash
# Search a package's source
rg "parse" $(opensrc path zod)

# Read a specific file
cat $(opensrc path zod)/src/types.ts

# Works with any registry
find $(opensrc path pypi:requests) -name "*.py"
```

`opensrc path` fetches on first use, then returns the cached path instantly. See the [CLI readme](packages/opensrc/README.md) for full usage.

## Packages

| Package | Description |
|---------|-------------|
| [`opensrc`](packages/opensrc) | CLI — fetch and cache source code from npm, PyPI, crates.io, and GitHub |
| [`@opensrc/docs`](apps/docs) | Documentation site |

## Development

This is a [Turborepo](https://turbo.build) monorepo using [pnpm](https://pnpm.io) workspaces. Use Node.js 24+ and pnpm 11.

```bash
pnpm install
turbo build
turbo dev
```

### CLI (Rust)

```bash
cargo build --manifest-path packages/opensrc/cli/Cargo.toml
cargo test --manifest-path packages/opensrc/cli/Cargo.toml
cargo fmt --manifest-path packages/opensrc/cli/Cargo.toml
cargo clippy --manifest-path packages/opensrc/cli/Cargo.toml -- -D warnings
```

### Docs (Next.js)

```bash
cd apps/docs
pnpm dev
```

## License

Apache-2.0
