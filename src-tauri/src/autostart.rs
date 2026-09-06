//! "Start Kavibay when I log in."
//!
//! Deliberately not `tauri-plugin-autostart`. On Windows that plugin writes the
//! same `HKCU\…\Run` value this module writes, and on Linux the same
//! `~/.config/autostart/*.desktop` file — so the dependency would buy an API
//! wrapper around forty lines, plus a plugin ACL surface on the WebView that we
//! would then have to narrow again. It would not buy the one decision that
//! actually matters here.
//!
//! # A stale entry counts as off
//!
//! Both mechanisms store an absolute path to an executable. Move the install,
//! reinstall somewhere else, or — the common one — switch autostart on from a
//! `target/debug` build, and the entry goes on naming a binary that is not this
//! one. Reporting that as "on" would be wrong in both directions: the switch in
//! Settings would claim to describe this install, and turning it off would leave
//! the other path booting at every logon.
//!
//! So [`autostart_enabled`] asks whether the entry names *this* executable, and
//! [`autostart_set`] always rewrites rather than checking first. A stale entry
//! then reads as off and is repaired by the next switch-on — which is what the
//! switch already implies it does.
//!
//! Nothing here launches the app differently: the window starts hidden on every
//! start anyway (`consumeFirstOpen` in the frontend is what makes the very first
//! one an exception), so an autostarted Kavibay is a tray icon waiting for a
//! Ctrl double tap.

#[cfg(any(windows, target_os = "linux", test))]
use std::path::Path;

use tauri::AppHandle;

/// Registry value name on Windows, and the `.desktop` file stem on Linux.
const ENTRY_NAME: &str = "Kavibay";

// The rules below are plain string handling, kept out of the platform modules so
// the tests can run them everywhere — which is also why each one carries the
// list of builds that actually call it. Without those bounds a release build on
// either platform warns about the other platform's helpers, and a warning a
// contributor is told to ignore is a warning nobody reads.

/// The Run value for `exe`.
///
/// Quoted because Windows splits an unquoted Run value on spaces and tries the
/// prefixes in turn — and `C:\Program Files\…` is the normal install location,
/// not an exotic one.
#[cfg(any(windows, test))]
pub fn run_value(exe: &Path) -> String {
    format!("\"{}\"", exe.display())
}

/// The executable named by a Run value, with the quoting undone.
///
/// A value we wrote is always fully quoted. One written by hand, or by an older
/// build, may not be — and may carry arguments we never pass. Taking everything
/// up to the closing quote covers the first case; taking the whole trimmed
/// string covers the second, and misreads only a bare path *with* arguments,
/// which then counts as somebody else's entry and is overwritten by the next
/// switch-on. That is the safe direction to be wrong in.
#[cfg(any(windows, target_os = "linux", test))]
pub fn exe_from_run_value(value: &str) -> &str {
    let trimmed = value.trim();
    match trimmed.strip_prefix('"') {
        Some(rest) => match rest.find('"') {
            Some(end) => &rest[..end],
            None => rest,
        },
        None => trimmed,
    }
}

/// Whether two executable paths name the same file, as far as a string can say.
///
/// Windows paths are case-insensitive, so a Run value written by the installer
/// in one casing must still match `current_exe()` in another. This is not a
/// canonical comparison — a symlink or a substituted drive defeats it — and it
/// does not need to be: a false negative shows the switch as off, and toggling
/// it rewrites the value.
#[cfg(any(windows, target_os = "linux", test))]
fn same_executable(a: &str, b: &Path) -> bool {
    a.eq_ignore_ascii_case(&b.display().to_string())
}

/// The XDG autostart entry for `exe`.
///
/// `X-GNOME-Autostart-enabled` is redundant for a spec-compliant reader — the
/// file's presence is the switch — but GNOME writes it and some tools still look
/// for it, and an entry half the desktops ignore is worse than a spare line.
#[cfg(any(target_os = "linux", test))]
pub fn desktop_entry(exe: &Path) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={ENTRY_NAME}\n\
         Exec=\"{}\"\n\
         Terminal=false\n\
         X-GNOME-Autostart-enabled=true\n",
        exe.display()
    )
}

/// The executable named by a desktop entry's `Exec=` line, unquoted.
#[cfg(any(target_os = "linux", test))]
pub fn exec_from_desktop_entry(text: &str) -> Option<&str> {
    text.lines()
        .find_map(|line| line.trim().strip_prefix("Exec="))
        .map(exe_from_run_value)
}

/// False where this module has no mechanism, so the UI can leave the switch out
/// rather than offer one that always fails.
pub fn supported() -> bool {
    cfg!(any(windows, target_os = "linux"))
}

