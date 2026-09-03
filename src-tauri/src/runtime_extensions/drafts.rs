//! Shared draft workspace service for the Widget Wizard and future authoring
//! clients.
//!
//! Draft writes are whole-package transactions. A caller supplies the revision
//! it last read, the service writes a sibling staging directory, and only then
//! publishes that complete tree into `.drafts/<id>`.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime};

use super::validate::safe_join;
use super::{folder_time, root_path, PackageOrigin};

const DRAFTS_DIR: &str = ".drafts";
const MAX_FILES: usize = 32;
const MAX_FILE_BYTES: usize = 512 * 1024;
const MAX_TOTAL_BYTES: usize = 2 * 1024 * 1024;

static NEXT_TRANSIENT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftFile {
    pub path: String,
    pub contents: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    pub id: String,
    pub files: Vec<String>,
    pub revision: String,
    pub error: Option<String>,
    /// The id this draft had before the write, when the manifest renamed it.
    ///
    /// A write that renames answers about a different directory than the one it
    /// was asked about, and a caller that does not notice keeps writing to the
    /// old name — so the change is stated in the reply rather than left to be
    /// discovered by comparing `id` against what was sent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renamed_from: Option<String>,
    /// Who wrote this draft last, and when.
    ///
    /// Both are always serialized, `null` included: a list that shows an author
    /// per row has to distinguish "written by MCP" from "we do not know", and a
    /// field that disappears makes those two the same thing on the client.
    pub last_writer: Option<DraftWriteOrigin>,
    /// The known MCP client that wrote it, when the handshake identified one.
    ///
    /// MCP `clientInfo.name` is advisory and may be omitted or spoofed. The
    /// generic `last_writer: "mcp"` remains the source of truth; this field is
    /// only the extra detail needed for a Codex/Claude mark in the Wizard.
    pub last_client: Option<McpClientKind>,
    /// The exact clientInfo name, when the MCP client supplied one.
    pub last_client_name: Option<String>,
    /// Milliseconds since the epoch, for "2 minutes ago" next to the author.
    pub updated_at: Option<i64>,
}

/// Full text snapshot used by optimistic writers to acquire a revision.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSnapshot {
    pub id: String,
    pub files: Vec<DraftFile>,
    pub revision: String,
    pub error: Option<String>,
    pub last_writer: Option<DraftWriteOrigin>,
    pub last_client: Option<McpClientKind>,
    pub last_client_name: Option<String>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DraftWriteOrigin {
    Wizard,
    Mcp,
}

/// A known MCP client reported during the protocol handshake.
///
/// This is deliberately a small allowlist. `clientInfo.name` is supplied by
/// the client, so arbitrary names must not turn into trusted-looking branded
/// UI. Unknown clients still appear as the generic MCP author.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum McpClientKind {
    Codex,
    Claude,
}

