# opensrc

Fetch source code for packages to give coding agents deeper context.

## Packages

| Package | Description |
|---------|-------------|
| [`opensrc`](packages/opensrc) | CLI — fetch and cache source code from npm, PyPI, crates.io, and GitHub |
| [`@opensrc/docs`](apps/docs) | Documentation site |

## Quick Start

```bash
npx opensrc zod
```

See the [CLI readme](packages/opensrc/README.md) for full usage.

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

## License

Apache-2.0