#[cfg(windows)]
mod platform {
    use super::{exe_from_run_value, run_value, same_executable, ENTRY_NAME};
    use std::path::Path;
    use tauri::AppHandle;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    pub fn enabled(_app: &AppHandle, exe: &Path) -> Result<bool, String> {
        let run = match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_READ)
        {
            Ok(key) => key,
            // No Run key at all is a fresh profile, not a failure to read one.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };
        match run.get_value::<String, _>(ENTRY_NAME) {
            Ok(value) => Ok(same_executable(exe_from_run_value(&value), exe)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn set(_app: &AppHandle, exe: &Path, on: bool) -> Result<(), String> {
        let (run, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey_with_flags(RUN_KEY, KEY_SET_VALUE | KEY_READ)
            .map_err(|error| error.to_string())?;
        if on {
            return run
                .set_value(ENTRY_NAME, &run_value(exe))
                .map_err(|error| error.to_string());
        }
        match run.delete_value(ENTRY_NAME) {
            Ok(()) => Ok(()),
            // Already absent is the state the caller asked for.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{desktop_entry, exec_from_desktop_entry, same_executable, ENTRY_NAME};
    use std::fs;
    use std::path::{Path, PathBuf};
    use tauri::{AppHandle, Manager};

    /// `$XDG_CONFIG_HOME/autostart`, falling back to the spec's `~/.config`.
    fn autostart_dir(app: &AppHandle) -> Result<PathBuf, String> {
        if let Some(dir) = std::env::var_os("XDG_CONFIG_HOME") {
            let path = PathBuf::from(dir);
            if path.is_absolute() {
                return Ok(path.join("autostart"));
            }
        }
        let home = app.path().home_dir().map_err(|error| error.to_string())?;
        Ok(home.join(".config").join("autostart"))
    }

    fn entry_path(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(autostart_dir(app)?.join(format!("{}.desktop", ENTRY_NAME.to_lowercase())))
    }

    pub fn enabled(app: &AppHandle, exe: &Path) -> Result<bool, String> {
        let text = match fs::read_to_string(entry_path(app)?) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };
        Ok(exec_from_desktop_entry(&text).is_some_and(|found| same_executable(found, exe)))
    }

    pub fn set(app: &AppHandle, exe: &Path, on: bool) -> Result<(), String> {
        let path = entry_path(app)?;
        if on {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            return fs::write(&path, desktop_entry(exe)).map_err(|error| error.to_string());
        }
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod platform {
    use std::path::Path;
    use tauri::AppHandle;

    pub fn enabled(_app: &AppHandle, _exe: &Path) -> Result<bool, String> {
        Ok(false)
    }

    pub fn set(_app: &AppHandle, _exe: &Path, _on: bool) -> Result<(), String> {
        Err("autostart is not supported on this platform".to_string())
    }
}

/// This process's executable, which is what an autostart entry has to name.
fn executable() -> Result<std::path::PathBuf, String> {
    std::env::current_exe().map_err(|error| format!("could not locate the executable: {error}"))
}

/// Whether an autostart entry exists *and* names this executable.
#[tauri::command]
pub fn autostart_enabled(app: AppHandle) -> Result<bool, String> {
    if !supported() {
        return Ok(false);
    }
    platform::enabled(&app, &executable()?)
}

/// Create or remove the autostart entry. Writing is idempotent.
#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    platform::set(&app, &executable()?, enabled)
}

/// Whether this platform has an autostart mechanism at all.
#[tauri::command]
pub fn autostart_supported() -> bool {
    supported()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn a_run_value_quotes_the_path_and_reads_back_unchanged() {
        let exe = PathBuf::from(r"C:\Program Files\Kavibay\kavibay.exe");
        let value = run_value(&exe);
        assert_eq!(value, "\"C:\\Program Files\\Kavibay\\kavibay.exe\"");
        assert_eq!(exe_from_run_value(&value), exe.display().to_string());
    }

    #[test]
    fn an_unquoted_run_value_is_still_read() {
        assert_eq!(
            exe_from_run_value(r"C:\Kavibay\kavibay.exe"),
            r"C:\Kavibay\kavibay.exe"
        );
    }

    #[test]
    fn windows_casing_does_not_make_an_entry_look_foreign() {
        let exe = PathBuf::from(r"C:\Program Files\Kavibay\kavibay.exe");
        assert!(same_executable(
            r"c:\program files\kavibay\KAVIBAY.EXE",
            &exe
        ));
    }

    #[test]
    fn an_entry_naming_another_install_counts_as_off() {
        let exe = PathBuf::from(r"C:\Program Files\Kavibay\kavibay.exe");
        assert!(!same_executable(
            r"D:\dev\kavibay\target\debug\kavibay.exe",
            &exe
        ));
    }

    #[test]
    fn a_desktop_entry_round_trips_through_its_exec_line() {
        let exe = PathBuf::from("/home/a b/.local/bin/kavibay");
        let text = desktop_entry(&exe);
        assert!(text.starts_with("[Desktop Entry]\n"));
        assert_eq!(
            exec_from_desktop_entry(&text),
            Some("/home/a b/.local/bin/kavibay")
        );
    }

    #[test]
    fn a_desktop_file_without_an_exec_line_names_nothing() {
        assert_eq!(
            exec_from_desktop_entry("[Desktop Entry]\nType=Application\n"),
            None
        );
    }
}
