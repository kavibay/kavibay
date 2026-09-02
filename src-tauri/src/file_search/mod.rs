//! Folder browsing + in-folder file search for the palette.
//!
//! Host-only and fail closed: absolute paths, no `..`, directory must exist.
//! The search backend is per-platform (`win_search` uses the Windows Search
//! index) with one portable directory walk as the shared fallback, so the
//! frontend sees the same command and the same rows everywhere.

pub mod walk;

#[cfg(windows)]
pub mod win_search;

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::AtomicBool;
#[cfg(windows)]
use std::sync::atomic::Ordering;
#[cfg(windows)]
use std::sync::mpsc;
use std::time::Duration;

const DEFAULT_LIMIT: usize = 20;
/// Autocomplete stays short; browsing a folder lists a screenful and then some.
const MAX_COMPLETION_LIMIT: usize = 40;
const MAX_BROWSE_LIMIT: usize = 200;
const MAX_SEARCH_LIMIT: usize = 60;

/// One filesystem hit — the only shape the palette knows about.
///
/// Carries the sort keys with it: the palette lets you re-sort a listing, and
/// a second round trip per column would make that feel like a reload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// Last write time in epoch milliseconds; `None` when unreadable.
    pub modified_ms: Option<u64>,
    /// Bytes; 0 for directories (their entry size means nothing here).
    pub size: u64,
}

/// Read the sort keys off already-obtained metadata (no extra stat).
pub(crate) fn sort_keys(meta: &fs::Metadata) -> (Option<u64>, u64) {
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as u64);
    let size = if meta.is_dir() { 0 } else { meta.len() };
    (modified, size)
}

/// Fill sort keys for entries that arrived without them (the Windows index
/// answers with names and paths only). One stat per hit, capped by the limit.
pub fn hydrate_sort_keys(entries: &mut [FileEntry]) {
    for entry in entries.iter_mut() {
        if entry.modified_ms.is_some() {
            continue;
        }
        if let Ok(meta) = fs::metadata(&entry.path) {
            let (modified, size) = sort_keys(&meta);
            entry.modified_ms = modified;
            entry.size = size;
        }
    }
}

/// Direct children of `dir`, optionally filtered by a name prefix.
/// Directories first, then case-insensitive by name.
pub fn list_children(dir: &Path, prefix: &str, limit: usize) -> Result<Vec<FileEntry>, String> {
    let prefix_lower = prefix.trim().to_lowercase();

    let mut out: Vec<FileEntry> = Vec::new();
    let read = fs::read_dir(dir).map_err(|e| format!("read_dir:{e}"))?;
    for entry in read {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        if !prefix_lower.is_empty() && !name.to_lowercase().starts_with(&prefix_lower) {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        // Skip reparse-point surprises we can't classify; keep plain files/dirs.
        let is_dir = file_type.is_dir();
        let is_file = file_type.is_file();
        if !is_dir && !is_file {
            continue;
        }
        // The directory scan already carries this on Windows — free sort keys.
        let (modified_ms, size) = match entry.metadata() {
            Ok(meta) => sort_keys(&meta),
            Err(_) => (None, 0),
        };
        out.push(FileEntry {
            name,
            path: display_path(&entry.path()),
            is_dir,
            modified_ms,
            size,
        });
        if out.len() >= limit.saturating_mul(4).max(limit) {
            // Soft cap before sort so huge dirs don't explode memory.
            break;
        }
    }

    sort_entries(&mut out);
    out.truncate(limit);
    Ok(out)
}

/// Directories before files, then case-insensitive name order.
pub fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
}

/// Split a search query into lowercase words. All of them must match.
pub fn query_tokens(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(|token| token.to_lowercase())
        .filter(|token| !token.is_empty())
        .collect()
}

/// True when every token appears in the entry name (case-insensitive).
///
/// Applied to every backend's output, which is what makes the two agree: the
/// Windows indexer can match a document by its *contents*, and a file whose
/// name says nothing about what was typed is noise in a launcher list.
pub fn matches_tokens(name: &str, tokens: &[String]) -> bool {
    let lower = name.to_lowercase();
    tokens.iter().all(|token| lower.contains(token))
}

