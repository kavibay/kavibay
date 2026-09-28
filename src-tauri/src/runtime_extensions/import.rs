//! Import of a widget archive: the zip `export` writes, brought back in.
//!
//! Two steps, because the person approves before anything is installed.
//! `inspect` unpacks the archive into a staging folder and scans it exactly as
//! an installed package is scanned; the install dialog is built from that row.
//! `install` then moves that very folder into the custom root. Reading the
//! archive again at install time could hand over other bytes than the ones the
//! dialog described, and those are the bytes a grant is about.
//!
//! The archive is untrusted input. Every limit a draft is held to is enforced
//! on what the archive actually inflates to, never on what its headers claim.

use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use flate2::read::DeflateDecoder;
use serde::Serialize;
use tauri::AppHandle;

use super::drafts::{self, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES};
use super::validate::safe_join;
use super::{root_path, scan_package_dir, PackageOrigin, ScannedRuntimeExtension};

/// Staged imports, beside `.drafts` in the custom root. The dot keeps the scan
/// and the id resolver from ever reading a staged package as an installed one.
const IMPORTS_DIR: &str = ".imports";

/// Headers and stored entries make an archive a little larger than its files.
const MAX_ARCHIVE_BYTES: u64 = MAX_TOTAL_BYTES as u64 + 256 * 1024;

/// Directory records and `__MACOSX` copies count here but are never unpacked,
/// so this is looser than `MAX_FILES` while still bounding the walk.
const MAX_ENTRIES: usize = 256;

const END_OF_DIRECTORY: u32 = 0x0605_4b50;
const DIRECTORY_HEADER: u32 = 0x0201_4b50;
const LOCAL_HEADER: u32 = 0x0403_4b50;
const FLAG_ENCRYPTED: u16 = 0x0001;

static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);

type PackageFiles = Vec<(String, Vec<u8>)>;

/// What the install dialog shows, and the handle that installs exactly it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub token: String,
    /// The archive's file name, for the dialog. Never used as a path again.
    pub file_name: String,
    pub package: ScannedRuntimeExtension,
}

/// Unpack and scan an archive without installing it.
///
/// `path` comes from a file the person dropped or picked in the open dialog.
/// It is the webview's word for a path, so it is checked here, where it is read.
#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_import_inspect(
    app: AppHandle,
    path: String,
) -> Result<ImportPreview, String> {
    let (file_name, archive) = read_archive_file(&path)?;
    let files = normalize(unzip(&archive)?)?;
    let id = package_id(&files)?;
    if is_taken(&app, &id) {
        return Err(format!("id_taken:{id}"));
    }

    let imports = imports_root(&app)?;
    // One import at a time: a new drop replaces whatever an earlier dialog
    // left staged, which is also what cleans up after a crash.
    let _ = fs::remove_dir_all(&imports);
    fs::create_dir_all(&imports).map_err(|error| error.to_string())?;

    let token = next_token();
    let package = stage(&imports, &token, &id, &files)
        .map(|dir| scan_package_dir(&id, &dir, PackageOrigin::Custom));
    match package {
        Ok(package) if package.error.is_none() => Ok(ImportPreview {
            token,
            file_name,
            package,
        }),
        Ok(package) => {
            let _ = fs::remove_dir_all(imports.join(&token));
            Err(package.error.unwrap_or_default())
        }
        Err(error) => {
            let _ = fs::remove_dir_all(imports.join(&token));
            Err(error)
        }
    }
}

/// Move a staged package into the custom root. Returns its id.
#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_import_install(app: AppHandle, token: String) -> Result<String, String> {
    let imports = imports_root(&app)?;
    let custom = root_path(&app, PackageOrigin::Custom)?;
    install_staged(&imports, &custom, &token, |id| is_taken(&app, id))
}

/// Forget a staged package the person cancelled.
#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_import_discard(app: AppHandle, token: String) -> Result<(), String> {
    let staged = token_dir(&imports_root(&app)?, &token)?;
    match fs::remove_dir_all(staged) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
}

