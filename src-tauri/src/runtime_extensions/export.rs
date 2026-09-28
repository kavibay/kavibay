//! Zip export of a widget package.
//!
//! The Wizard can build a widget but had no way to get one *out* of the app —
//! the files live under `%APPDATA%` in a folder nobody is expected to know
//! about. Export writes the same tree the runtime loads into a single archive:
//! what comes out can be dropped back into an extensions root as a folder,
//! which is what makes it worth handing to somebody else.
//!
//! The archive is assembled here rather than by pulling in a zip crate. What is
//! needed is one deflate stream per file plus two headers, and both halves are
//! already in the tree via `reqwest` (`flate2`, `crc32fast`) — a zip dependency
//! would add encryption, zip64 and archive *reading*, none of which this uses.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use flate2::write::DeflateEncoder;
use flate2::Compression;
use serde::Serialize;
use tauri::AppHandle;

use super::drafts::{read_current_package_bytes, PackageSnapshot};

/// What the caller gets back, so the Wizard can say what it wrote.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    /// Where the archive ended up — the requested path, `.zip` guaranteed.
    pub path: String,
    pub files: usize,
    pub bytes: usize,
    /// Whether the archive holds the saved widget or its unsaved draft.
    ///
    /// Reported rather than chosen by the caller: only this layer knows whether
    /// a draft exists, and a message saying "exported the widget" over a
    /// draft's contents is worse than no message at all.
    pub source: PackageSnapshot,
}

/// Write the current files of `id` to `target` as a zip archive.
///
/// `target` comes from the host's native save dialog, never from widget code —
/// a sandboxed widget reaches this through the Wizard capability, which owns
/// the dialog. It is still checked here: this command is what the webview can
/// call, so the webview's word for "a path to write to" is checked where it is
/// acted on.
#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_export_package(
    app: AppHandle,
    id: String,
    target: String,
) -> Result<ExportReport, String> {
    let (files, source) = read_current_package_bytes(&app, &id)?;
    if files.is_empty() {
        return Err("package_empty".into());
    }
    let path = export_target(&target)?;
    let archive = zip_archive(&files)?;
    fs::write(&path, &archive).map_err(|error| format!("write_failed:{error}"))?;
    Ok(ExportReport {
        path: path.to_string_lossy().into_owned(),
        files: files.len(),
        bytes: archive.len(),
        source,
    })
}

/// Normalize the requested destination, or say why it cannot be written.
fn export_target(target: &str) -> Result<PathBuf, String> {
    let path = Path::new(target.trim());
    if path.as_os_str().is_empty() {
        return Err("target_empty".into());
    }
    if !path.is_absolute() {
        return Err("target_not_absolute".into());
    }
    if path.is_dir() {
        return Err("target_is_directory".into());
    }
    let parent = path.parent().ok_or("target_has_no_folder")?;
    if !parent.is_dir() {
        return Err("target_folder_missing".into());
    }
    // A save dialog appends the filter extension on some platforms and not on
    // others, so the name is made to match the contents here instead of hoping.
    // `with_extension` also replaces a wrong one: a file called `counter.json`
    // holding a zip is a support request.
    Ok(match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("zip") => path.to_path_buf(),
        _ => path.with_extension("zip"),
    })
}

/// One entry, compressed once and then laid out twice.
struct Entry {
    name: String,
    method: u16,
    crc: u32,
    data: Vec<u8>,
    size: u32,
    offset: u32,
}

/// Zip flag bit 11: the file name is UTF-8.
///
/// Without it a name is read in the archiver's code page, which is how a widget
/// holding a `größe.json` arrives as mojibake on somebody else's machine.
const FLAG_UTF8: u16 = 0x0800;

/// A fixed 1980-01-01 00:00, in DOS date/time.
///
/// The alternative is each file's mtime, which would make two exports of an
/// unchanged widget differ byte for byte. Nothing but a file listing reads
/// these, and the real timestamps stay in the folder the archive came from.
const DOS_TIME: u16 = 0;
const DOS_DATE: u16 = 0x0021;