impl McpClientKind {
    pub fn from_name(name: &str) -> Option<Self> {
        let normalized = name.trim().to_ascii_lowercase().replace([' ', '_'], "-");
        match normalized.as_str() {
            "codex" | "codex-cli" | "codex-mcp" | "codex-mcp-client" | "openai-codex"
            | "openai-codex-cli" => Some(Self::Codex),
            "claude"
            | "claude-code"
            | "claude-desktop"
            | "anthropic-claude"
            | "anthropic-claude-code" => Some(Self::Claude),
            _ => None,
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DraftChangeKind {
    Written,
    Discarded,
    Promoted,
}

/// Event payload intentionally contains identity and revision only. File
/// contents stay on the explicit read surface and never enter a broadcast.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftChanged {
    pub id: String,
    pub revision: Option<String>,
    pub kind: DraftChangeKind,
    pub origin: DraftWriteOrigin,
    /// Known client reported by an MCP handshake; `None` is Wizard or unknown MCP.
    pub client: Option<McpClientKind>,
    /// The exact clientInfo name, kept for a transparent UI tooltip.
    pub client_name: Option<String>,
    /// The id this package answered to until this event.
    ///
    /// Set by a write whose manifest renamed the draft, and by a promotion that
    /// replaced the widget's previous installed name. The desk keys its cards
    /// by package id, so a listener that misses this shows a card pointing at a
    /// folder that is gone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renamed_from: Option<String>,
}

fn drafts_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = root_path(app, PackageOrigin::Custom)?.join(DRAFTS_DIR);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

pub fn is_valid_package_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 64 {
        return false;
    }
    if !id
        .chars()
        .next()
        .map(|first| first.is_ascii_alphanumeric())
        .unwrap_or(false)
    {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(crate) fn draft_package_dir<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<PathBuf> {
    if !is_valid_package_id(id) {
        return None;
    }
    let dir = root_path(app, PackageOrigin::Custom)
        .ok()?
        .join(DRAFTS_DIR)
        .join(id);
    dir.is_dir().then_some(dir)
}

fn draft_dir<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<PathBuf, String> {
    if !is_valid_package_id(id) {
        return Err("invalid_package_id".into());
    }
    Ok(drafts_root(app)?.join(id))
}

/// Where the authorship note for one draft lives.
///
/// A dot-prefixed sibling of the draft folder, exactly like the staging and
/// backup transients: `list_drafts` accepts directories whose name is a valid
/// package id, and a leading dot fails that test, so the note can never be
/// mistaken for a draft of its own. Keeping it *outside* the folder is the
/// point — the revision is a hash over the folder, and an authorship note that
/// changed the revision would make every write look like a content conflict.
fn origin_path(root: &Path, id: &str) -> PathBuf {
    root.join(format!(".{id}.origin"))
}

/// Who last wrote a draft, as stored beside it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DraftOriginNote {
    last_writer: DraftWriteOrigin,
    #[serde(default)]
    last_client: Option<McpClientKind>,
    #[serde(default)]
    last_client_name: Option<String>,
    updated_at: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// Record authorship, best effort.
///
/// A failure here is never allowed to fail the write that produced it: the
/// draft is already on disk and correct, and losing the byline is a worse
/// answer than losing the widget. An unreadable or missing note reads back as
/// `None`, which the client renders as an unattributed change.
fn record_origin(
    root: &Path,
    id: &str,
    origin: DraftWriteOrigin,
    client: Option<McpClientKind>,
    client_name: Option<&str>,
) {
    let note = DraftOriginNote {
        last_writer: origin,
        last_client: client,
        last_client_name: client_name.and_then(sanitize_client_name),
        updated_at: now_ms(),
    };
    if let Ok(text) = serde_json::to_string(&note) {
        let _ = fs::write(origin_path(root, id), text);
    }
}

fn read_origin(root: &Path, id: &str) -> Option<DraftOriginNote> {
    let text = fs::read_to_string(origin_path(root, id)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Keep clientInfo useful in a tooltip without allowing control characters or
/// an unbounded handshake field into logs and persisted metadata.
pub(crate) fn sanitize_client_name(name: &str) -> Option<String> {
    let mut clean = String::new();
    for character in name
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(96)
    {
        clean.push(character);
    }
    let clean = clean.trim();
    (!clean.is_empty()).then(|| clean.to_string())
}

fn forget_origin(root: &Path, id: &str) {
    let _ = fs::remove_file(origin_path(root, id));
}

fn validate_relative_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("path_empty".into());
    }
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err("path_absolute".into());
    }
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err("path_absolute".into());
    }
    for segment in normalized.split('/') {
        if segment.is_empty() {
            return Err("path_empty_segment".into());
        }
        if segment == ".." {
            return Err("path_traversal".into());
        }
    }
    Ok(())
}

/// The id a file set claims for itself, as its manifest spells it.
///
/// The two package formats name themselves in different fields — a contract
/// package in `name`, a runtime package in `id` — and `widget` is the
/// discriminator, exactly as in `is_contract_manifest`. Reading the wrong field
/// would rename a runtime package to its display name.
///
/// `None` for a manifest that is missing, unparseable or nameless: a draft
/// nobody can read stays in the folder it was written to, and the validator
/// names the real problem next to the file.
pub(crate) fn declared_package_id(files: &[DraftFile]) -> Option<String> {
    let manifest = files.iter().find(|file| file.path == "manifest.json")?;
    let raw: serde_json::Value = serde_json::from_str(&manifest.contents).ok()?;
    let field = if raw.get("widget").map(|w| w.is_object()).unwrap_or(false) {
        "name"
    } else {
        "id"
    };
    raw.get(field)?.as_str().map(str::to_string)
}

fn check_files(files: &[DraftFile]) -> Result<(), String> {
    if files.is_empty() {
        return Err("no_files".into());
    }
    if files.len() > MAX_FILES {
        return Err("too_many_files".into());
    }

    let mut paths = BTreeSet::new();
    let mut total = 0usize;
    for file in files {
        validate_relative_path(&file.path).map_err(|error| format!("unsafe_path:{error}"))?;
        if !paths.insert(file.path.replace('\\', "/")) {
            return Err(format!("duplicate_file:{}", file.path));
        }
        let bytes = file.contents.len();
        if bytes > MAX_FILE_BYTES {
            return Err(format!("file_too_large:{}", file.path));
        }
        total = total
            .checked_add(bytes)
            .ok_or_else(|| "package_too_large".to_string())?;
    }
    if total > MAX_TOTAL_BYTES {
        return Err("package_too_large".into());
    }

    if !files.iter().any(|file| file.path == "manifest.json") {
        return Err("missing_manifest".into());
    }
    Ok(())
}

/// Read every file as raw bytes in normalized path order. Revision hashing
/// intentionally accepts binary files; the full-text read surface rejects
/// them separately, but the identity of a broken draft must remain stable.
/// The files of one package: each a package-relative path and its bytes.
pub(crate) type PackageBytes = Vec<(String, Vec<u8>)>;

fn read_raw_files(dir: &Path) -> Result<PackageBytes, String> {
    let mut files = Vec::new();
    for relative in list_files(dir) {
        let path = safe_join(dir, &relative).map_err(|error| format!("unsafe_path:{error}"))?;
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        files.push((relative, bytes));
    }
    Ok(files)
}

fn content_revision(files: &[(String, Vec<u8>)]) -> String {
    let mut ordered = files.to_vec();
    ordered.sort_by(|left, right| left.0.cmp(&right.0));
    let mut hasher = Sha256::new();
    for (path, contents) in &ordered {
        hasher.update((path.len() as u64).to_le_bytes());
        hasher.update(path.as_bytes());
        hasher.update((contents.len() as u64).to_le_bytes());
        hasher.update(contents);
    }
    hex_encode(hasher.finalize().as_slice())
}

/// Lowercase hex; sha2 0.11's digest no longer implements `LowerHex`.
fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0xf) as usize] as char);
    }
    out
}

fn revision_for_dir(dir: &Path) -> Result<String, String> {
    Ok(content_revision(&read_raw_files(dir)?))
}

fn read_text_files(dir: &Path) -> Result<Vec<DraftFile>, String> {
    let raw = read_raw_files(dir)?;
    if raw.len() > MAX_FILES {
        return Err("package_too_large".into());
    }
    let mut total = 0usize;
    let mut files = Vec::with_capacity(raw.len());
    for (path, bytes) in raw {
        if bytes.len() > MAX_FILE_BYTES {
            return Err(format!("file_too_large:{path}"));
        }
        total = total
            .checked_add(bytes.len())
            .ok_or_else(|| "package_too_large".to_string())?;
        if total > MAX_TOTAL_BYTES {
            return Err("package_too_large".into());
        }
        let contents = String::from_utf8(bytes).map_err(|_| format!("not_text:{path}"))?;
        files.push(DraftFile { path, contents });
    }
    Ok(files)
}

fn summarize(id: &str, dir: &Path) -> Result<DraftSummary, String> {
    // The note is a sibling of `dir`, so the drafts root is its parent. Reading
    // it here rather than at each call site is what makes every surface —
    // list, read, write reply and event follow-up — agree about the author.
    let note = dir.parent().and_then(|root| read_origin(root, id));
    let last_client = note.as_ref().and_then(|note| note.last_client).or_else(|| {
        note.as_ref()
            .and_then(|note| note.last_client_name.as_deref())
            .and_then(McpClientKind::from_name)
    });
    Ok(DraftSummary {
        id: id.to_string(),
        files: list_files(dir),
        revision: revision_for_dir(dir)?,
        error: super::scan_package_dir_for_draft(id, dir),
        renamed_from: None,
        last_writer: note.as_ref().map(|note| note.last_writer),
        last_client,
        last_client_name: note.as_ref().and_then(|note| note.last_client_name.clone()),
        updated_at: note
            .as_ref()
            .map(|note| note.updated_at)
            .or_else(|| folder_time(dir)),
    })
}

fn snapshot(id: &str, dir: &Path) -> Result<DraftSnapshot, String> {
    let summary = summarize(id, dir)?;
    Ok(DraftSnapshot {
        id: summary.id,
        files: read_text_files(dir)?,
        revision: summary.revision,
        error: summary.error,
        last_writer: summary.last_writer,
        last_client: summary.last_client,
        last_client_name: summary.last_client_name,
        updated_at: summary.updated_at,
    })
}

