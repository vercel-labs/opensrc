use crate::core::fetcher::ensure_cached;

pub fn run(
    specs: &[String],
    cwd: Option<&str>,
    quiet: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let cwd = cwd.unwrap_or(".");

    let mut fetched = 0u32;
    let mut cached = 0u32;
    let mut had_errors = false;

    for spec in specs {
        match ensure_cached(spec, cwd, !quiet) {
            Ok(outcome) => {
                if outcome.from_cache {
                    cached += 1;
                    if !quiet {
                        println!(
                            "  ✓ {}@{} already cached ({})",
                            outcome.name,
                            outcome.version,
                            outcome.path.display()
                        );
                    }
                } else {
                    fetched += 1;
                    if !quiet {
                        if let Some(warn) = &outcome.warning {
                            println!("  ⚠ {warn}");
                        }
                        println!(
                            "  ✓ Fetched {}@{} from {} ({})",
                            outcome.name,
                            outcome.version,
                            outcome.source_label,
                            outcome.path.display()
                        );
                    }
                }
            }
            Err(e) => {
                had_errors = true;
                eprintln!("  ✗ {spec}: {e}");
            }
        }
    }

    if !quiet {
        let mut parts = Vec::new();
        if fetched > 0 {
            parts.push(format!("{fetched} fetched"));
        }
        if cached > 0 {
            parts.push(format!("{cached} already cached"));
        }
        if !parts.is_empty() {
            println!("\n{}", parts.join(", "));
        }
    }

    if had_errors {
        return Err("Some sources could not be fetched".into());
    }

    Ok(())
}
