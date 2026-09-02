//! Portable fallback search: a bounded breadth-first walk of a folder tree.
//!
//! This is not an index and deliberately never becomes one — it is what runs
//! when the platform's own search is unavailable (indexer off, non-Windows).
//! Three budgets keep it honest on a folder like Downloads: depth, number of
//! visited entries, and wall clock. Hitting a budget returns what was found so
//! far, because a partial list within a keystroke beats a complete one later.

use super::{matches_tokens, query_tokens, FileEntry};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAX_DEPTH: usize = 4;
const MAX_VISITED: usize = 20_000;
const TIME_BUDGET: Duration = Duration::from_millis(350);

/// Recursively find entries under `dir` whose name matches every query token.
/// Hits come back unranked — `super::rank_entries` owns the order.
pub fn search(dir: &Path, query: &str, limit: usize) -> Result<Vec<FileEntry>, String> {
    let tokens = query_tokens(query);
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    // Collect past the limit so ranking still has the good hits to choose from.
    let collect_cap = limit.saturating_mul(4).max(limit);

    let started = Instant::now();
    let mut visited = 0usize;
    let mut hits: Vec<FileEntry> = Vec::new();
    let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
    queue.push_back((dir.to_path_buf(), 0));

    while let Some((current, depth)) = queue.pop_front() {
        if started.elapsed() > TIME_BUDGET || visited >= MAX_VISITED || hits.len() >= collect_cap {
            break;
        }
        let read = match fs::read_dir(&current) {
            Ok(read) => read,
            // Unreadable subtree (permissions, vanished) — skip, don't fail the search.
            Err(_) => continue,
        };
        for entry in read {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            visited += 1;
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            let is_dir = file_type.is_dir();
            if !is_dir && !file_type.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if matches_tokens(&name, &tokens) {
                let (modified_ms, size) = match entry.metadata() {
                    Ok(meta) => super::sort_keys(&meta),
                    Err(_) => (None, 0),
                };
                hits.push(FileEntry {
                    name,
                    path: super::display_path(&entry.path()),
                    is_dir,
                    modified_ms,
                    size,
                });
            }
            if is_dir && depth < MAX_DEPTH {
                queue.push_back((entry.path(), depth + 1));
            }
        }
    }

    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::search;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("kavibay_walk_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_nested_matches_only() {
        let dir = temp_dir();
        fs::create_dir_all(dir.join("a").join("b")).unwrap();
        fs::write(dir.join("a").join("b").join("my-report.txt"), b"x").unwrap();
        fs::write(dir.join("report-top.txt"), b"x").unwrap();
        fs::write(dir.join("other.txt"), b"x").unwrap();

        let hits = search(&dir, "report", 10).unwrap();
        let names: Vec<&str> = hits.iter().map(|h| h.name.as_str()).collect();
        assert!(names.contains(&"report-top.txt"));
        assert!(
            names.contains(&"my-report.txt"),
            "nested substring hit found"
        );
        assert!(!names.contains(&"other.txt"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn all_tokens_must_match() {
        let dir = temp_dir();
        fs::write(dir.join("invoice-list.json"), b"x").unwrap();
        fs::write(dir.join("invoice.pdf"), b"x").unwrap();

        let hits = search(&dir, "invoice list", 10).unwrap();
        let names: Vec<&str> = hits.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(names, vec!["invoice-list.json"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_query_returns_nothing() {
        let dir = temp_dir();
        fs::write(dir.join("a.txt"), b"x").unwrap();
        assert!(search(&dir, "   ", 10).unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn respects_depth_budget() {
        let dir = temp_dir();
        let deep = dir.join("1").join("2").join("3").join("4").join("5");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("needle.txt"), b"x").unwrap();
        let hits = search(&dir, "needle", 10).unwrap();
        assert!(hits.is_empty(), "past MAX_DEPTH stays unvisited");
        let _ = fs::remove_dir_all(&dir);
    }
}
