//! Durable copy of the WebView's `kavibay:` localStorage keyspace.
//!
//! Widget content — notes, alarms, timers, the desk layout — lived only in the
//! WebView profile, and that profile is not a reliable place to keep anything:
//! it can be recreated independently of the app data directory, and a WebView2
//! that never shuts down gracefully may hold writes in memory and lose them
//! with the process. `appearance_prefs` already exists for exactly that reason;
//! this is the same idea for everything else the frontend stores.
//!
//! The frontend keeps writing localStorage as its fast synchronous cache and
//! mirrors the keyspace here; on the next start it hydrates from this file.
//!
//! # At rest
//!
//! The payload is wrapped with the same OS-backed protection as credentials
//! (`security::secrets`: DPAPI on Windows, a Keychain-held key on macOS), so a
//! copy of this file cannot be read on another machine or under another account. That is the only
//! threat it addresses: anything running as this user can still read it, and so
//! can the WebView's own localStorage — see SECURITY.md.
//!
//! Where no secret backend exists (Linux today), the snapshot
//! is written in plaintext rather than not at all. Credentials fail closed there
//! because an unstored token is an inconvenience; this file is the *only* copy of
//! the user's notes, and refusing to write it would reintroduce the data loss it
//! was built to fix. The trade is deliberate, logged, and documented.
//!
//! # While the key is refused
//!
//! On macOS the key sits behind a Keychain prompt the user can deny. The sealed
//! snapshot is then intact but closed to this process, so it stays exactly as
//! it is: not moved aside as foreign, and not replaced with plaintext. Saves go
//! to `web-storage.pending.json` instead, in plaintext for the reason above. The
//! first load or save that opens the sealed snapshot again folds pending over
//! it, seals the result and removes pending. A key deleted while the snapshot
//! was closed can come back in that fold, which beats losing one that was not.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::paths::data_dir;
use crate::security::secrets::{protect_secret, unprotect_secret, UnprotectError};

/// Envelope field holding the protected payload.
///
/// An explicit marker rather than "try to decrypt, fall back to plaintext":
/// the file stays valid JSON in both shapes, the format is obvious to whoever
/// opens it, and a protected blob that fails to decrypt is never mistaken for
/// a plaintext snapshot to be replaced.
const PROTECTED_FIELD: &str = "protected";

/// A flat map of strings, the only shape localStorage has.
type Snapshot = Map<String, Value>;

/// The OS secret store, behind a seam so tests can close and open it.
trait Vault {
    fn seal(&self, plaintext: &str) -> Result<String, String>;
    fn open(&self, sealed: &str) -> Result<String, UnprotectError>;
}

struct OsVault;

impl Vault for OsVault {
    fn seal(&self, plaintext: &str) -> Result<String, String> {
        protect_secret(plaintext)
    }

    fn open(&self, sealed: &str) -> Result<String, UnprotectError> {
        unprotect_secret(sealed)
    }
}

/// The snapshot and, while its key is refused, the pending saves beside it.
struct Files {
    main: PathBuf,
    pending: PathBuf,
}

impl Files {
    fn in_dir(dir: &Path) -> Self {
        let main = dir.join("web-storage.json");
        Self {
            pending: main.with_extension("pending.json"),
            main,
        }
    }
}

/// What the snapshot file holds, as far as this process can read it.
enum Stored {
    /// Nothing usable: no file yet, or it was just moved aside.
    Missing,
    /// A snapshot this process can read, sealed or plain.
    Readable(Snapshot),
    /// A sealed snapshot whose key this process was refused.
    Closed(String),
}

impl Stored {
    fn into_snapshot(self) -> Option<Snapshot> {
        match self {
            Stored::Readable(snapshot) => Some(snapshot),
            Stored::Missing | Stored::Closed(_) => None,
        }
    }
}

/// Loads and saves run on Tauri's thread pool, and a flush can overlap a
/// debounced save. One at a time keeps the temp files and the fold consistent.
static FILES_LOCK: Mutex<()> = Mutex::new(());

