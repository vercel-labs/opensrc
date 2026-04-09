# opensrc

Fetch source code for packages to give coding agents deeper context. Clones repositories at the correct version tag and caches them globally at `~/.opensrc/`.

## Install

```bash
npm install -g opensrc
```

Or use directly with npx:

```bash
npx opensrc zod
```

## Usage

### Fetch source code

```bash
opensrc zod                  # npm package (latest or installed version)
opensrc zod@3.22.0           # specific version
opensrc pypi:requests        # PyPI package
opensrc crates:serde         # crates.io package
opensrc vercel/next.js       # GitHub repository
```

### Get path to cached source

The `path` command prints the absolute path to cached source, fetching on cache miss. Designed for subshell usage:

```bash
rg "parse" $(opensrc path zod)
cat $(opensrc path zod)/src/types.ts
find $(opensrc path pypi:requests) -name "*.py"
```

Options:
- `--cwd <path>` — working directory for lockfile version resolution
- `--verbose` — show progress during fetch

### List cached sources

```bash
opensrc list          # human-readable
opensrc list --json   # JSON output
```

### Remove cached sources

```bash
opensrc remove zod
opensrc remove vercel/next.js
opensrc rm pypi:requests
```

### Clean cache

```bash
opensrc clean            # remove everything
opensrc clean --packages # only packages
opensrc clean --repos    # only repos
opensrc clean --npm      # only npm packages
opensrc clean --pypi     # only PyPI packages
opensrc clean --crates   # only crates.io packages
```

## Supported Registries

| Registry | Prefix | Example |
|----------|--------|---------|
| npm | _(default)_ or `npm:` | `opensrc zod`, `opensrc npm:react` |
| PyPI | `pypi:`, `pip:`, `python:` | `opensrc pypi:requests` |
| crates.io | `crates:`, `cargo:`, `rust:` | `opensrc crates:serde` |
| GitHub | `owner/repo` or URL | `opensrc vercel/next.js` |
| GitLab | `gitlab:` or URL | `opensrc gitlab:owner/repo` |

## How It Works

1. Resolves the package to a git repository URL via registry APIs
2. Detects the installed version from lockfiles (npm only) or uses latest
3. Shallow-clones the repo at the matching version tag
4. Caches in `~/.opensrc/repos/<host>/<owner>/<repo>/<version>/`
5. Tracks metadata in `~/.opensrc/sources.json`

The `OPENSRC_HOME` environment variable overrides the default cache location.

## Development

Requires [Rust](https://rustup.rs) and [Node.js](https://nodejs.org) 18+.

```bash
# Build
cargo build --manifest-path cli/Cargo.toml

# Run tests
cargo test --manifest-path cli/Cargo.toml

# Build release + copy to bin/
npm run build:native

# Format
cargo fmt --manifest-path cli/Cargo.toml

# Lint
cargo clippy --manifest-path cli/Cargo.toml -- -D warnings
```

## License

Apache-2.0
