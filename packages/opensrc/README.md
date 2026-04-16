# opensrc

Give coding agents access to any package's source code. Resolves packages from registry APIs, shallow-clones at the correct version tag, and caches globally at `~/.opensrc/`.

## Install

```bash
npm install -g opensrc
```

Installing globally gives you the native Rust binary directly — no Node.js overhead on each run.

## Usage

`opensrc path` prints the absolute path to a package's source, fetching on cache miss. Compose it with any tool:

```bash
rg "parse" $(opensrc path zod)
cat $(opensrc path zod)/src/types.ts
find $(opensrc path pypi:requests) -name "*.py"
ls $(opensrc path crates:serde)/src/
grep -r "Router" $(opensrc path vercel/next.js)/packages/next/src/
```

Multiple packages at once:

```bash
rg "parse" $(opensrc path zod react next)
```

Specific versions:

```bash
rg "ZodError" $(opensrc path zod@3.22.0)
cat $(opensrc path pypi:flask@3.0.0)/src/flask/app.py
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
| npm | _(default)_ or `npm:` | `opensrc path zod` |
| PyPI | `pypi:`, `pip:`, `python:` | `opensrc path pypi:requests` |
| crates.io | `crates:`, `cargo:`, `rust:` | `opensrc path crates:serde` |
| GitHub | `owner/repo` or URL | `opensrc path vercel/next.js` |
| GitLab | `gitlab:` or URL | `opensrc path gitlab:owner/repo` |
| Bitbucket | `bitbucket:` or URL | `opensrc path bitbucket:owner/repo` |

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