fn exclusive() -> MutexGuard<'static, ()> {
    FILES_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Read the durable snapshot, or `None` when there is nothing usable to restore.
#[tauri::command]
pub fn web_storage_load(app: AppHandle) -> Result<Option<String>, String> {
    let files = Files::in_dir(&data_dir(&app)?);
    let _exclusive = exclusive();
    Ok(load(&files, &OsVault)?.map(|snapshot| Value::Object(snapshot).to_string()))
}

/// Replace the durable snapshot.
#[tauri::command]
pub fn web_storage_save(app: AppHandle, value: String) -> Result<(), String> {
    let parsed: Value =
        serde_json::from_str(&value).map_err(|error| format!("invalid web storage: {error}"))?;
    let snapshot = into_snapshot(parsed).ok_or("web storage must be an object of strings")?;
    let files = Files::in_dir(&data_dir(&app)?);
    let _exclusive = exclusive();
    save(&files, &OsVault, snapshot)
}

fn load(files: &Files, vault: &impl Vault) -> Result<Option<Snapshot>, String> {
    let folded = match (read_main(files, vault)?, read_pending(files)?) {
        (Stored::Closed(reason), pending) => {
            eprintln!("[web_storage] snapshot is closed ({reason}); saving to pending");
            return Ok(pending);
        }
        (main, None) => return Ok(main.into_snapshot()),
        (main, Some(pending)) => fold(main.into_snapshot(), pending),
    };
    write_main(files, vault, &folded)?;
    Ok(Some(folded))
}

fn save(files: &Files, vault: &impl Vault, snapshot: Snapshot) -> Result<(), String> {
    // Pending outlives a load only while the snapshot is closed, so a save that
    // finds it comes from a session that never read the sealed snapshot.
    let snapshot = if files.pending.exists() {
        match read_main(files, vault)? {
            Stored::Closed(_) => return write_atomic(&files.pending, &text_of(&snapshot)),
            main => fold(main.into_snapshot(), snapshot),
        }
    } else {
        snapshot
    };
    write_main(files, vault, &snapshot)
}

/// Replace the snapshot, sealed where the platform can seal, and drop pending.
fn write_main(files: &Files, vault: &impl Vault, snapshot: &Snapshot) -> Result<(), String> {
    let text = text_of(snapshot);
    let body = match vault.seal(&text) {
        Ok(sealed) => json!({ PROTECTED_FIELD: sealed }).to_string(),
        Err(_) if holds_sealed(&files.main)? => return write_atomic(&files.pending, &text),
        Err(error) => {
            // See the module docs: losing the notes is the worse failure.
            eprintln!("[web_storage] storing unprotected ({error})");
            text
        }
    };
    write_atomic(&files.main, &body)?;
    remove_if_present(&files.pending)
}

fn read_main(files: &Files, vault: &impl Vault) -> Result<Stored, String> {
    let Some(value) = read_json(&files.main)? else {
        return Ok(Stored::Missing);
    };
    let Some(sealed) = value.get(PROTECTED_FIELD).and_then(Value::as_str) else {
        // No envelope: a plaintext snapshot, either from a build without a
        // secret backend or from before this file was protected.
        return match into_snapshot(value) {
            Some(snapshot) => Ok(Stored::Readable(snapshot)),
            None => {
                quarantine(&files.main, "snapshot is not a flat string map")?;
                Ok(Stored::Missing)
            }
        };
    };

    match vault.open(sealed) {
        Ok(payload) => match serde_json::from_str(&payload).ok().and_then(into_snapshot) {
            Some(snapshot) => Ok(Stored::Readable(snapshot)),
            None => {
                quarantine(&files.main, "decrypted snapshot is not a flat string map")?;
                Ok(Stored::Missing)
            }
        },
        Err(UnprotectError::KeyUnavailable(reason)) => Ok(Stored::Closed(reason)),
        Err(UnprotectError::Unreadable(_)) => {
            // Wrong user profile or wrong machine. On the machine it came from,
            // this file is still perfectly readable.
            quarantine(&files.main, "snapshot cannot be decrypted by this user")?;
            Ok(Stored::Missing)
        }
    }
}