/// Whether `id` already names a package, saved or in the workspace.
///
/// Refused rather than replaced. Install records are keyed by id, so an archive
/// installed over an existing widget would inherit its grants, its approved
/// accounts and its enabled flag, and none of those were given to this code.
fn is_taken(app: &AppHandle, id: &str) -> bool {
    super::package_root_for(app, id).is_some() || drafts::draft_package_dir(app, id).is_some()
}

fn imports_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = root_path(app, PackageOrigin::Custom)?.join(IMPORTS_DIR);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn next_token() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis())
        .unwrap_or(0);
    format!("{now:x}{:04x}", NEXT_TOKEN.fetch_add(1, Ordering::Relaxed))
}

/// The staging folder a token names. Anything but plain hex names none.
fn token_dir(imports: &Path, token: &str) -> Result<PathBuf, String> {
    if token.is_empty() || token.len() > 40 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("import_not_found".into());
    }
    Ok(imports.join(token))
}

fn read_archive_file(path: &str) -> Result<(String, Vec<u8>), String> {
    let path = Path::new(path.trim());
    if !path.is_absolute() {
        return Err("source_not_absolute".into());
    }
    let is_zip = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"));
    let meta = fs::metadata(path).map_err(|error| format!("read_failed:{error}"))?;
    if !is_zip || !meta.is_file() {
        return Err("not_a_zip".into());
    }
    if meta.len() > MAX_ARCHIVE_BYTES {
        return Err("archive_too_large".into());
    }
    let bytes = fs::read(path).map_err(|error| format!("read_failed:{error}"))?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok((name, bytes))
}

fn corrupt() -> String {
    "archive_corrupt".into()
}

fn u16_at(bytes: &[u8], at: usize) -> Result<usize, String> {
    let b = bytes.get(at..at + 2).ok_or_else(corrupt)?;
    Ok(u16::from_le_bytes([b[0], b[1]]) as usize)
}

