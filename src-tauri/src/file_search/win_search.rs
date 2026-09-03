//! Windows backend: ask the OS for matches instead of keeping our own index.
//!
//! `Windows.Storage.Search` is the same machinery Explorer's search box uses.
//! With `IndexerOption::UseIndexerWhenAvailable` an indexed location — the user
//! folders this feature is offered on are indexed by default — answers from the
//! Search index in well under a keystroke; anything else transparently falls
//! back to a deep file scan.
//!
//! Two hard-won details, both measured against a real ~200k-entry Downloads:
//!
//! - The filter must be `System.FileName:<token>*`. A bare term also matches
//!   file *contents*, and the AQS "contains" operators (`~`, `~<`) cannot use
//!   the index at all — those queries never returned. Prefix-per-token still
//!   matches inside a name, because the indexer tokenizes on separators
//!   (`node*` finds `acorn-node`).
//! - Files and folders need separate queries: a file query cannot return
//!   directories, and descending into a subfolder is half the point here.

use super::{query_tokens, FileEntry};
use std::path::Path;
use windows::core::HSTRING;
use windows::Storage::Search::{CommonFolderQuery, FolderDepth, IndexerOption, QueryOptions};
use windows::Storage::StorageFolder;

/// Recursively find files and folders under `dir` matching `query`.
/// Returns unranked hits; `super::rank_entries` puts them in palette order.
pub fn search(dir: &Path, query: &str, limit: usize) -> Result<Vec<FileEntry>, String> {
    let filter = aqs_filter(query);
    if filter.is_empty() {
        return Ok(Vec::new());
    }
    let folder = open_folder(dir)?;
    let count = limit as u32;

    // Folders get their own budget — one shared limit would let a few hundred
    // matching files bury the subfolder the user is heading for.
    let mut out = search_folders(&folder, &filter, count.min(12)).unwrap_or_default();
    out.extend(search_files(&folder, &filter, count)?);
    Ok(out)
}

/// Build the AQS filter: every token must prefix-match a word of the file name.
/// Returns "" when nothing usable survives sanitizing (caller then falls back).
fn aqs_filter(query: &str) -> String {
    query_tokens(query)
        .iter()
        // Keep letters/digits only: AQS reads `:`, `"`, `~`, `(`, `-` as syntax,
        // and a half-parsed filter is what produced the queries that never returned.
        .map(|token| {
            token
                .chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
        })
        .filter(|token| !token.is_empty())
        .map(|token| format!("System.FileName:{token}*"))
        .collect::<Vec<_>>()
        .join(" AND ")
}

/// Resolve an absolute path into a `StorageFolder` (blocking on the WinRT async).
fn open_folder(dir: &Path) -> Result<StorageFolder, String> {
    let path = HSTRING::from(dir.as_os_str());
    StorageFolder::GetFolderFromPathAsync(&path)
        .map_err(|e| format!("open_folder:{e}"))?
        .join()
        .map_err(|e| format!("open_folder_await:{e}"))
}

/// Whole subtree, index when the location has one, our filter on top.
fn apply_options(options: &QueryOptions, filter: &str) -> Result<(), String> {
    options
        .SetFolderDepth(FolderDepth::Deep)
        .map_err(|e| format!("folder_depth:{e}"))?;
    options
        .SetIndexerOption(IndexerOption::UseIndexerWhenAvailable)
        .map_err(|e| format!("indexer_option:{e}"))?;
    options
        .SetUserSearchFilter(&HSTRING::from(filter))
        .map_err(|e| format!("search_filter:{e}"))?;
    Ok(())
}

fn search_files(
    folder: &StorageFolder,
    filter: &str,
    limit: u32,
) -> Result<Vec<FileEntry>, String> {
    // Default options carry an empty file-type filter, i.e. every file type.
    let options = QueryOptions::new().map_err(|e| format!("query_options:{e}"))?;
    apply_options(&options, filter)?;

    let result = folder
        .CreateFileQueryWithOptions(&options)
        .map_err(|e| format!("file_query:{e}"))?;
    let files = result
        .GetFilesAsync(0, limit)
        .map_err(|e| format!("get_files:{e}"))?
        .join()
        .map_err(|e| format!("get_files_await:{e}"))?;

    let mut out = Vec::new();
    for file in files {
        let name = file
            .Name()
            .map_err(|e| format!("file_name:{e}"))?
            .to_string();
        let path = file
            .Path()
            .map_err(|e| format!("file_path:{e}"))?
            .to_string();
        if path.is_empty() {
            continue;
        }
        // Sort keys are filled centrally afterwards: the index answers with
        // names and paths, and a WinRT property fetch per hit would cost more
        // than one local stat.
        out.push(FileEntry {
            name,
            path,
            is_dir: false,
            modified_ms: None,
            size: 0,
        });
    }
    Ok(out)
}

fn search_folders(
    folder: &StorageFolder,
    filter: &str,
    limit: u32,
) -> Result<Vec<FileEntry>, String> {
    let options = QueryOptions::CreateCommonFolderQuery(CommonFolderQuery::DefaultQuery)
        .map_err(|e| format!("folder_query_options:{e}"))?;
    apply_options(&options, filter)?;

    let result = folder
        .CreateFolderQueryWithOptions(&options)
        .map_err(|e| format!("folder_query:{e}"))?;
    let folders = result
        .GetFoldersAsync(0, limit)
        .map_err(|e| format!("get_folders:{e}"))?
        .join()
        .map_err(|e| format!("get_folders_await:{e}"))?;

    let mut out = Vec::new();
    for sub in folders {
        let name = sub
            .Name()
            .map_err(|e| format!("folder_name:{e}"))?
            .to_string();
        let path = sub
            .Path()
            .map_err(|e| format!("folder_path:{e}"))?
            .to_string();
        if path.is_empty() {
            continue;
        }
        // A shell "folder" is not always a directory — namespace extensions make
        // archives and similar containers browsable. `is_dir` is what the palette
        // offers Tab on, so it has to mean the filesystem, not the shell.
        if !Path::new(&path).is_dir() {
            continue;
        }
        out.push(FileEntry {
            name,
            path,
            is_dir: true,
            modified_ms: None,
            size: 0,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{aqs_filter, search};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("kavibay_win_search_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn builds_prefix_filter_per_token() {
        assert_eq!(aqs_filter("invoice"), "System.FileName:invoice*");
        assert_eq!(
            aqs_filter("invoice list"),
            "System.FileName:invoice* AND System.FileName:list*"
        );
    }

    #[test]
    fn strips_aqs_syntax_from_tokens() {
        // Operators must not survive into the filter — see the module note.
        assert_eq!(aqs_filter("~report:\"x\""), "System.FileName:reportx*");
        assert_eq!(aqs_filter("***"), "");
    }

    /// Temp dirs are not indexed, so this also covers the deep-scan path.
    #[test]
    fn finds_nested_file_and_folder() {
        let dir = temp_dir();
        fs::create_dir_all(dir.join("reports-2026")).unwrap();
        fs::write(dir.join("reports-2026").join("report-q1.txt"), b"x").unwrap();
        fs::write(dir.join("unrelated.txt"), b"x").unwrap();

        let hits = search(&dir, "report", 20).unwrap();
        let names: Vec<&str> = hits.iter().map(|h| h.name.as_str()).collect();
        assert!(
            names.contains(&"report-q1.txt"),
            "nested file, got {names:?}"
        );
        assert!(names.contains(&"reports-2026"), "subfolder, got {names:?}");
        assert!(!names.contains(&"unrelated.txt"));
        let _ = fs::remove_dir_all(&dir);
    }
}
