mod commands;
mod core;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "opensrc")]
#[command(about = "Fetch source code for packages to give coding agents deeper context")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Fetch source code for one or more packages or repos into the cache
    Fetch {
        /// Packages or repo specs (e.g., zod, pypi:requests, owner/repo)
        #[arg(required = true)]
        packages: Vec<String>,
        /// Working directory for lockfile version resolution
        #[arg(long)]
        cwd: Option<String>,
        /// Suppress progress output
        #[arg(long, short)]
        quiet: bool,
    },
    /// Print the absolute path to cached source (fetches on cache miss)
    Path {
        /// Packages or repo specs (e.g., zod, pypi:requests, owner/repo)
        #[arg(required = true)]
        packages: Vec<String>,
        /// Working directory for lockfile version resolution
        #[arg(long)]
        cwd: Option<String>,
        /// Show progress during fetch
        #[arg(long)]
        verbose: bool,
    },
    /// List all globally cached sources
    List {
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Remove cached source code for packages or repos
    #[command(alias = "rm")]
    Remove {
        /// Packages or repos to remove
        #[arg(required = true)]
        packages: Vec<String>,
    },
    /// Remove all cached packages and/or repos
    Clean {
        /// Only remove packages (all registries)
        #[arg(long)]
        packages: bool,
        /// Only remove repos
        #[arg(long)]
        repos: bool,
        /// Only remove npm packages
        #[arg(long)]
        npm: bool,
        /// Only remove PyPI packages
        #[arg(long)]
        pypi: bool,
        /// Only remove crates.io packages
        #[arg(long)]
        crates: bool,
    },
}

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Some(Commands::Fetch {
            packages,
            cwd,
            quiet,
        }) => commands::fetch::run(&packages, cwd.as_deref(), quiet),

        Some(Commands::Path {
            packages,
            cwd,
            verbose,
        }) => commands::path::run(&packages, cwd.as_deref(), verbose),

        Some(Commands::List { json }) => commands::list::run(json),

        Some(Commands::Remove { packages }) => commands::remove::run(&packages),

        Some(Commands::Clean {
            packages,
            repos,
            npm,
            pypi,
            crates,
        }) => {
            let registry = if npm {
                Some(core::registries::Registry::Npm)
            } else if pypi {
                Some(core::registries::Registry::PyPI)
            } else if crates {
                Some(core::registries::Registry::Crates)
            } else {
                None
            };

            commands::clean::run(packages || registry.is_some(), repos, registry)
        }

        None => {
            Cli::parse_from(["opensrc", "--help"]);
            Ok(())
        }
    };

    if let Err(e) = result {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}