/// Remove only transient siblings created for this id. Parent equality and the
/// exact prefix are checked before any deletion, keeping recovery cleanup
/// inside `.drafts` even if a directory contains surprising names.
fn cleanup_transients(root: &Path, id: &str) -> Result<(), String> {
    let entries = fs::read_dir(root).map_err(|error| error.to_string())?;
    let staging_prefix = format!(".{id}.staging-");
    let backup_prefix = format!(".{id}.backup-");
    for entry in entries.flatten() {
        let path = entry.path();
        if path.parent() != Some(root) {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !(name.starts_with(&staging_prefix) || name.starts_with(&backup_prefix)) {
            continue;
        }
        remove_path(&path)?;
    }
    Ok(())
}

fn remove_path(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn transient_path(root: &Path, id: &str, kind: &str) -> PathBuf {
    let serial = NEXT_TRANSIENT_ID.fetch_add(1, Ordering::Relaxed);
    root.join(format!(".{id}.{kind}-{}-{serial}", std::process::id()))
}

fn write_tree(staging: &Path, files: &[DraftFile]) -> Result<(), String> {
    fs::create_dir_all(staging).map_err(|error| error.to_string())?;
    for file in files {
        let target =
            safe_join(staging, &file.path).map_err(|error| format!("unsafe_path:{error}"))?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&target, file.contents.as_bytes()).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Publish a complete staged tree. If the second rename fails, the old tree is
/// put back before the error reaches the caller.
fn publish_staged(root: &Path, id: &str, staging: &Path, target: &Path) -> Result<(), String> {
    let backup = transient_path(root, id, "backup");
    let had_existing = target.exists();
    if had_existing {
        fs::rename(target, &backup).map_err(|error| format!("draft_recovery:{error}"))?;
    }

    if let Err(error) = fs::rename(staging, target) {
        if had_existing {
            if let Err(restore) = fs::rename(&backup, target) {
                return Err(format!("draft_recovery:{error};restore:{restore}"));
            }
        }
        return Err(format!("draft_publish:{error}"));
    }

    // A leftover backup is safe and is cleaned before the next operation. Do
    // not turn a successful publication into a failed write because cleanup
    // was interrupted by a locked file on Windows.
    if had_existing {
        let _ = remove_path(&backup);
    }
    Ok(())
}

fn current_revision(dir: &Path) -> Result<Option<String>, String> {
    if !dir.exists() {
        return Ok(None);
    }
    if !dir.is_dir() {
        return Err("draft_recovery:not_a_directory".into());
    }
    Ok(Some(revision_for_dir(dir)?))
}

/// Write a complete file set, into the folder the manifest names.
///
/// **The manifest is the identity.** A package's folder name and its manifest
/// name are one string by construction — the scanner refuses any package where
/// they differ, and the bridge resolves a widget's own directory through
/// `manifest.name`. So an author who edits that field is not making a mistake to
/// be reported, they are renaming the widget, and the folder follows. Refusing
/// instead left the only way to rename a widget outside the product: the wizard
/// discarded the draft and asked for it to be generated again under the new
/// name, and an MCP client had no move at all.
///
/// Two cases deliberately do not rename. A name that is not a usable directory
/// name is written where it was, so the validator can say `invalid_package_id`
/// next to the file rather than the write failing with nothing on disk. A name
/// already taken by another draft fails the write: silently merging two drafts
/// would destroy one of them, and that one is somebody's unsaved widget.
#[cfg(test)]
fn write_draft_tree(
    root: &Path,
    id: &str,
    files: &[DraftFile],
    expected_revision: Option<&str>,
    origin: DraftWriteOrigin,
) -> Result<DraftSummary, String> {
    write_draft_tree_with_client(root, id, files, expected_revision, origin, None, None)
}

fn write_draft_tree_with_client(
    root: &Path,
    id: &str,
    files: &[DraftFile],
    expected_revision: Option<&str>,
    origin: DraftWriteOrigin,
    client: Option<McpClientKind>,
    client_name: Option<&str>,
) -> Result<DraftSummary, String> {
    if !is_valid_package_id(id) {
        return Err("invalid_package_id".into());
    }
    check_files(files)?;

    let declared = declared_package_id(files).filter(|name| name != id);
    let target_id = match declared.as_deref() {
        Some(name) if is_valid_package_id(name) => name,
        _ => id,
    };
    let renaming = target_id != id;

    // The optimistic check is against the folder the caller knows about. The
    // new name has no history for them to have read.
    let source = root.join(id);
    let current = current_revision(&source)?;
    match (&current, expected_revision) {
        (None, None) => {}
        (Some(current), Some(expected)) if current == expected => {}
        (Some(current), _) => return Err(format!("draft_conflict:{current}")),
        (None, Some(_)) => return Err("draft_conflict:missing".into()),
    }

    let target = root.join(target_id);
    if renaming && target.exists() {
        return Err(format!("draft_exists:{target_id}"));
    }

    cleanup_transients(root, id).map_err(|error| format!("draft_recovery:{error}"))?;
    if renaming {
        cleanup_transients(root, target_id).map_err(|error| format!("draft_recovery:{error}"))?;
    }

    let staging = transient_path(root, target_id, "staging");
    if let Err(error) = write_tree(&staging, files) {
        let _ = remove_path(&staging);
        return Err(error);
    }
    if let Err(error) = publish_staged(root, target_id, &staging, &target) {
        let _ = remove_path(&staging);
        return Err(error);
    }
    // The complete package is already published under its new name, so a
    // directory that will not go away on Windows is litter and not a failed
    // write. `cleanup_transients` cannot reach it — it is a draft folder, not a
    // transient — but the next write under the old name replaces it.
    if renaming {
        let _ = remove_path(&source);
        forget_origin(root, id);
    }

    // Before `summarize`, which reads it back: one place decides the author and
    // one place reports it, so a reply can never disagree with what a later
    // `list_drafts` says about the same write.
    record_origin(root, target_id, origin, client, client_name);
    let mut summary = summarize(target_id, &target)?;
    if renaming {
        summary.renamed_from = Some(id.to_string());
    }
    Ok(summary)
}

#[allow(clippy::too_many_arguments)]
fn emit_changed<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    revision: Option<String>,
    kind: DraftChangeKind,
    origin: DraftWriteOrigin,
    client: Option<McpClientKind>,
    client_name: Option<String>,
    renamed_from: Option<String>,
) {
    let _ = app.emit(
        "runtime-draft:changed",
        DraftChanged {
            id: id.to_string(),
            revision,
            kind,
            origin,
            client,
            client_name,
            renamed_from,
        },
    );
}

/// Shared write operation. MCP uses the same service with a different origin
/// once its transport is added; the Wizard command remains an adapter.
pub(crate) fn write_draft<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    files: &[DraftFile],
    expected_revision: Option<&str>,
    origin: DraftWriteOrigin,
) -> Result<DraftSummary, String> {
    write_draft_with_client(app, id, files, expected_revision, origin, None, None)
}

pub(crate) fn write_draft_with_client<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    files: &[DraftFile],
    expected_revision: Option<&str>,
    origin: DraftWriteOrigin,
    client: Option<McpClientKind>,
    client_name: Option<&str>,
) -> Result<DraftSummary, String> {
    if !is_valid_package_id(id) {
        return Err("invalid_package_id".into());
    }
    check_files(files)?;
    let root = drafts_root(app)?;
    let summary = write_draft_tree_with_client(
        &root,
        id,
        files,
        expected_revision,
        origin,
        client,
        client_name,
    )?;
    // The id the draft has *now*, which is not the id that was asked for when
    // the manifest renamed it.
    emit_changed(
        app,
        &summary.id,
        Some(summary.revision.clone()),
        DraftChangeKind::Written,
        origin,
        client,
        client_name.map(str::to_string),
        summary.renamed_from.clone(),
    );
    Ok(summary)
}

