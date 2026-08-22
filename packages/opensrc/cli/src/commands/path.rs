use crate::core::error::Result;
use crate::core::fetcher::ensure_cached;

pub fn run(specs: &[String], cwd: Option<&str>, local: bool, verbose: bool) -> Result<()> {
    let _cache = crate::core::cache::LocalCache::new(cwd, local)?;
    let cwd = cwd.unwrap_or(".");
    for spec in specs {
        let outcome = ensure_cached(spec, cwd, verbose)?;
        println!("{}", outcome.path.display());
    }
    Ok(())
}