/// Assemble the archive: every local record, then the central directory, then
/// the end-of-central-directory record.
pub(super) fn zip_archive(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let mut out: Vec<u8> = Vec::new();
    let mut entries: Vec<Entry> = Vec::with_capacity(files.len());

    for (path, contents) in files {
        let offset = u32::try_from(out.len()).map_err(|_| "archive_too_large".to_string())?;
        let size = u32::try_from(contents.len()).map_err(|_| "file_too_large".to_string())?;
        // Zip paths are `/`-separated by specification, whatever the host uses.
        let name = path.replace('\\', "/");
        let mut hasher = crc32fast::Hasher::new();
        hasher.update(contents);
        let crc = hasher.finalize();

        let deflated = deflate(contents)?;
        // Text compresses; a 40-byte manifest fragment does not, and deflating
        // it makes the entry bigger. Storing it then is what archivers do.
        let (method, data) = if deflated.len() < contents.len() {
            (8u16, deflated)
        } else {
            (0u16, contents.clone())
        };

        write_local_header(&mut out, &name, method, crc, &data, size)?;
        out.extend_from_slice(&data);
        entries.push(Entry {
            name,
            method,
            crc,
            data,
            size,
            offset,
        });
    }

    let directory_offset = u32::try_from(out.len()).map_err(|_| "archive_too_large".to_string())?;
    for entry in &entries {
        write_directory_header(&mut out, entry)?;
    }
    let directory_end = u32::try_from(out.len()).map_err(|_| "archive_too_large".to_string())?;

    let count = u16::try_from(entries.len()).map_err(|_| "too_many_files".to_string())?;
    put_u32(&mut out, 0x0605_4b50); // end of central directory
    put_u16(&mut out, 0); // this disk
    put_u16(&mut out, 0); // disk the directory starts on
    put_u16(&mut out, count);
    put_u16(&mut out, count);
    put_u32(&mut out, directory_end - directory_offset);
    put_u32(&mut out, directory_offset);
    put_u16(&mut out, 0); // no archive comment
    Ok(out)
}

fn write_local_header(
    out: &mut Vec<u8>,
    name: &str,
    method: u16,
    crc: u32,
    data: &[u8],
    size: u32,
) -> Result<(), String> {
    let name_len = u16::try_from(name.len()).map_err(|_| "path_too_long".to_string())?;
    let compressed = u32::try_from(data.len()).map_err(|_| "file_too_large".to_string())?;
    put_u32(out, 0x0403_4b50); // local file header
    put_u16(out, 20); // version needed: 2.0
    put_u16(out, FLAG_UTF8);
    put_u16(out, method);
    put_u16(out, DOS_TIME);
    put_u16(out, DOS_DATE);
    put_u32(out, crc);
    put_u32(out, compressed);
    put_u32(out, size);
    put_u16(out, name_len);
    put_u16(out, 0); // no extra field
    out.extend_from_slice(name.as_bytes());
    Ok(())
}

fn write_directory_header(out: &mut Vec<u8>, entry: &Entry) -> Result<(), String> {
    let name_len = u16::try_from(entry.name.len()).map_err(|_| "path_too_long".to_string())?;
    let compressed = u32::try_from(entry.data.len()).map_err(|_| "file_too_large".to_string())?;
    put_u32(out, 0x0201_4b50); // central directory header
    put_u16(out, 20); // version made by: 2.0, MS-DOS
    put_u16(out, 20); // version needed: 2.0
    put_u16(out, FLAG_UTF8);
    put_u16(out, entry.method);
    put_u16(out, DOS_TIME);
    put_u16(out, DOS_DATE);
    put_u32(out, entry.crc);
    put_u32(out, compressed);
    put_u32(out, entry.size);
    put_u16(out, name_len);
    put_u16(out, 0); // no extra field
    put_u16(out, 0); // no comment
    put_u16(out, 0); // disk number
    put_u16(out, 0); // internal attributes
    put_u32(out, 0); // external attributes
    put_u32(out, entry.offset);
    out.extend_from_slice(entry.name.as_bytes());
    Ok(())
}

fn deflate(contents: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(contents)
        .map_err(|error| format!("deflate_failed:{error}"))?;
    encoder
        .finish()
        .map_err(|error| format!("deflate_failed:{error}"))
}