pub(crate) fn read_draft<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<DraftSnapshot, String> {
    let dir = draft_dir(app, id)?;
    if !dir.is_dir() {
        return Err("draft_not_found".into());
    }
    snapshot(id, &dir)
}

pub(crate) fn validate_draft<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<DraftSummary, String> {
    let dir = draft_dir(app, id)?;
    if !dir.is_dir() {
        return Err("draft_not_found".into());
    }
    summarize(id, &dir)
}

pub(crate) fn list_drafts<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<DraftSummary>, String> {
    let root = drafts_root(app)?;
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        if !entry.metadata().map(|meta| meta.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !is_valid_package_id(&id) {
            continue;
        }
        out.push(summarize(&id, &entry.path())?);
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

pub(crate) fn read_custom_package<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<Vec<DraftFile>, String> {
    if !is_valid_package_id(id) {
        return Err("invalid_package_id".into());
    }
    let root = root_path(app, PackageOrigin::Custom)?;
    let dir = safe_join(&root, id).map_err(|error| format!("unsafe_path:{error}"))?;
    if !dir.is_dir() {
        return Err("package_not_found".into());
    }
    read_text_files(&dir)
}

/// Which of the two copies of a widget a read came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PackageSnapshot {
    /// The draft workspace — work that has not been saved onto the desk yet.
    Draft,
    /// The installed package, in whichever root holds it.
    Widget,
}

/// Every file of `id` as bytes, plus which copy they came from.
///
/// The draft wins when there is one. It is the newer of the two by
/// construction — a draft only exists between a checkout and a save — and
/// exporting the saved copy while the Wizard is showing the draft would hand
/// somebody an archive of a widget they are looking at the successor of.
///
/// Bytes rather than `DraftFile`: this is the one reader that must not require
/// the package to be text. A widget with a PNG beside its manifest still has to
/// travel whole, and `read_text_files` refuses it.
pub(crate) fn read_current_package_bytes<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<(PackageBytes, PackageSnapshot), String> {
    if !is_valid_package_id(id) {
        return Err("invalid_package_id".into());
    }
    let (dir, source) = match draft_package_dir(app, id) {
        Some(draft) => (draft, PackageSnapshot::Draft),
        None => (
            super::package_root_for(app, id).ok_or("package_not_found")?,
            PackageSnapshot::Widget,
        ),
    };

    let files = read_raw_files(&dir)?;
    // The same ceilings every write to the workspace is held to. A package
    // over them did not come from here, and refusing it by name beats writing
    // an archive whose size nobody accounted for.
    if files.len() > MAX_FILES {
        return Err("package_too_large".into());
    }
    let total: usize = files.iter().map(|(_, bytes)| bytes.len()).sum();
    if total > MAX_TOTAL_BYTES {
        return Err("package_too_large".into());
    }
    Ok((files, source))
}

/// Read a custom-root package together with the same content identity used by
/// drafts. Installed packages never reach this function because it resolves
/// the custom root directly.
#[allow(dead_code)]
pub(crate) fn read_custom_package_with_revision<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<(Vec<DraftFile>, String), String> {
    if !is_valid_package_id(id) {
        return Err("invalid_package_id".into());
    }
    let root = root_path(app, PackageOrigin::Custom)?;
    let dir = safe_join(&root, id).map_err(|error| format!("unsafe_path:{error}"))?;
    if !dir.is_dir() {
        return Err("package_not_found".into());
    }
    let files = read_text_files(&dir)?;
    let revision = revision_for_dir(&dir)?;
    Ok((files, revision))
}

/// Copy a promoted custom widget into the draft workspace for editing.
///
/// The source revision is checked before anything is written and an existing
/// draft is never replaced. The returned revision is the new draft revision;
/// because checkout copies the complete source tree, it initially equals the
/// checked source revision. Promotion remains a Wizard-only operation.
pub(crate) fn checkout_custom_widget<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    expected_source_revision: &str,
    origin: DraftWriteOrigin,
) -> Result<DraftSnapshot, String> {
    checkout_custom_widget_with_client(app, id, expected_source_revision, origin, None, None)
}

pub(crate) fn checkout_custom_widget_with_client<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    expected_source_revision: &str,
    origin: DraftWriteOrigin,
    client: Option<McpClientKind>,
    client_name: Option<&str>,
) -> Result<DraftSnapshot, String> {
    let custom_root = root_path(app, PackageOrigin::Custom)?;
    let summary = checkout_custom_tree_with_client(
        &custom_root,
        id,
        expected_source_revision,
        origin,
        client,
        client_name,
    )?;
    emit_changed(
        app,
        &summary.id,
        Some(summary.revision.clone()),
        DraftChangeKind::Written,
        origin,
        client,
        client_name.map(str::to_string),
        summary.renamed_from.clone(),
    );
    let draft_root =
        safe_join(&custom_root, DRAFTS_DIR).map_err(|error| format!("unsafe_path:{error}"))?;
    let draft_dir =
        safe_join(&draft_root, &summary.id).map_err(|error| format!("unsafe_path:{error}"))?;
    snapshot(&summary.id, &draft_dir)
}

/// What opening a saved widget for editing found.
///
/// The two cases are one operation on purpose. A Wizard that checked for a
/// draft, found none and then checked one out would have a window between the
/// two calls in which an MCP client can create exactly the draft it just
/// decided did not exist — and the Wizard would then write its stale copy of
/// the saved files over somebody's work with a revision that validates.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftOpen {
    pub snapshot: DraftSnapshot,
    /// True when a draft was already there, so nothing was copied.
    ///
    /// The difference is not visible in the files — a fresh checkout is a byte
    /// copy of the saved widget — but it is the difference between "here is
    /// your widget" and "there are unsaved changes here, from somebody".
    pub existing: bool,
}