fn read_pending(files: &Files) -> Result<Option<Snapshot>, String> {
    Ok(read_json(&files.pending)?.and_then(into_snapshot))
}

fn holds_sealed(path: &Path) -> Result<bool, String> {
    Ok(read_json(path)?.is_some_and(|value| value.get(PROTECTED_FIELD).is_some()))
}

/// The file's JSON, or `None` when there is no file. A file that is not JSON
/// is moved aside.
fn read_json(path: &Path) -> Result<Option<Value>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    // A hand edit in Notepad leaves a BOM, which the JSON parser refuses.
    match serde_json::from_str(raw.trim_start_matches('\u{feff}')) {
        Ok(value) => Ok(Some(value)),
        Err(_) => {
            quarantine(path, "snapshot is not valid JSON")?;
            Ok(None)
        }
    }
}

/// Refusing anything but a flat map of strings keeps a malformed write from
/// replacing a good file.
fn into_snapshot(value: Value) -> Option<Snapshot> {
    match value {
        Value::Object(map) if map.values().all(Value::is_string) => Some(map),
        _ => None,
    }
}

/// `newer` over `base`: keys only `base` holds come back, `newer` wins the rest.
fn fold(base: Option<Snapshot>, newer: Snapshot) -> Snapshot {
    let mut folded = base.unwrap_or_default();
    folded.extend(newer);
    folded
}

fn text_of(snapshot: &Snapshot) -> String {
    Value::Object(snapshot.clone()).to_string()
}

/// Written to a sibling temp file and renamed into place: this file is rewritten
/// on every debounce tick, and a half-written snapshot after a crash would lose
/// far more than the tick that was in flight. `fs::rename` replaces the target
/// atomically on both Windows and Unix.
fn write_atomic(path: &Path, body: &str) -> Result<(), String> {
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, body).map_err(|error| error.to_string())?;
    fs::rename(&temp, path).map_err(|error| error.to_string())
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

