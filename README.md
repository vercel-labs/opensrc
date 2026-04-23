# opensrc

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

This is a [Turborepo](https://turbo.build) monorepo using [pnpm](https://pnpm.io) workspaces.

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

## Related Projects

- **[llms-furl](https://github.com/toyamarinyon/llms-furl)** — Furl `llms-full.txt` into a structured tree of small, searchable files. While opensrc fetches package source code, llms-furl splits monolithic LLM documentation into a Unix-friendly filesystem you can search with `grep`, `find`, and pipes.

## License

Apache-2.0