/// Open a saved custom widget for editing: its draft, or a fresh checkout.
pub(crate) fn open_custom_draft<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    origin: DraftWriteOrigin,
) -> Result<DraftOpen, String> {
    let dir = draft_dir(app, id)?;
    if dir.is_dir() {
        return Ok(DraftOpen {
            snapshot: snapshot(id, &dir)?,
            existing: true,
        });
    }
    let custom_root = root_path(app, PackageOrigin::Custom)?;
    let source = safe_join(&custom_root, id).map_err(|error| format!("unsafe_path:{error}"))?;
    if !source.is_dir() {
        return Err("package_not_found".into());
    }
    let revision = revision_for_dir(&source)?;
    Ok(DraftOpen {
        snapshot: checkout_custom_widget(app, id, &revision, origin)?,
        existing: false,
    })
}

#[cfg(test)]
fn checkout_custom_tree(
    custom_root: &Path,
    id: &str,
    expected_source_revision: &str,
    origin: DraftWriteOrigin,
) -> Result<DraftSummary, String> {
    checkout_custom_tree_with_client(
        custom_root,
        id,
        expected_source_revision,
        origin,
        None,
        None,
    )
}

fn checkout_custom_tree_with_client(
    custom_root: &Path,
    id: &str,
    expected_source_revision: &str,
    origin: DraftWriteOrigin,
    client: Option<McpClientKind>,
    client_name: Option<&str>,
) -> Result<DraftSummary, String> {
    if !is_valid_package_id(id) {
        return Err("invalid_package_id".into());
    }

    let source = safe_join(custom_root, id).map_err(|error| format!("unsafe_path:{error}"))?;
    if !source.is_dir() {
        return Err("package_not_found".into());
    }

    let source_revision = revision_for_dir(&source)?;
    if source_revision != expected_source_revision {
        return Err(format!("custom_conflict:{source_revision}"));
    }

    let draft_root =
        safe_join(custom_root, DRAFTS_DIR).map_err(|error| format!("unsafe_path:{error}"))?;
    fs::create_dir_all(&draft_root).map_err(|error| error.to_string())?;
    let draft = safe_join(&draft_root, id).map_err(|error| format!("unsafe_path:{error}"))?;
    if draft.is_dir() {
        let revision = revision_for_dir(&draft)?;
        return Err(format!("draft_exists:{revision}"));
    }

    let files = read_text_files(&source)?;
    write_draft_tree_with_client(&draft_root, id, &files, None, origin, client, client_name)
}

/// Install a draft, optionally retiring the name the same widget had before.
///
/// `replaces` is the widget this draft was opened from. It is the caller's
/// knowledge and cannot be derived here: once a draft is renamed, nothing on
/// disk still connects the new folder to the old widget. Without it a rename
/// installs a second copy under the new name and leaves the original on the
/// desk, still holding the grants, no longer the one being edited.
pub(crate) fn promote_draft(
    app: &AppHandle,
    id: &str,
    replaces: Option<&str>,
    origin: DraftWriteOrigin,
) -> Result<String, String> {
    let dir = draft_dir(app, id)?;
    if !dir.is_dir() {
        return Err("draft_not_found".into());
    }
    let summary = summarize(id, &dir)?;
    if let Some(error) = summary.error {
        return Err(error);
    }

    let target = root_path(app, PackageOrigin::Custom)?.join(id);
    if let Some(doomed) = replaceable(super::package_root_for(app, id), &target)? {
        fs::remove_dir_all(&doomed).map_err(|error| error.to_string())?;
    }
    fs::rename(&dir, &target).map_err(|error| error.to_string())?;
    if let Some(root) = dir.parent() {
        forget_origin(root, id);
    }

    // Only after the new folder exists: a failure above must leave the widget
    // exactly as it was, under its old name and with its grants.
    let renamed_from = match replaces {
        Some(previous) if previous != id => retire_renamed_package(app, previous, id)?,
        _ => None,
    };

    emit_changed(
        app,
        id,
        Some(summary.revision),
        DraftChangeKind::Promoted,
        origin,
        None,
        None,
        renamed_from,
    );
    super::path_to_string(&target)
}

/// Fold a widget's previous name into the one it was just installed under.
///
/// A rename is a move, not a fork. The install record travels with it — grants,
/// credential grants, the enabled flag and the api hash — because renaming a
/// package changes not one endpoint it declares, and asking somebody to approve
/// again what they approved a minute ago is how a consent dialog becomes
/// something people click through unread.
///
/// Only the custom root is the wizard's to move. A bundled or installed package
/// that happens to carry the old name belongs to somebody else and is left
/// alone, along with its record.
fn retire_renamed_package(
    app: &AppHandle,
    previous: &str,
    id: &str,
) -> Result<Option<String>, String> {
    if !is_valid_package_id(previous) {
        return Ok(None);
    }
    let custom = root_path(app, PackageOrigin::Custom)?.join(previous);
    if !custom.is_dir() {
        return Ok(None);
    }
    super::installs::rename(app, previous, id)?;
    fs::remove_dir_all(&custom).map_err(|error| error.to_string())?;
    Ok(Some(previous.to_string()))
}