/// Order search hits: name-prefix hits, then shallow ones, then folders.
///
/// Ranking lives here rather than in a backend so the list looks the same
/// whether the answer came from the Windows index or the fallback walk.
pub fn rank_entries(root: &Path, query: &str, entries: &mut Vec<FileEntry>) {
    let tokens = query_tokens(query);
    entries.retain(|entry| matches_tokens(&entry.name, &tokens));

    let first = tokens.first().cloned().unwrap_or_default();
    let root_depth = root.components().count();
    entries.sort_by_cached_key(|entry| {
        let lower = entry.name.to_lowercase();
        let starts = u8::from(!lower.starts_with(&first));
        let depth = PathBuf::from(&entry.path)
            .components()
            .count()
            .saturating_sub(root_depth) as u16;
        (starts, depth, u8::from(!entry.is_dir), lower)
    });
}

/// Set while a platform search is still running (they are not cancellable).
#[cfg(windows)]
static PLATFORM_SEARCH_BUSY: AtomicBool = AtomicBool::new(false);

/// How long a platform search may take before the walk answers instead.
#[cfg(windows)]
const PLATFORM_SEARCH_TIMEOUT: Duration = Duration::from_millis(900);

/// Run the platform search under a deadline, or `None` when it cannot deliver.
///
/// A WinRT query is not cancellable from the outside, and a malformed filter
/// can make one never return at all. So it runs on its own thread: the command
/// stops waiting after the deadline, and while that thread is still stuck the
/// next keystroke skips straight to the walk instead of stacking up threads.
fn platform_search(dir: &Path, query: &str, limit: usize) -> Option<Vec<FileEntry>> {
    #[cfg(not(windows))]
    {
        // macOS would hook Spotlight (`NSMetadataQuery` / `mdfind`) in here.
        let _ = (dir, query, limit);
        return None;
    }

    #[cfg(windows)]
    {
        if PLATFORM_SEARCH_BUSY.swap(true, Ordering::SeqCst) {
            return None;
        }
        let (tx, rx) = mpsc::channel();
        let dir = dir.to_path_buf();
        let query = query.to_string();
        std::thread::spawn(move || {
            let result = win_search::search(&dir, &query, limit);
            PLATFORM_SEARCH_BUSY.store(false, Ordering::SeqCst);
            let _ = tx.send(result);
        });
        match rx.recv_timeout(PLATFORM_SEARCH_TIMEOUT) {
            Ok(Ok(hits)) => Some(hits),
            Ok(Err(_)) | Err(_) => None,
        }
    }
}

/// List files/folders in `dir` whose names start with `prefix` (case-insensitive).
#[tauri::command]
pub fn list_path_completions(
    dir: String,
    prefix: String,
    limit: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let limit = limit
        .unwrap_or(DEFAULT_LIMIT)
        .clamp(1, MAX_COMPLETION_LIMIT);
    let dir_path = validate_list_dir(&dir)?;
    list_children(&dir_path, &prefix, limit)
}

/// Direct children of a folder, unfiltered — the palette's folder browse view.
#[tauri::command]
pub fn browse_folder(dir: String, limit: Option<usize>) -> Result<Vec<FileEntry>, String> {
    let limit = limit.unwrap_or(MAX_BROWSE_LIMIT).clamp(1, MAX_BROWSE_LIMIT);
    let dir_path = validate_list_dir(&dir)?;
    list_children(&dir_path, "", limit)
}

/// Search *inside* a folder (recursively) for names matching `query`.
///
/// Windows answers from the Search index when the location is indexed — the
/// user folders this is offered on (Downloads, Desktop, …) are, by default —
/// and the same API deep-scans the folder when it is not. Any failure there
/// (indexer disabled, WinRT unavailable) degrades to the portable walk rather
/// than to an empty result: a slower answer beats "nothing found".
#[tauri::command]
pub fn search_folder(
    dir: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_SEARCH_LIMIT);
    let dir_path = validate_list_dir(&dir)?;
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return list_children(&dir_path, "", limit);
    }

    // An empty platform result is not proof there is nothing: the indexer may
    // be mid-rebuild for this folder. The walk is bounded, so let it confirm.
    let mut hits = match platform_search(&dir_path, trimmed, limit) {
        Some(hits) if !hits.is_empty() => hits,
        _ => walk::search(&dir_path, trimmed, limit)?,
    };

    rank_entries(&dir_path, trimmed, &mut hits);
    hits.truncate(limit);
    hydrate_sort_keys(&mut hits);
    Ok(hits)
}

