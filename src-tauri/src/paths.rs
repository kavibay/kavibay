//! One place that decides where Kavibay keeps its data.
//!
//! Everything durable hangs off this directory: settings, the localStorage
//! mirror, the credential database, installed packages, wizard drafts, the
//! per-widget files. The default is `~/.kavibay` — the same path on every
//! platform, short enough to type and to put in a bug report, and outside the
//! roaming profile that Windows copies at every logon. A widget's SQLite log
//! and an icon cache have no business being carried across a domain network.
//!
//! Nothing else may resolve a data directory of its own. A module that asks
//! Tauri for `app_data_dir()` directly silently opts out of the override below,
//! which is how a dev run ends up writing into the real profile.
//!
//! `KAVIBAY_DATA_DIR` redirects the whole directory so a dev build can run
//! against a throwaway one instead of sharing — and migrating — the installed
//! instance's real data.
//!
//! The override is a development and test switch, **not** a portable mode.
//! `web-storage.json` and the credential store are wrapped with the OS secret
//! backend (DPAPI on Windows, the Keychain on macOS), which binds them to this
//! user on this machine.
//! A data directory copied elsewhere is unreadable there whatever the path
//! says, so pointing this at a USB stick buys a broken profile, not a portable
//! one. See SECURITY.md.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};

/// Environment variable that redirects the whole data directory.
pub const DATA_DIR_ENV: &str = "KAVIBAY_DATA_DIR";

/// Directory name under the user's home.
const ROOT_DIR_NAME: &str = ".kavibay";

/// Everything under here is regenerable. Nothing a user would have to recreate
/// by hand goes in, so "delete this folder" stays advice that is always safe.
const CACHE_DIR_NAME: &str = "cache";

/// Read once: the environment cannot change under a running process, and a
/// directory that moved halfway through a session would be worse than either
/// choice made consistently.
static OVERRIDE: OnceLock<Result<Option<PathBuf>, String>> = OnceLock::new();

/// The pre-`~/.kavibay` profile is moved at most once per process.
static MIGRATED: OnceLock<()> = OnceLock::new();

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

/// The default root, `~/.kavibay`, from a home directory.
///
/// Split out from `data_dir` so the naming rule is pinned by a test rather than
/// by whichever platform the next person happens to build on.
pub fn default_root(home: &Path) -> PathBuf {
    home.join(ROOT_DIR_NAME)
}

/// Whether the directory of an older install should be moved here.
///
/// Never a merge. If both exist, the new one is what the app has been using and
/// the old one is a leftover; merging would have to guess which `settings.json`
/// is the real one, and a wrong guess is indistinguishable from the user's
/// settings having reverted on their own.
pub fn wants_migration(old_exists: bool, new_exists: bool) -> bool {
    old_exists && !new_exists
}

/// The data directory, created if it does not exist yet.
///
/// Fails loudly when the override is unusable instead of falling back to the
/// default: a caller that asked for a specific directory and quietly got the
/// real one would write test data into the user's profile.
pub fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = match data_dir_override()? {
        Some(path) => path,
        None => {
            let home = app.path().home_dir().map_err(|error| error.to_string())?;
            let root = default_root(&home);
            // Before the directory is created: creating it first would make
            // every existing install look like a fresh one.
            MIGRATED.get_or_init(|| migrate_legacy_root(app, &root));
            root
        }
    };
    fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create data directory {}: {error}", dir.display()))?;
    Ok(dir)
}

/// The cache directory, created if it does not exist yet.
///
/// Only for files the app can rebuild from scratch. Anything a user would have
/// to recreate by hand — notes, clipboard history, an imported image a widget
/// still points at — belongs in `data_dir` even when it reads like a cache.
pub fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join(CACHE_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "could not create cache directory {}: {error}",
            dir.display()
        )
    })?;
    Ok(dir)
}

/// Move a pre-`~/.kavibay` profile into place, once.
///
/// Installs before this change kept everything in Tauri's `app_data_dir()`.
/// Leaving it there and starting empty would look like every setting, note and
/// stored credential had been wiped, so the old directory is moved rather than
/// abandoned — the one-time cost of changing where the app lives.
///
/// Never fatal. A profile that cannot be moved is left exactly where it is and
/// the app starts on an empty one, which is recoverable by hand; a boot that
/// refuses to finish is not.
fn migrate_legacy_root<R: Runtime>(app: &AppHandle<R>, root: &Path) {
    let old = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(_) => return,
    };
    if old == root || !wants_migration(old.is_dir(), root.exists()) {
        return;
    }

    if fs::rename(&old, root).is_ok() {
        eprintln!("[paths] moved {} to {}", old.display(), root.display());
        return;
    }

    // A rename across volumes fails outright, and AppData redirected to a
    // network share is exactly the setup this move exists to get out of. So
    // copy into a staging directory beside the target and swap that in: a copy
    // that dies halfway then leaves no half-profile for the next boot to
    // mistake for a finished migration.
    let staging = root.with_file_name(format!("{ROOT_DIR_NAME}.incoming"));
    let _ = fs::remove_dir_all(&staging);
    if let Err(error) = copy_tree(&old, &staging) {
        let _ = fs::remove_dir_all(&staging);
        eprintln!(
            "[paths] could not copy {} to {}: {error}; starting on an empty profile",
            old.display(),
            root.display()
        );
        return;
    }
    if let Err(error) = fs::rename(&staging, root) {
        let _ = fs::remove_dir_all(&staging);
        eprintln!(
            "[paths] could not put {} in place: {error}; starting on an empty profile",
            root.display()
        );
        return;
    }

    // The copy left a second credential store and a second copy of the notes on
    // disk. Both are DPAPI-wrapped, but two copies of a secret store is one
    // more than the app needs.
    match fs::remove_dir_all(&old) {
        Ok(()) => eprintln!("[paths] moved {} to {}", old.display(), root.display()),
        Err(error) => eprintln!(
            "[paths] copied {} to {} but could not remove the original: {error}",
            old.display(),
            root.display()
        ),
    }
}

/// Recursive directory copy. Only used by the migration above.
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
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

    #[test]
    fn the_root_is_a_dot_directory_in_the_home_directory() {
        let root = default_root(Path::new(absolute()));
        assert_eq!(
            root.file_name().and_then(|name| name.to_str()),
            Some(".kavibay")
        );
        assert_eq!(root.parent(), Some(Path::new(absolute())));
    }

    #[test]
    fn only_an_old_directory_without_a_new_one_migrates() {
        assert!(wants_migration(true, false));
        assert!(!wants_migration(false, false));
        assert!(!wants_migration(false, true));
        // The case that must never merge two profiles into one.
        assert!(!wants_migration(true, true));
    }

    #[test]
    fn a_copied_tree_keeps_its_nesting_and_contents() {
        let base = env::temp_dir().join(format!("kavibay-copy-{}", std::process::id()));
        let from = base.join("from");
        let to = base.join("to");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(from.join("nested")).unwrap();
        fs::write(from.join("settings.json"), b"{}").unwrap();
        fs::write(from.join("nested").join("widget.png"), b"png").unwrap();

        copy_tree(&from, &to).unwrap();

        assert_eq!(fs::read(to.join("settings.json")).unwrap(), b"{}");
        assert_eq!(
            fs::read(to.join("nested").join("widget.png")).unwrap(),
            b"png"
        );
        let _ = fs::remove_dir_all(&base);
    }
}
