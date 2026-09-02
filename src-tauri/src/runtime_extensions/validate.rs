//! Path join that stays under a package root (fail-closed).

use std::fs;
use std::path::{Path, PathBuf};

/// Join `rel` under `root` after rejecting traversal / absolute / empty segments,
/// then canonicalize and ensure the result stays under the package root.
///
/// Mirrors FE `assertSafePackageRelativePath` for the relative-path rules, then
/// additionally resolves symlinks/junctions via `fs::canonicalize` so a package
/// cannot escape its root through a link.
///
/// # Windows junctions
/// `fs::canonicalize` resolves directory junctions the same way as symlinks.
/// Creating symlinks in tests often needs Developer Mode or elevation; junctions
/// created with `mklink /J` usually work without elevation. Escape rejection is
/// covered by symlink tests where the platform allows creating them.
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("path_empty".into());
    }

    let normalized = rel.replace('\\', "/");

    if normalized.starts_with('/') {
        return Err("path_absolute".into());
    }
    // Windows drive prefix (e.g. `C:…`).
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err("path_absolute".into());
    }

    for seg in normalized.split('/') {
        if seg.is_empty() {
            return Err("path_empty_segment".into());
        }
        if seg == ".." {
            return Err("path_traversal".into());
        }
    }

    let root_canon = fs::canonicalize(root).map_err(|e| format!("root_canonicalize:{e}"))?;
    let candidate = root_canon.join(&normalized);

    // Resolve symlinks/junctions: full path if it exists, otherwise the longest
    // existing ancestor plus the remaining suffix (suffix has no `..` by checks above).
    let resolved = resolve_for_containment(&candidate)?;
    if !is_under_root(&root_canon, &resolved) {
        return Err("path_escape".into());
    }

    Ok(candidate)
}

/// Canonicalize `path` when it exists; otherwise canonicalize the deepest existing
/// ancestor and re-join the non-existent suffix.
fn resolve_for_containment(path: &Path) -> Result<PathBuf, String> {
    match fs::canonicalize(path) {
        Ok(canon) => Ok(canon),
        Err(_) => {
            let mut ancestor = path.to_path_buf();
            while !ancestor.exists() {
                if !ancestor.pop() {
                    return Err("path_canonicalize".into());
                }
            }
            let ancestor_canon =
                fs::canonicalize(&ancestor).map_err(|e| format!("path_canonicalize:{e}"))?;
            let suffix = path
                .strip_prefix(&ancestor)
                .map_err(|_| "path_canonicalize".to_string())?;
            Ok(ancestor_canon.join(suffix))
        }
    }
}

/// True if `candidate` is `root` or a path strictly under `root` (component-safe).
fn is_under_root(root: &Path, candidate: &Path) -> bool {
    if candidate == root {
        return true;
    }
    candidate.strip_prefix(root).is_ok()
}

#[cfg(test)]
mod tests {
    use super::safe_join;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Create a unique temporary package root directory.
    fn temp_pkg_root() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "kavibay_safe_join_{}_{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn safe_join_rejects_parent_segment() {
        let root = temp_pkg_root();
        assert!(safe_join(&root, "../evil").is_err());
        assert!(safe_join(&root, "ui/../../evil").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn safe_join_accepts_nested_ui() {
        let root = temp_pkg_root();
        fs::create_dir_all(root.join("ui")).unwrap();
        fs::write(root.join("ui/index.html"), b"<html></html>").unwrap();
        let p = safe_join(&root, "ui/index.html").unwrap();
        assert!(p.ends_with("ui/index.html") || p.ends_with(r"ui\index.html"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn safe_join_normalizes_backslashes() {
        let root = temp_pkg_root();
        fs::create_dir_all(root.join("ui")).unwrap();
        fs::write(root.join("ui").join("main.js"), b"ok").unwrap();
        let p = safe_join(&root, r"ui\main.js").unwrap();
        assert!(p.ends_with("main.js"));
        // Result must stay under the canonical package root.
        let root_canon = fs::canonicalize(&root).unwrap();
        let p_canon = fs::canonicalize(&p).unwrap();
        assert!(p_canon.starts_with(&root_canon));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn safe_join_rejects_absolute_and_empty_segments() {
        let root = temp_pkg_root();
        assert_eq!(safe_join(&root, "").unwrap_err(), "path_empty");
        assert_eq!(
            safe_join(&root, "/etc/passwd").unwrap_err(),
            "path_absolute"
        );
        assert_eq!(safe_join(&root, "ui//x").unwrap_err(), "path_empty_segment");
        assert_eq!(safe_join(&root, "C:/Windows").unwrap_err(), "path_absolute");
        let _ = fs::remove_dir_all(&root);
    }

    /// Symlink escape: relative path looks in-package, but link target is outside.
    /// Unix always supports symlink creation for the current user.
    #[cfg(unix)]
    #[test]
    fn safe_join_rejects_symlink_escape() {
        let root = temp_pkg_root();
        let outside = temp_pkg_root();
        fs::write(outside.join("secret.txt"), b"secret").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();

        let err = safe_join(&root, "escape/secret.txt").unwrap_err();
        assert_eq!(err, "path_escape");

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    /// Windows junction escape (same containment check as symlink).
    /// `mklink /J` typically works without elevation; skip if creation fails.
    #[cfg(windows)]
    #[test]
    fn safe_join_rejects_junction_escape() {
        let root = temp_pkg_root();
        let outside = temp_pkg_root();
        fs::write(outside.join("secret.txt"), b"secret").unwrap();
        let link = root.join("escape");

        let ok = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &link.to_string_lossy(),
                &outside.to_string_lossy(),
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if !ok {
            // Junction creation can fail in locked-down CI; normalization tests still cover path rules.
            eprintln!(
                "skip safe_join_rejects_junction_escape: could not create junction (mklink /J)"
            );
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            return;
        }

        let err = safe_join(&root, "escape/secret.txt").unwrap_err();
        assert_eq!(err, "path_escape");

        // Remove junction link before deleting roots.
        let _ = fs::remove_dir(&link);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }
}
