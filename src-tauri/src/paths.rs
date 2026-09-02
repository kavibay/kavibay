//! One place that decides where Kavibay keeps its data.
//!
//! Everything durable hangs off this directory: settings, the localStorage
//! mirror, the credential database, the per-widget caches. Tauri's
//! `app_data_dir()` is the default; `KAVIBAY_DATA_DIR` redirects it so a dev
//! build can run against a throwaway directory instead of sharing — and
//! migrating — the installed instance's real data.
//!
//! The override is a development and test switch, **not** a portable mode.
//! `web-storage.json` and the credential store are wrapped with the OS secret
//! backend (DPAPI on Windows), which binds them to this user on this machine.
//! A data directory copied elsewhere is unreadable there whatever the path
//! says, so pointing this at a USB stick buys a broken profile, not a portable
//! one. See SECURITY.md.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};

/// Environment variable that redirects the whole data directory.
pub const DATA_DIR_ENV: &str = "KAVIBAY_DATA_DIR";

/// Read once: the environment cannot change under a running process, and a
/// directory that moved halfway through a session would be worse than either
/// choice made consistently.
static OVERRIDE: OnceLock<Result<Option<PathBuf>, String>> = OnceLock::new();

/// Interpret the raw environment value.
///
/// Absent, empty or whitespace means "no override" — an exported-but-empty
/// variable is how a shell script says nothing, not how it says "use the
/// current directory".
///
/// A relative path is refused rather than resolved. The working directory of a
/// desktop app launched from a shortcut or the tray is not something anyone can
/// predict, and a data directory that silently landed somewhere else is
/// indistinguishable from lost data.
pub fn parse_override(raw: Option<&str>) -> Result<Option<PathBuf>, String> {
    let value = match raw {
        Some(value) => value.trim(),
        None => return Ok(None),
    };
    if value.is_empty() {
        return Ok(None);
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!(
            "{DATA_DIR_ENV} must be an absolute path, got {value:?}"
        ));
    }
    Ok(Some(path))
}

/// The parsed override, logged the first time anything asks for it.
///
/// An instance writing somewhere other than the usual place has to be visible
/// in the log — otherwise "my settings are gone" and "this build is pointed at
/// a scratch directory" look the same from the outside.
fn data_dir_override() -> Result<Option<PathBuf>, String> {
    OVERRIDE
        .get_or_init(|| {
            let parsed = parse_override(env::var(DATA_DIR_ENV).ok().as_deref());
            match &parsed {
                Ok(Some(path)) => {
                    eprintln!("[paths] {DATA_DIR_ENV} in effect: {}", path.display());
                }
                Ok(None) => {}
                Err(error) => eprintln!("[paths] {error}"),
            }
            parsed
        })
        .clone()
}

/// True when `KAVIBAY_DATA_DIR` points this process at its own data directory.
///
/// Such a process is a *separate profile*, not a second copy of whatever is
/// already running, so `run()` leaves the single-instance plugin unregistered
/// for it — see the comment at that registration.
///
/// An unusable override reports `false`: `data_dir` refuses to start in that
/// case anyway, and the instance should fail on its own terms rather than fail
/// after also having disabled single instancing.
pub fn has_data_dir_override() -> bool {
    matches!(data_dir_override(), Ok(Some(_)))
}

/// The data directory, created if it does not exist yet.
///
/// Fails loudly when the override is unusable instead of falling back to the
/// default: a caller that asked for a specific directory and quietly got the
/// real one would write test data into the user's profile.
pub fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = match data_dir_override()? {
        Some(path) => path,
        None => app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
    };
    fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create data directory {}: {error}", dir.display()))?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Absolute on this platform, so the test says the same thing everywhere.
    fn absolute() -> &'static str {
        if cfg!(windows) {
            r"C:\tmp\kavibay-test"
        } else {
            "/tmp/kavibay-test"
        }
    }

    #[test]
    fn an_unset_variable_means_no_override() {
        assert_eq!(parse_override(None), Ok(None));
    }

    #[test]
    fn an_empty_or_blank_value_means_no_override() {
        assert_eq!(parse_override(Some("")), Ok(None));
        assert_eq!(parse_override(Some("   ")), Ok(None));
    }

    #[test]
    fn an_absolute_path_is_taken_as_written() {
        assert_eq!(
            parse_override(Some(absolute())),
            Ok(Some(PathBuf::from(absolute())))
        );
    }

    #[test]
    fn surrounding_whitespace_is_trimmed() {
        let padded = format!("  {}  ", absolute());
        assert_eq!(
            parse_override(Some(&padded)),
            Ok(Some(PathBuf::from(absolute())))
        );
    }

    #[test]
    fn a_relative_path_is_refused_rather_than_resolved() {
        assert!(parse_override(Some("kavibay-data")).is_err());
        assert!(parse_override(Some("./kavibay-data")).is_err());
        assert!(parse_override(Some("../kavibay-data")).is_err());
    }
}