pub(crate) fn discard_draft<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    origin: DraftWriteOrigin,
) -> Result<(), String> {
    let dir = draft_dir(app, id)?;
    if !dir.is_dir() {
        return Ok(());
    }
    fs::remove_dir_all(&dir).map_err(|error| error.to_string())?;
    if let Some(root) = dir.parent() {
        forget_origin(root, id);
    }
    emit_changed(
        app,
        id,
        None,
        DraftChangeKind::Discarded,
        origin,
        None,
        None,
        None,
    );
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_draft_write(
    app: AppHandle,
    id: String,
    files: Vec<DraftFile>,
    expected_revision: Option<String>,
) -> Result<DraftSummary, String> {
    write_draft(
        &app,
        &id,
        &files,
        expected_revision.as_deref(),
        DraftWriteOrigin::Wizard,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_draft_read(app: AppHandle, id: String) -> Result<DraftSnapshot, String> {
    read_draft(&app, &id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_draft_validate(
    app: AppHandle,
    id: String,
) -> Result<DraftSummary, String> {
    validate_draft(&app, &id)
}

/// Open a saved custom widget for editing from the Wizard.
///
/// The Wizard used to read the *installed* files and keep them in memory, which
/// made editing a saved widget the one path that bypassed the draft workspace
/// entirely: an MCP client could not see the work, and the first write took
/// whatever revision it found — including a draft somebody else had checked
/// out — and published over it. Both clients now edit the same object.
#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_draft_open(app: AppHandle, id: String) -> Result<DraftOpen, String> {
    open_custom_draft(&app, &id, DraftWriteOrigin::Wizard)
}

#[tauri::command]
pub fn runtime_extensions_draft_list(app: AppHandle) -> Result<Vec<DraftSummary>, String> {
    list_drafts(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_read_package(
    app: AppHandle,
    id: String,
) -> Result<Vec<DraftFile>, String> {
    read_custom_package(&app, &id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_draft_promote(
    app: AppHandle,
    id: String,
    replaces: Option<String>,
) -> Result<String, String> {
    promote_draft(&app, &id, replaces.as_deref(), DraftWriteOrigin::Wizard)
}

fn replaceable(existing: Option<PathBuf>, target: &Path) -> Result<Option<PathBuf>, String> {
    match existing {
        Some(path) if path != target => Err("id_already_installed".into()),
        other => Ok(other),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_delete_package(app: AppHandle, id: String) -> Result<(), String> {
    if !is_valid_package_id(&id) {
        return Err("invalid_package_id".into());
    }
    let target = root_path(&app, PackageOrigin::Custom)?.join(&id);
    match super::package_root_for(&app, &id) {
        Some(existing) if existing != target => return Err("id_already_installed".into()),
        Some(existing) => fs::remove_dir_all(&existing).map_err(|error| error.to_string())?,
        None => return Err("package_not_found".into()),
    }
    let _ = fs::remove_dir_all(drafts_root(&app)?.join(&id));
    super::installs::forget(&app, &id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_draft_discard(app: AppHandle, id: String) -> Result<(), String> {
    discard_draft(&app, &id, DraftWriteOrigin::Wizard)
}

fn list_files(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    collect_files(dir, dir, &mut out);
    out.sort();
    out
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, out);
        } else if let Ok(relative) = path.strip_prefix(root) {
            out.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "kavibay_drafts_{label}_{}_{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file(path: &str, contents: &str) -> DraftFile {
        DraftFile {
            path: path.into(),
            contents: contents.into(),
        }
    }

    #[test]
    fn package_ids_are_plain_names() {
        assert!(is_valid_package_id("water-tracker"));
        assert!(is_valid_package_id("hello_2"));
        assert!(!is_valid_package_id(""));
        assert!(!is_valid_package_id(".drafts"));
        assert!(!is_valid_package_id("a/b"));
        assert!(!is_valid_package_id("a\\b"));
        assert!(!is_valid_package_id("-leading-dash"));
        assert!(!is_valid_package_id(&"x".repeat(65)));
    }

    #[test]
    fn only_the_custom_copy_may_be_replaced() {
        let custom = PathBuf::from("/data/extensions-custom/counter");
        let installed = PathBuf::from("/data/extensions/counter");
        assert_eq!(replaceable(None, &custom).unwrap(), None);
        assert_eq!(
            replaceable(Some(custom.clone()), &custom).unwrap(),
            Some(custom)
        );
        assert_eq!(
            replaceable(
                Some(installed),
                &PathBuf::from("/data/extensions-custom/counter")
            )
            .unwrap_err(),
            "id_already_installed"
        );
    }

    #[test]
    fn a_package_needs_a_manifest_and_safe_paths() {
        assert_eq!(
            check_files(&[file("ui/index.html", "<p>hi</p>")]).unwrap_err(),
            "missing_manifest"
        );
        assert!(check_files(&[file("manifest.json", "{}")]).is_ok());
        assert!(
            check_files(&[file("../escape", "x"), file("manifest.json", "{}")])
                .unwrap_err()
                .starts_with("unsafe_path:")
        );
        assert_eq!(check_files(&[]).unwrap_err(), "no_files");
    }

    #[test]
    fn file_sets_are_bounded() {
        let many: Vec<DraftFile> = (0..33).map(|i| file(&format!("f{i}.txt"), "x")).collect();
        assert_eq!(check_files(&many).unwrap_err(), "too_many_files");
        let huge = file("manifest.json", &"x".repeat(MAX_FILE_BYTES + 1));
        assert!(check_files(&[huge])
            .unwrap_err()
            .starts_with("file_too_large:"));
        let chunk = "x".repeat(MAX_FILE_BYTES);
        let mut total: Vec<DraftFile> =
            (0..5).map(|i| file(&format!("f{i}.txt"), &chunk)).collect();
        total.push(file("manifest.json", "{}"));
        assert_eq!(check_files(&total).unwrap_err(), "package_too_large");
    }

    #[test]
    fn revision_is_stable_for_order_and_changes_for_path_or_content() {
        let first = vec![
            ("b.txt".into(), b"two".to_vec()),
            ("manifest.json".into(), b"{}".to_vec()),
        ];
        let reordered = vec![
            ("manifest.json".into(), b"{}".to_vec()),
            ("b.txt".into(), b"two".to_vec()),
        ];
        assert_eq!(content_revision(&first), content_revision(&reordered));
        let mut changed = first.clone();
        changed[0].0 = "c.txt".into();
        assert_ne!(content_revision(&first), content_revision(&changed));
        changed[0].0 = "b.txt".into();
        changed[0].1 = b"three".to_vec();
        assert_ne!(content_revision(&first), content_revision(&changed));
    }

    #[test]
    fn create_matching_update_and_stale_write_conflict() {
        let root = temp_root("revision");
        let first = write_draft_tree(
            &root,
            "counter",
            &[file("manifest.json", "{}")],
            None,
            DraftWriteOrigin::Wizard,
        )
        .unwrap();
        let second = write_draft_tree(
            &root,
            "counter",
            &[file("manifest.json", "{\"v\":2}")],
            Some(&first.revision),
            DraftWriteOrigin::Wizard,
        )
        .unwrap();
        assert_ne!(first.revision, second.revision);
        let error = write_draft_tree(
            &root,
            "counter",
            &[file("manifest.json", "{}")],
            Some(&first.revision),
            DraftWriteOrigin::Wizard,
        )
        .unwrap_err();
        assert!(error.starts_with("draft_conflict:"));
        assert_eq!(
            fs::read(root.join("counter").join("manifest.json")).unwrap(),
            b"{\"v\":2}"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn staged_publish_failure_restores_previous_complete_tree() {
        let root = temp_root("restore");
        let target = root.join("counter");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("manifest.json"), b"old").unwrap();
        let missing_staging = root.join(".counter.staging-missing");
        assert!(publish_staged(&root, "counter", &missing_staging, &target).is_err());
        assert_eq!(fs::read(target.join("manifest.json")).unwrap(), b"old");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_transient_cleanup_stays_inside_drafts_root() {
        let root = temp_root("cleanup");
        let inside_staging = root.join(".counter.staging-stale");
        let inside_backup = root.join(".counter.backup-stale");
        fs::create_dir_all(&inside_staging).unwrap();
        fs::create_dir_all(&inside_backup).unwrap();
        let outside = root.parent().unwrap().join(".counter.staging-escape");
        fs::create_dir_all(&outside).unwrap();
        cleanup_transients(&root, "counter").unwrap();
        assert!(!inside_staging.exists());
        assert!(!inside_backup.exists());
        assert!(outside.exists());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn full_text_read_enforces_caps_and_text_only() {
        let root = temp_root("read");
        fs::write(root.join("manifest.json"), b"{}").unwrap();
        fs::write(root.join("readme.txt"), b"hello").unwrap();
        let files = read_text_files(&root).unwrap();
        assert_eq!(files.len(), 2);
        fs::write(root.join("binary.bin"), [0, 159, 146, 150]).unwrap();
        assert_eq!(read_text_files(&root).unwrap_err(), "not_text:binary.bin");
        let _ = fs::remove_dir_all(root);
    }

    /// The byline is data about the write, not part of the package.
    ///
    /// Storing it inside the draft folder would fold it into `revision_for_dir`,
    /// and every write would then answer with a revision that differs from the
    /// one the writer computed — a permanent, self-inflicted `draft_conflict`.
    #[test]
    fn authorship_is_recorded_beside_the_draft_and_not_inside_its_revision() {
        let root = temp_root("origin_note");
        let files = [file("manifest.json", r#"{"id":"counter"}"#)];

        let mcp = write_draft_tree(&root, "counter", &files, None, DraftWriteOrigin::Mcp).unwrap();
        assert_eq!(mcp.last_writer, Some(DraftWriteOrigin::Mcp));
        assert!(mcp.updated_at.is_some());
        assert_eq!(
            mcp.revision,
            revision_for_dir(&root.join("counter")).unwrap(),
            "the note must not change the content identity"
        );
        assert!(!list_drafts_ids(&root).contains(&".counter.origin".to_string()));

        let wizard = write_draft_tree(
            &root,
            "counter",
            &files,
            Some(&mcp.revision),
            DraftWriteOrigin::Wizard,
        )
        .unwrap();
        assert_eq!(wizard.last_writer, Some(DraftWriteOrigin::Wizard));
        assert_eq!(
            wizard.revision, mcp.revision,
            "the same bytes keep the same revision whoever wrote them"
        );
    }

    #[test]
    fn known_mcp_clients_are_detected_without_branding_unknown_names() {
        assert_eq!(
            McpClientKind::from_name("OpenAI Codex"),
            Some(McpClientKind::Codex)
        );
        assert_eq!(
            McpClientKind::from_name("codex-mcp-client"),
            Some(McpClientKind::Codex)
        );
        assert_eq!(
            McpClientKind::from_name("claude-code"),
            Some(McpClientKind::Claude)
        );
        assert_eq!(McpClientKind::from_name("notcodex"), None);
        assert_eq!(McpClientKind::from_name("custom-agent"), None);
        assert_eq!(McpClientKind::Codex.label(), "codex");
    }

    #[test]
    fn client_name_is_bounded_and_control_characters_are_removed() {
        assert_eq!(
            sanitize_client_name("  codex-cli\n"),
            Some("codex-cli".into())
        );
        assert_eq!(sanitize_client_name("\u{0}\u{1}"), None);
        let long = "x".repeat(120);
        assert_eq!(sanitize_client_name(&long).unwrap().len(), 96);
    }

    #[test]
    fn known_mcp_client_is_persisted_outside_the_content_revision() {
        let root = temp_root("origin_client");
        let files = [file("manifest.json", r#"{"id":"counter"}"#)];

        let summary = write_draft_tree_with_client(
            &root,
            "counter",
            &files,
            None,
            DraftWriteOrigin::Mcp,
            Some(McpClientKind::Codex),
            Some("codex-cli"),
        )
        .unwrap();
        assert_eq!(summary.last_client, Some(McpClientKind::Codex));
        assert_eq!(summary.last_client_name.as_deref(), Some("codex-cli"));
        assert_eq!(
            summary.revision,
            revision_for_dir(&root.join("counter")).unwrap()
        );
        let reread = summarize("counter", &root.join("counter")).unwrap();
        assert_eq!(reread.last_client, Some(McpClientKind::Codex));
        assert_eq!(reread.last_client_name.as_deref(), Some("codex-cli"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_newly_recognized_client_name_backfills_the_branded_kind() {
        let root = temp_root("origin_client_backfill");
        let draft = root.join("counter");
        write_tree(&draft, &[file("manifest.json", r#"{"id":"counter"}"#)]).unwrap();
        fs::write(
            origin_path(&root, "counter"),
            r#"{"lastWriter":"mcp","lastClient":null,"lastClientName":"codex-mcp-client","updatedAt":1}"#,
        )
        .unwrap();

        let summary = summarize("counter", &draft).unwrap();
        assert_eq!(summary.last_client, Some(McpClientKind::Codex));
        assert_eq!(
            summary.last_client_name.as_deref(),
            Some("codex-mcp-client")
        );

        let _ = fs::remove_dir_all(root);
    }

    /// A rename moves the byline with the folder.
    ///
    /// Left behind, it would attach to whatever draft is created under the old
    /// name next and credit that write to whoever made this one.
    #[test]
    fn renaming_a_draft_moves_its_authorship_note() {
        let root = temp_root("origin_rename");
        let before = write_draft_tree(
            &root,
            "old-name",
            &[file("manifest.json", r#"{"id":"old-name"}"#)],
            None,
            DraftWriteOrigin::Mcp,
        )
        .unwrap();
        let after = write_draft_tree(
            &root,
            "old-name",
            &[file("manifest.json", r#"{"id":"new-name"}"#)],
            Some(&before.revision),
            DraftWriteOrigin::Mcp,
        )
        .unwrap();

        assert_eq!(after.id, "new-name");
        assert_eq!(after.last_writer, Some(DraftWriteOrigin::Mcp));
        assert!(!origin_path(&root, "old-name").exists());
        assert!(origin_path(&root, "new-name").exists());
    }

    /// Helper: what `list_drafts` would consider a draft in this root.
    fn list_drafts_ids(root: &Path) -> Vec<String> {
        fs::read_dir(root)
            .unwrap()
            .flatten()
            .filter(|entry| entry.metadata().map(|meta| meta.is_dir()).unwrap_or(false))
            .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
            .filter(|name| is_valid_package_id(name))
            .collect()
    }

    #[test]
    fn custom_checkout_requires_source_revision_and_never_replaces_a_draft() {
        let root = temp_root("checkout");
        let source = root.join("counter");
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("manifest.json"),
            br#"{"id":"counter","name":"Counter"}"#,
        )
        .unwrap();
        fs::write(source.join("index.html"), b"<p>one</p>").unwrap();

        let source_revision = revision_for_dir(&source).unwrap();
        let summary =
            checkout_custom_tree(&root, "counter", &source_revision, DraftWriteOrigin::Mcp)
                .unwrap();
        assert_eq!(summary.id, "counter");
        assert_eq!(summary.revision, source_revision);
        assert_eq!(
            fs::read(root.join(DRAFTS_DIR).join("counter").join("index.html")).unwrap(),
            b"<p>one</p>"
        );

        fs::write(source.join("index.html"), b"<p>two</p>").unwrap();
        let current_revision = revision_for_dir(&source).unwrap();
        assert_eq!(
            checkout_custom_tree(&root, "counter", &source_revision, DraftWriteOrigin::Mcp)
                .unwrap_err(),
            format!("custom_conflict:{current_revision}")
        );
        assert_eq!(
            checkout_custom_tree(&root, "counter", &current_revision, DraftWriteOrigin::Mcp)
                .unwrap_err(),
            format!("draft_exists:{}", summary.revision)
        );
        let _ = fs::remove_dir_all(root);
    }

    /// The one field each format identifies itself by, and no other.
    #[test]
    fn the_declared_id_is_read_from_the_format_that_wrote_it() {
        let contract = file(
            "manifest.json",
            r#"{"name":"tadoweather","displayName":"Innen & Außen","widget":{"name":"tile"}}"#,
        );
        assert_eq!(
            declared_package_id(&[contract]).as_deref(),
            Some("tadoweather")
        );
        // A runtime manifest's `name` is its *display* name, and renaming a
        // package to "Water tracker" is exactly the bug this fork prevents.
        let runtime = file(
            "manifest.json",
            r#"{"id":"water-tracker","name":"Water tracker"}"#,
        );
        assert_eq!(
            declared_package_id(&[runtime]).as_deref(),
            Some("water-tracker")
        );
        assert_eq!(
            declared_package_id(&[file("manifest.json", "not json")]),
            None
        );
        assert_eq!(declared_package_id(&[file("widget.js", "{}")]), None);
    }

    /// Renaming a widget is editing one field; the folder follows the manifest.
    #[test]
    fn a_renamed_manifest_moves_the_draft() {
        let root = temp_root("rename");
        let before = write_draft_tree(
            &root,
            "dssd",
            &[file(
                "manifest.json",
                r#"{"name":"dssd","widget":{"name":"tile"}}"#,
            )],
            None,
            DraftWriteOrigin::Wizard,
        )
        .unwrap();
        let after = write_draft_tree(
            &root,
            "dssd",
            &[file(
                "manifest.json",
                r#"{"name":"tadoweather","widget":{"name":"tile"}}"#,
            )],
            Some(&before.revision),
            DraftWriteOrigin::Wizard,
        )
        .unwrap();
        assert_eq!(after.id, "tadoweather", "the answer names the new folder");
        assert_eq!(after.renamed_from.as_deref(), Some("dssd"));
        assert!(root.join("tadoweather").is_dir());
        assert!(
            !root.join("dssd").exists(),
            "the old folder does not linger"
        );
        let _ = fs::remove_dir_all(root);
    }

    /// Two drafts are two people's work. Merging them silently would lose one.
    #[test]
    fn a_rename_onto_an_occupied_name_is_refused() {
        let root = temp_root("rename_taken");
        let taken = write_draft_tree(
            &root,
            "tadoweather",
            &[file(
                "manifest.json",
                r#"{"name":"tadoweather","widget":{"name":"tile"}}"#,
            )],
            None,
            DraftWriteOrigin::Wizard,
        )
        .unwrap();
        let mine = write_draft_tree(
            &root,
            "dssd",
            &[file(
                "manifest.json",
                r#"{"name":"dssd","widget":{"name":"tile"}}"#,
            )],
            None,
            DraftWriteOrigin::Wizard,
        )
        .unwrap();
        let error = write_draft_tree(
            &root,
            "dssd",
            &[file(
                "manifest.json",
                r#"{"name":"tadoweather","widget":{"name":"tile"},"v":2}"#,
            )],
            Some(&mine.revision),
            DraftWriteOrigin::Wizard,
        )
        .unwrap_err();
        assert_eq!(error, "draft_exists:tadoweather");
        assert_eq!(
            revision_for_dir(&root.join("tadoweather")).unwrap(),
            taken.revision,
            "the draft that was already there is untouched"
        );
        assert!(
            root.join("dssd").is_dir(),
            "and so is the one being written"
        );
        let _ = fs::remove_dir_all(root);
    }

    /// A name that is not a directory name is not a rename request.
    ///
    /// The write still lands, because a draft on disk with a validator code the
    /// wizard shows next to the file is worth more than a refused write and an
    /// author wondering where their edit went.
    #[test]
    fn an_unusable_name_leaves_the_draft_where_it_was() {
        let root = temp_root("rename_invalid");
        let before = write_draft_tree(
            &root,
            "dssd",
            &[file(
                "manifest.json",
                r#"{"name":"dssd","widget":{"name":"tile"}}"#,
            )],
            None,
            DraftWriteOrigin::Wizard,
        )
        .unwrap();
        let after = write_draft_tree(
            &root,
            "dssd",
            &[file(
                "manifest.json",
                r#"{"name":"Tado Weather","widget":{"name":"tile"}}"#,
            )],
            Some(&before.revision),
            DraftWriteOrigin::Wizard,
        )
        .unwrap();
        assert_eq!(after.id, "dssd");
        assert_eq!(after.renamed_from, None);
        assert_eq!(
            after.error.as_deref(),
            Some("invalid_package_id"),
            "and the code names the field, not the folder"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn custom_read_surface_is_separate_from_installed_root() {
        let custom = temp_root("custom");
        let installed = temp_root("installed");
        fs::write(custom.join("manifest.json"), b"{}").unwrap();
        fs::write(installed.join("manifest.json"), b"{installed}").unwrap();
        assert_eq!(read_text_files(&custom).unwrap()[0].contents, "{}");
        assert_ne!(read_text_files(&custom).unwrap()[0].contents, "{installed}");
        let _ = fs::remove_dir_all(custom);
        let _ = fs::remove_dir_all(installed);
    }
}