fn u32_at(bytes: &[u8], at: usize) -> Result<u32, String> {
    let b = bytes.get(at..at + 4).ok_or_else(corrupt)?;
    Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// The end-of-central-directory record, searched from the back because an
/// archive comment of up to 64 KiB may follow it.
fn find_end_record(archive: &[u8]) -> Option<usize> {
    let last = archive.len().checked_sub(22)?;
    let first = last.saturating_sub(u16::MAX as usize);
    (first..=last)
        .rev()
        .find(|&at| u32_at(archive, at).ok() == Some(END_OF_DIRECTORY))
}

/// Finder's resource-fork copies and folder settings: never part of a package.
fn is_junk(name: &str) -> bool {
    name.starts_with("__MACOSX/") || name.rsplit('/').next() == Some(".DS_Store")
}

/// Every file in the archive, following the central directory the way an
/// unzipper does. Only stored and deflated entries are read; encryption,
/// zip64 and split archives are refused rather than half-understood.
fn unzip(archive: &[u8]) -> Result<PackageFiles, String> {
    let end = find_end_record(archive).ok_or("not_a_zip")?;
    if u16_at(archive, end + 4)? != 0 || u16_at(archive, end + 6)? != 0 {
        return Err("archive_split".into());
    }
    let count = u16_at(archive, end + 10)?;
    let mut cursor = u32_at(archive, end + 16)? as usize;
    if count == 0xFFFF || cursor == 0xFFFF_FFFF {
        return Err("archive_zip64".into());
    }
    if count > MAX_ENTRIES {
        return Err("too_many_files".into());
    }

    let mut files = Vec::new();
    let mut total = 0usize;
    for _ in 0..count {
        if u32_at(archive, cursor)? != DIRECTORY_HEADER {
            return Err(corrupt());
        }
        let flags = u16_at(archive, cursor + 8)? as u16;
        let method = u16_at(archive, cursor + 10)?;
        let crc = u32_at(archive, cursor + 16)?;
        let compressed = u32_at(archive, cursor + 20)? as usize;
        let size = u32_at(archive, cursor + 24)? as usize;
        let name_len = u16_at(archive, cursor + 28)?;
        let extra_len = u16_at(archive, cursor + 30)?;
        let comment_len = u16_at(archive, cursor + 32)?;
        let local = u32_at(archive, cursor + 42)? as usize;
        let name = archive
            .get(cursor + 46..cursor + 46 + name_len)
            .ok_or_else(corrupt)?;
        cursor += 46 + name_len + extra_len + comment_len;

        let name = std::str::from_utf8(name)
            .map_err(|_| "archive_name_not_utf8".to_string())?
            .replace('\\', "/");
        if name.ends_with('/') || is_junk(&name) {
            continue;
        }
        if flags & FLAG_ENCRYPTED != 0 {
            return Err("archive_encrypted".into());
        }
        if files.len() == MAX_FILES {
            return Err("too_many_files".into());
        }
        if size > MAX_FILE_BYTES {
            return Err(format!("file_too_large:{name}"));
        }
        total += size;
        if total > MAX_TOTAL_BYTES {
            return Err("package_too_large".into());
        }

        let contents = read_entry(archive, local, method, compressed, size)?;
        let mut hasher = crc32fast::Hasher::new();
        hasher.update(&contents);
        if hasher.finalize() != crc {
            return Err(corrupt());
        }
        files.push((name, contents));
    }
    Ok(files)
}

/// One entry's bytes. Inflation stops one byte past the declared size, so an
/// entry that claims 10 bytes and inflates to a gigabyte costs 11.
fn read_entry(
    archive: &[u8],
    local: usize,
    method: usize,
    compressed: usize,
    size: usize,
) -> Result<Vec<u8>, String> {
    if u32_at(archive, local)? != LOCAL_HEADER {
        return Err(corrupt());
    }
    let start = local + 30 + u16_at(archive, local + 26)? + u16_at(archive, local + 28)?;
    let data = archive.get(start..start + compressed).ok_or_else(corrupt)?;
    let contents = match method {
        0 => data.to_vec(),
        8 => {
            let mut out = Vec::with_capacity(size);
            DeflateDecoder::new(data)
                .take(size as u64 + 1)
                .read_to_end(&mut out)
                .map_err(|_| corrupt())?;
            out
        }
        _ => return Err("archive_method_unsupported".into()),
    };
    if contents.len() != size {
        return Err(corrupt());
    }
    Ok(contents)
}

/// Package-relative paths, whichever way the archive was made.
///
/// Export puts `manifest.json` at the top. Compressing the folder in Finder or
/// Explorer puts it one folder down, so a single shared top folder is removed.
fn normalize(mut files: PackageFiles) -> Result<PackageFiles, String> {
    if files.is_empty() {
        return Err("no_files".into());
    }
    if !files.iter().any(|(path, _)| path == "manifest.json") {
        if let Some(prefix) = shared_top_folder(&files) {
            for (path, _) in &mut files {
                *path = path[prefix.len()..].to_string();
            }
        }
    }

    let mut seen = BTreeSet::new();
    for (path, _) in &files {
        drafts::validate_relative_path(path).map_err(|error| format!("unsafe_path:{error}"))?;
        // Case-folded, because on a case-insensitive disk the second of
        // `Index.html` and `index.html` would silently overwrite the first.
        if !seen.insert(path.to_ascii_lowercase()) {
            return Err(format!("duplicate_file:{path}"));
        }
    }
    if !files.iter().any(|(path, _)| path == "manifest.json") {
        return Err("missing_manifest".into());
    }
    Ok(files)
}

fn shared_top_folder(files: &PackageFiles) -> Option<String> {
    let (first, _) = files.first()?;
    let (top, _) = first.split_once('/')?;
    if top.is_empty() || top == "." || top == ".." {
        return None;
    }
    let prefix = format!("{top}/");
    files
        .iter()
        .all(|(path, _)| path.starts_with(&prefix) && path.len() > prefix.len())
        .then_some(prefix)
}

fn package_id(files: &PackageFiles) -> Result<String, String> {
    let (_, manifest) = files
        .iter()
        .find(|(path, _)| path == "manifest.json")
        .ok_or("missing_manifest")?;
    let text = std::str::from_utf8(manifest).map_err(|_| "manifest_not_text".to_string())?;
    let id = drafts::manifest_package_id(text).ok_or("missing_id")?;
    if !drafts::is_valid_package_id(&id) {
        return Err("invalid_package_id".into());
    }
    Ok(id)
}

/// Write the files under `imports/<token>/<id>`, the folder name the scan
/// requires the manifest's id to match.
fn stage(imports: &Path, token: &str, id: &str, files: &PackageFiles) -> Result<PathBuf, String> {
    let dir = token_dir(imports, token)?.join(id);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    for (path, contents) in files {
        let target = safe_join(&dir, path).map_err(|error| format!("unsafe_path:{error}"))?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&target, contents).map_err(|error| format!("write_failed:{error}"))?;
    }
    Ok(dir)
}