fn put_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn put_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn file(path: &str, contents: &str) -> (String, Vec<u8>) {
        (path.into(), contents.as_bytes().to_vec())
    }

    fn u16_at(bytes: &[u8], at: usize) -> usize {
        u16::from_le_bytes([bytes[at], bytes[at + 1]]) as usize
    }

    fn u32_at(bytes: &[u8], at: usize) -> usize {
        u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as usize
    }

    /// Read the archive the way an unzipper does: end record, then central
    /// directory, then each local header at the offset the directory names.
    ///
    /// Deliberately not the writer's own arithmetic. A reader that trusted the
    /// order things were written in would pass an archive no other tool can
    /// open, which is the only failure that matters here.
    fn unzip(archive: &[u8]) -> Vec<(String, Vec<u8>)> {
        let eocd = archive.len() - 22;
        assert_eq!(&archive[eocd..eocd + 4], &[0x50, 0x4b, 0x05, 0x06]);
        let count = u16_at(archive, eocd + 10);
        let mut cursor = u32_at(archive, eocd + 16);

        let mut out = Vec::with_capacity(count);
        for _ in 0..count {
            assert_eq!(&archive[cursor..cursor + 4], &[0x50, 0x4b, 0x01, 0x02]);
            let method = u16_at(archive, cursor + 10);
            let compressed = u32_at(archive, cursor + 20);
            let size = u32_at(archive, cursor + 24);
            let name_len = u16_at(archive, cursor + 28);
            let extra_len = u16_at(archive, cursor + 30);
            let comment_len = u16_at(archive, cursor + 32);
            let local = u32_at(archive, cursor + 42);
            let name =
                String::from_utf8(archive[cursor + 46..cursor + 46 + name_len].to_vec()).unwrap();

            assert_eq!(&archive[local..local + 4], &[0x50, 0x4b, 0x03, 0x04]);
            let local_name_len = u16_at(archive, local + 26);
            let local_extra_len = u16_at(archive, local + 28);
            let start = local + 30 + local_name_len + local_extra_len;
            let raw = &archive[start..start + compressed];

            let contents = if method == 8 {
                let mut decoded = Vec::new();
                flate2::read::DeflateDecoder::new(raw)
                    .read_to_end(&mut decoded)
                    .unwrap();
                decoded
            } else {
                raw.to_vec()
            };
            assert_eq!(contents.len(), size);
            out.push((name, contents));
            cursor += 46 + name_len + extra_len + comment_len;
        }
        out
    }

    #[test]
    fn archive_round_trips_every_file() {
        let files = vec![
            file("manifest.json", "{\"id\":\"counter\"}"),
            // Long enough that deflate actually wins, which exercises method 8.
            file("ui/index.html", &"<p>hello</p>\n".repeat(40)),
            file("assets/notes.txt", "kurz"),
        ];
        let archive = zip_archive(&files).unwrap();
        assert_eq!(&archive[..4], &[0x50, 0x4b, 0x03, 0x04]);
        assert_eq!(unzip(&archive), files);
    }

    /// A file that deflates larger than it started is stored, not inflated.
    #[test]
    fn tiny_files_are_stored() {
        let files = vec![file("a.txt", "x")];
        let archive = zip_archive(&files).unwrap();
        assert_eq!(u16_at(&archive, 8), 0, "compression method");
        assert_eq!(unzip(&archive), files);
    }

    #[test]
    fn windows_separators_become_zip_paths() {
        let archive = zip_archive(&[file(r"ui\index.html", "<p>hi</p>")]).unwrap();
        assert_eq!(unzip(&archive)[0].0, "ui/index.html");
    }

    #[test]
    fn empty_archive_is_still_a_zip() {
        let archive = zip_archive(&[]).unwrap();
        assert_eq!(archive.len(), 22);
        assert!(unzip(&archive).is_empty());
    }

    #[test]
    fn target_must_be_an_absolute_file_path() {
        assert_eq!(export_target("  ").unwrap_err(), "target_empty");
        assert_eq!(
            export_target("counter.zip").unwrap_err(),
            "target_not_absolute"
        );
        let dir = std::env::temp_dir();
        assert_eq!(
            export_target(&dir.to_string_lossy()).unwrap_err(),
            "target_is_directory"
        );
        assert_eq!(
            export_target(&dir.join("nope").join("counter.zip").to_string_lossy()).unwrap_err(),
            "target_folder_missing"
        );
    }

    #[test]
    fn target_is_named_after_what_it_holds() {
        let dir = std::env::temp_dir();
        let kept = dir.join("counter.zip");
        assert_eq!(export_target(&kept.to_string_lossy()).unwrap(), kept);
        assert_eq!(
            export_target(&dir.join("counter.ZIP").to_string_lossy()).unwrap(),
            dir.join("counter.ZIP")
        );
        assert_eq!(
            export_target(&dir.join("counter").to_string_lossy()).unwrap(),
            kept
        );
    }
}