/// Move an unusable file aside instead of letting the next save overwrite it.
///
/// The data may still be recoverable — by hand, or by the user and machine
/// whose key it belongs to — and it never gets a second chance if the mirror
/// writes over it first. For the same reason an earlier file moved aside is
/// never replaced.
fn quarantine(path: &Path, reason: &str) -> Result<(), String> {
    let aside = (1..)
        .map(|n| match n {
            1 => path.with_extension("corrupt.json"),
            n => path.with_extension(format!("corrupt-{n}.json")),
        })
        .find(|candidate| !candidate.exists())
        .expect("an unused name");
    fs::rename(path, &aside)
        .map_err(|error| format!("{reason}, and moving the file aside failed: {error}"))?;
    eprintln!("[web_storage] {reason}; kept as {}", aside.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Seals by prefixing, so a test can read and forge what lands on disk.
    #[derive(Default)]
    struct TestVault {
        closed: Cell<bool>,
    }

    impl Vault for TestVault {
        fn seal(&self, plaintext: &str) -> Result<String, String> {
            if self.closed.get() {
                return Err("key refused".into());
            }
            Ok(format!("sealed:{plaintext}"))
        }

        fn open(&self, sealed: &str) -> Result<String, UnprotectError> {
            if self.closed.get() {
                return Err(UnprotectError::KeyUnavailable("key refused".into()));
            }
            sealed
                .strip_prefix("sealed:")
                .map(str::to_string)
                .ok_or_else(|| UnprotectError::Unreadable("another user's key".into()))
        }
    }

    fn temp_files() -> Files {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "kavibay-web-storage-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Files::in_dir(&dir)
    }

    fn snapshot(pairs: &[(&str, &str)]) -> Snapshot {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), Value::from(*value)))
            .collect()
    }

    #[test]
    fn a_closed_snapshot_is_kept_and_later_takes_in_what_was_saved_meanwhile() {
        let files = temp_files();
        let vault = TestVault::default();
        save(&files, &vault, snapshot(&[("a", "1"), ("b", "1")])).unwrap();
        let sealed = fs::read_to_string(&files.main).unwrap();

        vault.closed.set(true);
        assert_eq!(load(&files, &vault).unwrap(), None);
        save(&files, &vault, snapshot(&[("a", "2"), ("c", "1")])).unwrap();
        assert_eq!(
            fs::read_to_string(&files.main).unwrap(),
            sealed,
            "the sealed snapshot is left as it was"
        );
        assert!(!files.main.with_extension("corrupt.json").exists());
        assert_eq!(
            load(&files, &vault).unwrap(),
            Some(snapshot(&[("a", "2"), ("c", "1")])),
            "a closed start restores what the last closed session saved"
        );

        vault.closed.set(false);
        let folded = snapshot(&[("a", "2"), ("b", "1"), ("c", "1")]);
        assert_eq!(load(&files, &vault).unwrap(), Some(folded.clone()));
        assert!(!files.pending.exists(), "pending is folded in");
        assert!(holds_sealed(&files.main).unwrap());
        assert_eq!(load(&files, &vault).unwrap(), Some(folded));
    }

    #[test]
    fn a_save_after_the_key_opens_takes_in_the_snapshot_the_session_never_read() {
        let files = temp_files();
        let vault = TestVault::default();
        save(&files, &vault, snapshot(&[("a", "1"), ("b", "1")])).unwrap();

        vault.closed.set(true);
        assert_eq!(load(&files, &vault).unwrap(), None);
        save(&files, &vault, snapshot(&[("a", "2")])).unwrap();

        vault.closed.set(false);
        save(&files, &vault, snapshot(&[("a", "3"), ("c", "1")])).unwrap();
        assert!(!files.pending.exists());
        assert_eq!(
            load(&files, &vault).unwrap(),
            Some(snapshot(&[("a", "3"), ("b", "1"), ("c", "1")]))
        );
    }

    #[test]
    fn an_open_save_replaces_the_snapshot_and_keeps_deletions() {
        let files = temp_files();
        let vault = TestVault::default();
        save(&files, &vault, snapshot(&[("a", "1"), ("b", "1")])).unwrap();
        save(&files, &vault, snapshot(&[("a", "1")])).unwrap();
        assert_eq!(load(&files, &vault).unwrap(), Some(snapshot(&[("a", "1")])));
    }

    #[test]
    fn without_a_key_and_nothing_sealed_the_snapshot_is_stored_plain() {
        let files = temp_files();
        let vault = TestVault::default();
        vault.closed.set(true);

        save(&files, &vault, snapshot(&[("a", "1"), ("b", "1")])).unwrap();
        save(&files, &vault, snapshot(&[("b", "2")])).unwrap();
        assert!(!files.pending.exists());
        assert!(!holds_sealed(&files.main).unwrap());
        assert_eq!(load(&files, &vault).unwrap(), Some(snapshot(&[("b", "2")])));
    }

    #[test]
    fn a_foreign_snapshot_is_moved_aside_without_replacing_an_earlier_one() {
        let files = temp_files();
        let vault = TestVault::default();
        let first = r#"{"protected":"from another machine"}"#;
        let second = r#"{"protected":"from a third machine"}"#;

        fs::write(&files.main, first).unwrap();
        assert_eq!(load(&files, &vault).unwrap(), None);
        fs::write(&files.main, second).unwrap();
        assert_eq!(load(&files, &vault).unwrap(), None);

        assert!(!files.main.exists());
        assert_eq!(
            fs::read_to_string(files.main.with_extension("corrupt.json")).unwrap(),
            first
        );
        assert_eq!(
            fs::read_to_string(files.main.with_extension("corrupt-2.json")).unwrap(),
            second
        );
    }
}