/// Show `path` in the OS file manager, selected inside its parent folder.
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let target = validate_existing_path(&path)?;
    reveal_path(&display_path(&target))
}

/// Explorer's `/select` argument, exactly as it must reach the command line.
///
/// The quotes go around the *path*, not around the whole argument. Passing
/// this through `Command::arg` would produce `"/select,C:\a b\x.pdf"`, which
/// Explorer parses as a folder to open rather than an item to select — so it
/// silently opens the wrong thing instead of failing.
#[cfg(windows)]
fn reveal_raw_arg(path: &str) -> String {
    format!("/select,\"{path}\"")
}

/// Spawn the platform file manager with the item selected.
fn reveal_path(path: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        // Explorer exits non-zero even on success, so spawning is the whole
        // contract — there is no status worth reading back.
        Command::new("explorer.exe")
            .raw_arg(reveal_raw_arg(path))
            .spawn()
            .map_err(|e| format!("reveal_spawn:{e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .args(["-R", path])
            .spawn()
            .map_err(|e| format!("reveal_spawn:{e}"))?;
        return Ok(());
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = path;
        Err("reveal_in_file_manager is only supported on Windows and macOS".into())
    }
}

/// Open a new terminal window with cwd set to an absolute existing directory.
#[tauri::command]
pub fn open_in_terminal(path: String) -> Result<(), String> {
    let dir = validate_list_dir(&path)?;
    let dir_str = display_path(&dir);
    open_terminal_at(&dir_str)
}

/// Spawn the platform terminal at `dir` (already validated absolute directory).
fn open_terminal_at(dir: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        // Prefer Windows Terminal when available; fall back to PowerShell.
        if Command::new("wt.exe").arg("-d").arg(dir).spawn().is_ok() {
            return Ok(());
        }
        // Escape single quotes for PowerShell -LiteralPath '…'.
        let literal = dir.replace('\'', "''");
        Command::new("powershell.exe")
            .args([
                "-NoExit",
                "-Command",
                &format!("Set-Location -LiteralPath '{literal}'"),
            ])
            .spawn()
            .map_err(|e| format!("terminal_spawn:{e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .args(["-a", "Terminal", dir])
            .spawn()
            .map_err(|e| format!("terminal_spawn:{e}"))?;
        return Ok(());
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = dir;
        Err("open_in_terminal is only supported on Windows and macOS".into())
    }
}

/// Normalize and validate an absolute path (file or directory) that must exist.
pub fn validate_existing_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("path_empty".into());
    }
    if trimmed.contains('\0') {
        return Err("path_null".into());
    }

    let path = PathBuf::from(trimmed);
    // Reject parent / relative components — only absolute roots + normal names.
    let mut has_root = false;
    for comp in path.components() {
        match comp {
            Component::Prefix(_) | Component::RootDir => has_root = true,
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => return Err("path_parent".into()),
        }
    }
    if !has_root {
        return Err("path_not_absolute".into());
    }

    if !path.exists() {
        return Err("path_missing".into());
    }

    // Canonicalize when possible so junctions resolve; fall back to the validated path.
    Ok(fs::canonicalize(&path).unwrap_or(path))
}

/// Same, narrowed to directories — listing and `cd` need a real folder.
pub fn validate_list_dir(raw: &str) -> Result<PathBuf, String> {
    let path = validate_existing_path(raw)?;
    let meta = fs::metadata(&path).map_err(|e| format!("metadata:{e}"))?;
    if !meta.is_dir() {
        return Err("path_not_dir".into());
    }
    Ok(path)
}

/// Strip Windows `\\?\` extended prefix for shell-friendly paths.
pub fn display_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(s.as_ref()).to_string()
}

#[cfg(test)]
mod tests {
    use super::{list_children, search_folder, validate_existing_path, validate_list_dir};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("kavibay_file_search_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_parent_and_relative() {
        assert_eq!(validate_list_dir("foo").unwrap_err(), "path_not_absolute");
        assert_eq!(
            validate_list_dir("C:\\foo\\..\\bar").unwrap_err(),
            "path_parent"
        );
        assert_eq!(validate_list_dir("").unwrap_err(), "path_empty");
        // Revealing takes files too, but the same fail-closed rules apply.
        assert_eq!(
            validate_existing_path("C:\\foo\\..\\bar").unwrap_err(),
            "path_parent"
        );
        assert_eq!(
            validate_existing_path("foo").unwrap_err(),
            "path_not_absolute"
        );
    }