fn install_staged(
    imports: &Path,
    custom: &Path,
    token: &str,
    taken: impl Fn(&str) -> bool,
) -> Result<String, String> {
    let staged = token_dir(imports, token)?;
    let mut packages = fs::read_dir(&staged)
        .map_err(|_| "import_not_found".to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string));
    let id = match (packages.next(), packages.next()) {
        (Some(id), None) if drafts::is_valid_package_id(&id) => id,
        _ => return Err("import_not_found".into()),
    };
    // Asked again: the dialog may have stood open while the Wizard saved a
    // widget under the same name.
    if taken(&id) {
        return Err(format!("id_taken:{id}"));
    }
    fs::rename(staged.join(&id), custom.join(&id)).map_err(|error| error.to_string())?;
    let _ = fs::remove_dir_all(&staged);
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::super::export::zip_archive;
    use super::*;
    use std::io::Write;

    fn file(path: &str, contents: &str) -> (String, Vec<u8>) {
        (path.into(), contents.as_bytes().to_vec())
    }

    fn manifest(id: &str) -> (String, Vec<u8>) {
        file(
            "manifest.json",
            &format!(r#"{{"id":"{id}","name":"Counter","version":"1.0.0"}}"#),
        )
    }

    /// Offset of the first central directory header, where the tests below
    /// overwrite a field to forge an archive the writer would never produce.
    fn directory_start(archive: &[u8]) -> usize {
        let end = find_end_record(archive).unwrap();
        u32_at(archive, end + 16).unwrap() as usize
    }

    fn put_u16(archive: &mut [u8], at: usize, value: u16) {
        archive[at..at + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put_u32(archive: &mut [u8], at: usize, value: u32) {
        archive[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn temp_root(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kavibay-import-{label}-{}-{}",
            std::process::id(),
            NEXT_TOKEN.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn an_exported_archive_reads_back_whole() {
        let files = vec![
            manifest("counter"),
            file("ui/index.html", &"<p>hello</p>\n".repeat(40)),
            (
                "icon.png".into(),
                vec![0x89, b'P', b'N', b'G', 0, 1, 2, 255],
            ),
        ];
        let archive = zip_archive(&files).unwrap();
        assert_eq!(normalize(unzip(&archive).unwrap()).unwrap(), files);
        assert_eq!(package_id(&files).unwrap(), "counter");
    }

    #[test]
    fn a_folder_compressed_in_finder_loses_its_top_folder_and_junk() {
        let (_, manifest_bytes) = manifest("counter");
        let archive = zip_archive(&[
            file("counter/", ""),
            ("counter/manifest.json".into(), manifest_bytes),
            file("counter/index.html", "<p>hi</p>"),
            file("counter/.DS_Store", "junk"),
            file("__MACOSX/counter/._index.html", "junk"),
        ])
        .unwrap();
        let files = normalize(unzip(&archive).unwrap()).unwrap();
        let paths: Vec<&str> = files.iter().map(|(path, _)| path.as_str()).collect();
        assert_eq!(paths, vec!["manifest.json", "index.html"]);
    }

    /// Archives from the tools people actually use, not from our own writer.
    /// Finder's Compress (made with `ditto -c -k --keepParent`) writes data
    /// descriptors and a top folder; Info-ZIP writes 24-byte extra fields.
    #[test]
    fn archives_from_finder_and_info_zip_read_back() {
        let finder =
            normalize(unzip(include_bytes!("import_fixtures/finder-compress.zip")).unwrap())
                .unwrap();
        let paths: Vec<&str> = finder.iter().map(|(path, _)| path.as_str()).collect();
        assert_eq!(
            paths,
            vec!["ui/index.html", "ui/main.js", "icon.svg", "manifest.json"]
        );
        assert_eq!(package_id(&finder).unwrap(), "runtime-extension-s");

        let info_zip =
            normalize(unzip(include_bytes!("import_fixtures/info-zip.zip")).unwrap()).unwrap();
        let paths: Vec<&str> = info_zip.iter().map(|(path, _)| path.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                "ui/kavibay-runtime.js",
                "ui/index.html",
                "api.json",
                "manifest.json"
            ]
        );
        assert_eq!(package_id(&info_zip).unwrap(), "http-probe");
        let (_, api) = info_zip
            .iter()
            .find(|(path, _)| path == "api.json")
            .unwrap();
        assert_eq!(api.len(), 817);
    }

    #[test]
    fn paths_that_leave_the_package_are_refused() {
        for (path, error) in [
            ("../evil.js", "unsafe_path:path_traversal"),
            ("/etc/evil.js", "unsafe_path:path_absolute"),
            ("C:/evil.js", "unsafe_path:path_absolute"),
            ("ui//index.html", "unsafe_path:path_empty_segment"),
        ] {
            let archive = zip_archive(&[manifest("counter"), file(path, "x")]).unwrap();
            assert_eq!(
                normalize(unzip(&archive).unwrap()).unwrap_err(),
                error,
                "{path}"
            );
        }
    }

    #[test]
    fn names_differing_only_in_case_are_one_file_too_many() {
        let archive = zip_archive(&[
            manifest("counter"),
            file("index.html", "a"),
            file("Index.html", "b"),
        ])
        .unwrap();
        assert_eq!(
            normalize(unzip(&archive).unwrap()).unwrap_err(),
            "duplicate_file:Index.html"
        );
    }

    #[test]
    fn an_entry_inflating_past_its_declared_size_is_refused() {
        let mut encoder =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&vec![0u8; 4 * 1024 * 1024]).unwrap();
        let bomb = encoder.finish().unwrap();
        assert!(bomb.len() < 64 * 1024);

        // A stored entry of the bomb's own bytes, then relabelled as deflate
        // with a declared size of 10: exactly what a zip bomb sends.
        let mut archive = zip_archive(&[("a.bin".into(), bomb.clone())]).unwrap();
        let at = directory_start(&archive);
        put_u16(&mut archive, at + 10, 8);
        put_u32(&mut archive, at + 24, 10);
        assert_eq!(unzip(&archive).unwrap_err(), "archive_corrupt");
    }

    #[test]
    fn declared_sizes_over_the_limits_are_refused_before_inflating() {
        let mut archive = zip_archive(&[file("a.txt", "x")]).unwrap();
        let at = directory_start(&archive);
        put_u32(&mut archive, at + 24, (MAX_FILE_BYTES + 1) as u32);
        assert_eq!(unzip(&archive).unwrap_err(), "file_too_large:a.txt");

        let big = "x".repeat(MAX_FILE_BYTES);
        let files: Vec<_> = (0..5).map(|i| file(&format!("f{i}.txt"), &big)).collect();
        let archive = zip_archive(&files).unwrap();
        assert_eq!(unzip(&archive).unwrap_err(), "package_too_large");
    }

    #[test]
    fn more_files_than_a_package_may_hold_are_refused() {
        let files: Vec<_> = (0..=MAX_FILES)
            .map(|i| file(&format!("f{i}.txt"), "x"))
            .collect();
        let archive = zip_archive(&files).unwrap();
        assert_eq!(unzip(&archive).unwrap_err(), "too_many_files");
    }

    #[test]
    fn encryption_and_other_methods_are_refused() {
        let archive = zip_archive(&[file("a.txt", "x")]).unwrap();
        let at = directory_start(&archive);

        let mut encrypted = archive.clone();
        put_u16(&mut encrypted, at + 8, 0x0801);
        assert_eq!(unzip(&encrypted).unwrap_err(), "archive_encrypted");

        let mut bzip2 = archive.clone();
        put_u16(&mut bzip2, at + 10, 12);
        assert_eq!(unzip(&bzip2).unwrap_err(), "archive_method_unsupported");
    }

    #[test]
    fn a_damaged_entry_fails_its_checksum() {
        let mut archive = zip_archive(&[file("a.txt", "hello")]).unwrap();
        // The stored bytes follow the 30-byte local header and the 5-byte name.
        archive[35] ^= 0xFF;
        assert_eq!(unzip(&archive).unwrap_err(), "archive_corrupt");
    }

    #[test]
    fn what_is_not_a_zip_says_so() {
        assert_eq!(unzip(b"PK").unwrap_err(), "not_a_zip");
        assert_eq!(unzip(&[0u8; 100]).unwrap_err(), "not_a_zip");
        let mut archive = zip_archive(&[file("a.txt", "x")]).unwrap();
        let end = find_end_record(&archive).unwrap();
        put_u32(&mut archive, end + 16, 3);
        assert_eq!(unzip(&archive).unwrap_err(), "archive_corrupt");
    }

    #[test]
    fn a_package_needs_a_manifest_with_a_usable_id() {
        let archive = zip_archive(&[file("index.html", "x")]).unwrap();
        assert_eq!(
            normalize(unzip(&archive).unwrap()).unwrap_err(),
            "missing_manifest"
        );
        assert_eq!(
            package_id(&vec![file("manifest.json", r#"{"name":"x"}"#)]).unwrap_err(),
            "missing_id"
        );
        assert_eq!(
            package_id(&vec![file("manifest.json", r#"{"id":"../x"}"#)]).unwrap_err(),
            "invalid_package_id"
        );
        // A contract package names itself in `name`, not `id`.
        assert_eq!(
            package_id(&vec![file(
                "manifest.json",
                r#"{"name":"tiles","widget":{}}"#
            )])
            .unwrap(),
            "tiles"
        );
    }

    #[test]
    fn a_staged_package_installs_as_it_was_staged() {
        let root = temp_root("install");
        let imports = root.join(IMPORTS_DIR);
        let custom = root.join("custom");
        fs::create_dir_all(&custom).unwrap();
        let files = vec![manifest("counter"), file("ui/index.html", "<p>hi</p>")];

        stage(&imports, "abc1", "counter", &files).unwrap();
        assert_eq!(
            install_staged(&imports, &custom, "abc1", |_| false).unwrap(),
            "counter"
        );
        assert_eq!(
            fs::read_to_string(custom.join("counter/ui/index.html")).unwrap(),
            "<p>hi</p>"
        );
        assert!(!imports.join("abc1").exists(), "the staging folder is gone");
        assert_eq!(
            install_staged(&imports, &custom, "abc1", |_| false).unwrap_err(),
            "import_not_found",
            "a token installs once"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_id_taken_meanwhile_is_not_overwritten() {
        let root = temp_root("taken");
        let imports = root.join(IMPORTS_DIR);
        let custom = root.join("custom");
        fs::create_dir_all(&custom).unwrap();
        stage(&imports, "abc2", "counter", &vec![manifest("counter")]).unwrap();

        assert_eq!(
            install_staged(&imports, &custom, "abc2", |id| id == "counter").unwrap_err(),
            "id_taken:counter"
        );
        assert!(!custom.join("counter").exists());
        assert!(imports.join("abc2/counter/manifest.json").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_token_names_only_a_folder_under_imports() {
        let imports = Path::new("/tmp/imports");
        for token in ["", "../x", "abc/def", "ABCG", &"a".repeat(41)] {
            assert_eq!(
                token_dir(imports, token).unwrap_err(),
                "import_not_found",
                "{token}"
            );
        }
        assert_eq!(token_dir(imports, "abc12").unwrap(), imports.join("abc12"));
    }
}