    #[cfg(windows)]
    #[test]
    fn reveal_quotes_the_path_not_the_argument() {
        use super::reveal_raw_arg;
        assert_eq!(
            reveal_raw_arg("C:\\Users\\Alex\\Downloads\\ElsterLohn 2023 (1).pdf"),
            "/select,\"C:\\Users\\Alex\\Downloads\\ElsterLohn 2023 (1).pdf\"",
            "spaces and parentheses survive inside the quotes"
        );
    }

    #[test]
    fn only_reveal_accepts_a_file() {
        let dir = temp_dir();
        let file = dir.join("a.txt");
        fs::write(&file, b"x").unwrap();
        let raw = file.to_string_lossy().to_string();

        assert!(
            validate_existing_path(&raw).is_ok(),
            "a file can be revealed"
        );
        assert_eq!(
            validate_list_dir(&raw).unwrap_err(),
            "path_not_dir",
            "but not listed or opened as a terminal cwd"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_existing_dir() {
        let dir = temp_dir();
        let ok = validate_list_dir(dir.to_str().unwrap());
        assert!(ok.is_ok(), "temp dir listable");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_missing() {
        let err = validate_list_dir("C:\\kavibay_file_search_missing_zzz").unwrap_err();
        assert_eq!(err, "path_missing");
    }

    #[test]
    fn lists_dirs_before_files() {
        let dir = temp_dir();
        fs::write(dir.join("alpha.txt"), b"x").unwrap();
        fs::create_dir_all(dir.join("zeta")).unwrap();
        let entries = list_children(&dir, "", 10).unwrap();
        assert_eq!(entries[0].name, "zeta", "directories sort first");
        assert_eq!(entries[1].name, "alpha.txt");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_finds_nested_matches() {
        let dir = temp_dir();
        fs::create_dir_all(dir.join("nested")).unwrap();
        fs::write(dir.join("nested").join("invoice-2026.pdf"), b"x").unwrap();
        fs::write(dir.join("unrelated.txt"), b"x").unwrap();

        let hits = search_folder(
            dir.to_string_lossy().to_string(),
            "invoice".into(),
            Some(10),
        )
        .unwrap();
        assert!(
            hits.iter().any(|h| h.name == "invoice-2026.pdf"),
            "nested match found, got {hits:?}"
        );
        assert!(
            !hits.iter().any(|h| h.name == "unrelated.txt"),
            "non-matching file excluded"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ranks_prefix_then_shallow() {
        let dir = temp_dir();
        fs::create_dir_all(dir.join("a").join("b")).unwrap();
        fs::write(dir.join("a").join("b").join("my-report.txt"), b"x").unwrap();
        fs::write(dir.join("a").join("report-mid.txt"), b"x").unwrap();
        fs::write(dir.join("report-top.txt"), b"x").unwrap();

        let hits =
            search_folder(dir.to_string_lossy().to_string(), "report".into(), Some(10)).unwrap();
        let names: Vec<&str> = hits.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["report-top.txt", "report-mid.txt", "my-report.txt"],
            "prefix hits first, shallow before deep"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn entries_carry_sort_keys() {
        let dir = temp_dir();
        fs::write(dir.join("a.txt"), b"hello").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();

        let entries = list_children(&dir, "", 10).unwrap();
        let file = entries.iter().find(|e| e.name == "a.txt").unwrap();
        assert_eq!(file.size, 5, "file size in bytes");
        assert!(file.modified_ms.unwrap_or(0) > 0, "modified time is set");

        let sub = entries.iter().find(|e| e.name == "sub").unwrap();
        assert_eq!(sub.size, 0, "directories report no size");

        // Search hits arrive from the index without keys; they get hydrated.
        let hits = search_folder(dir.to_string_lossy().to_string(), "a".into(), Some(10)).unwrap();
        let hit = hits.iter().find(|e| e.name == "a.txt").unwrap();
        assert_eq!(hit.size, 5, "search hits carry sort keys too");
        assert!(hit.modified_ms.unwrap_or(0) > 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_query_lists_children() {
        let dir = temp_dir();
        fs::write(dir.join("a.txt"), b"x").unwrap();
        let hits = search_folder(dir.to_string_lossy().to_string(), "  ".into(), Some(10)).unwrap();
        assert_eq!(hits.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
