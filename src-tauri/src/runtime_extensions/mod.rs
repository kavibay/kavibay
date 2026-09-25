//! Runtime extension packages under `{data_dir}/extensions`.
//!
//! Disk scan + fail-closed manifest validation (mirrors FE Task 3 rules).
//! Custom `kavibay-ext` protocol serves package UI under that root.

pub mod api_declaration;
pub mod binding;
pub mod drafts;
pub mod export;
pub mod first_party;
pub mod http;
mod image_protocol;
pub mod installs;
pub mod limits;
pub mod net_guard;
mod protocol;
mod validate;

pub use image_protocol::register_kavibay_img_protocol;
pub use protocol::register_kavibay_ext_protocol;

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Runtime};

use crate::paths::data_dir;

use validate::safe_join;

/// Known permission catalog (includes P2-only `backend.sidecar`).
const KNOWN_PERMISSIONS: &[&str] = &[
    "storage.instance",
    "network.client",
    "network.declared",
    "backend.sidecar",
];

/// Permission that turns a package's `api.json` into callable endpoints.
///
/// `network.client` (raw fetch) stays reserved and unimplemented — see the
/// declarative HTTP design, section 3.
pub const NETWORK_DECLARED: &str = "network.declared";

/// One scanned package under the extensions root (camelCase for FE).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedRuntimeExtension {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub path: String,
    pub ui_entry: String,
    /// Size the widget opens at, from `ui.defaultSize`.
    ///
    /// Absent until now, so every runtime package opened at the host's fallback
    /// no matter what its manifest said.
    pub default_size: Option<WidgetSize>,
    /// Whether the card opens with its title bar hidden, from `ui.defaultHideTitle`.
    pub default_hide_title: Option<bool>,
    /// Content zoom the card opens at, from `ui.defaultScale` (1 = unzoomed).
    /// The host clamps it; anything non-positive is dropped here.
    pub default_scale: Option<f64>,
    /// Optional package-relative icon (`icon.svg` / `icon.png`).
    pub icon: Option<String>,
    pub permissions: Vec<String>,
    pub commands: Vec<String>,
    /// Declared HTTP endpoints (empty unless the package ships an `api.json`).
    /// Carries exactly what the consent dialog has to show — id, purpose,
    /// method, hosts, credential — and nothing that grants anything.
    pub api_endpoints: Vec<api_declaration::EndpointSummary>,
    /// Hash of the declaration the user would be consenting to. `None` when the
    /// package declares no endpoints.
    pub api_hash: Option<String>,
    /// Which of the two package formats this directory holds.
    ///
    /// Decided in one place — the manifest's `widget` object, see
    /// `is_contract_manifest` — and reported so the frontend never re-derives
    /// it. It is what says which frame a package is embedded with, and a second
    /// answer to that question is how a contract package ended up in the
    /// runtime bridge and rendered black.
    pub format: PackageFormat,
    /// A contract package's manifest, verbatim; `None` for a runtime package.
    ///
    /// Carried on the row rather than fetched by a second command because the
    /// approval dialog and the loader must both answer for the bytes this scan
    /// validated. Two reads of a file can disagree, and the one that decides
    /// what is granted must not be the later one.
    pub contract_manifest: Option<Value>,
    /// When this package's folder was last written, ms since the epoch.
    ///
    /// A promotion renames the draft into place, so for a widget somebody made
    /// here this is when they last pressed Save — which is the only "last
    /// edited" a kept package has. `None` when the folder cannot be read.
    pub updated_at: Option<i64>,
    /// Which root holds this package.
    pub origin: PackageOrigin,
    /// `"ready"` or `"error"`.
    pub status: String,
    pub error: Option<String>,
}

/// Where a package came from.
///
/// The separation is structural on purpose: a tool that may only write custom
/// packages gets the custom root and `safe_join`, so it cannot *address* an
/// installed one. That holds even when someone forgets to check.
/// Widget size in CSS pixels.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct WidgetSize {
    pub w: f64,
    pub h: f64,
}

/// Which contract a package is written against.
///
/// Not a trust level and not a capability: it says which runtime serves it
/// (`@kavibay/runtime.js` or `@kavibay/contract.js`) and therefore which frame
/// embeds it. A package loads one or the other, never both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PackageFormat {
    /// Declared endpoints, own storage — `docs/runtime-packages.md`.
    Runtime,
    /// Reads from a provider through the extension contract — `docs/contract-packages.md`.
    Contract,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PackageOrigin {
    /// Dropped in by hand or, later, by the store.
    Installed,
    /// Built here — the Widget-Wizard's workspace. Updates never touch it.
    Custom,
}

impl PackageOrigin {
    /// Directory name under the app data dir.
    fn dir_name(self) -> &'static str {
        match self {
            PackageOrigin::Installed => "extensions",
            PackageOrigin::Custom => "extensions-custom",
        }
    }

    /// Every root, in scan order.
    fn all() -> [PackageOrigin; 2] {
        [PackageOrigin::Installed, PackageOrigin::Custom]
    }
}

/// Resolve one root, creating the directory if missing.
///
/// Through `paths::data_dir`, not Tauri directly: asking for `app_data_dir()`
/// here would ignore `KAVIBAY_DATA_DIR` and drop a dev run packages into the
/// real profile — the one thing that switch exists to prevent.
pub(crate) fn root_path<R: tauri::Runtime>(
    app: &AppHandle<R>,
    origin: PackageOrigin,
) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join(origin.dir_name());
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Resolve `{data_dir}/extensions` — the installed root.
///
/// Still used for things that belong to *all* packages regardless of origin,
/// most importantly `installs.json`: a grant belongs to an id, not to the
/// folder that id happens to sit in.
pub(crate) fn extensions_root_path<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<PathBuf, String> {
    root_path(app, PackageOrigin::Installed)
}

/// Directory of one package, whichever root holds it.
///
/// **The only place that turns an id into a path.** Six call sites used to do
/// this themselves; if they disagree the protocol serves from the wrong root and
/// the symptom is a widget that silently does not load.
pub(crate) fn package_root_for<R: tauri::Runtime>(
    app: &AppHandle<R>,
    ext_id: &str,
) -> Option<PathBuf> {
    let roots: Vec<PathBuf> = PackageOrigin::all()
        .into_iter()
        .filter_map(|origin| root_path(app, origin).ok())
        .collect();
    resolve_in_roots(&roots, ext_id)
}

/// First root that actually holds `ext_id` as a directory.
///
/// The id checks live here rather than at the call sites: an id that is not a
/// single safe directory name has no package directory, whatever the caller
/// believes. A dot-prefixed id would also reach into `.drafts`, which is exactly
/// what the draft namespace exists to prevent.
fn resolve_in_roots(roots: &[PathBuf], ext_id: &str) -> Option<PathBuf> {
    // `:` because on Windows `root.join("C:")` is the drive's working
    // directory, not a folder under the root.
    if ext_id.is_empty() || ext_id.starts_with('.') || ext_id.contains(['/', '\\', '\0', ':']) {
        return None;
    }
    roots
        .iter()
        .map(|root| root.join(ext_id))
        .find(|candidate| candidate.is_dir())
}

/// Path → UTF-8 string for command responses.
pub(crate) fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "non-utf8 path".into())
}

/// True when `id` is in the known permission catalog.
fn is_known_permission(id: &str) -> bool {
    KNOWN_PERMISSIONS.contains(&id)
}

/// Fail-closed validation of a raw manifest for folder `folder_name`.
/// Returns `(fields for scan row, optional error code)`.
fn validate_manifest_on_disk(
    folder_name: &str,
    package_root: &Path,
    raw: &Value,
) -> (PartialScan, Option<String>) {
    let mut partial = PartialScan {
        id: folder_name.to_string(),
        name: String::new(),
        version: String::new(),
        description: None,
        ui_entry: String::new(),
        default_size: None,
        default_hide_title: None,
        default_scale: None,
        icon: None,
        permissions: Vec::new(),
        commands: Vec::new(),
        api_endpoints: Vec::new(),
        api_hash: None,
        format: PackageFormat::Runtime,
        contract_manifest: None,
    };

    let obj = match raw.as_object() {
        Some(o) => o,
        None => return (partial, Some("manifest_not_object".into())),
    };

    let id = match obj.get("id").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s,
        _ => return (partial, Some("missing_id".into())),
    };
    // An id is a storage namespace, a grant key and a url host. Anything that
    // is not a plain name is refused here rather than surprising one of those.
    //
    // Checked before the folder comparison, because a draft write renames the
    // folder to whatever the manifest declares: an id that still disagrees with
    // its folder is one the rename could not use, and that is what to say.
    if !drafts::is_valid_package_id(id) {
        return (partial, Some("invalid_package_id".into()));
    }
    if id != folder_name {
        return (partial, Some("id_folder_mismatch".into()));
    }
    partial.id = id.to_string();

    let name = match obj.get("name").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s,
        _ => return (partial, Some("missing_name".into())),
    };
    partial.name = name.to_string();

    let version = match obj.get("version").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s,
        _ => return (partial, Some("missing_version".into())),
    };
    partial.version = version.to_string();

    if let Some(d) = obj.get("description").and_then(|v| v.as_str()) {
        partial.description = Some(d.to_string());
    }

    // Optional catalog icon (mirrors FE: unsafe/bad ext fail; missing file → no icon).
    if let Some(icon_val) = obj.get("icon") {
        if let Some(icon) = icon_val.as_str() {
            if !icon.is_empty() {
                if let Err(e) = safe_join(package_root, icon) {
                    return (partial, Some(format!("unsafe_icon:{e}")));
                }
                let lower = icon.to_ascii_lowercase();
                if !(lower.ends_with(".svg") || lower.ends_with(".png")) {
                    return (partial, Some("invalid_icon_ext".into()));
                }
                if safe_join(package_root, icon)
                    .map(|p| p.is_file())
                    .unwrap_or(false)
                {
                    partial.icon = Some(icon.to_string());
                }
            }
        } else if !icon_val.is_null() {
            return (partial, Some("invalid_icon".into()));
        }
    }

    let ui = match obj.get("ui").and_then(|v| v.as_object()) {
        Some(u) => u,
        None => return (partial, Some("missing_ui".into())),
    };

    let entry = match ui.get("entry").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s,
        _ => return (partial, Some("missing_ui_entry".into())),
    };

    // Optional: a package without one falls back to the host's default, which is
    // what every package did before this was read at all.
    partial.default_size = ui
        .get("defaultSize")
        .and_then(|v| v.as_object())
        .and_then(|size| {
            let w = size.get("w").and_then(serde_json::Value::as_f64)?;
            let h = size.get("h").and_then(serde_json::Value::as_f64)?;
            (w > 0.0 && h > 0.0).then_some(WidgetSize { w, h })
        });
    // Same shape as `defaultSize`: optional, and a bad value falls back to the
    // host default rather than failing the package.
    partial.default_hide_title = ui.get("defaultHideTitle").and_then(Value::as_bool);
    partial.default_scale = ui
        .get("defaultScale")
        .and_then(Value::as_f64)
        .filter(|scale| scale.is_finite() && *scale > 0.0);
    // Path safety via safe_join (same rules as FE assertSafePackageRelativePath).
    if let Err(e) = safe_join(package_root, entry) {
        return (partial, Some(format!("unsafe_ui_entry:{e}")));
    }
    partial.ui_entry = entry.to_string();

    let offset = match ui.get("defaultOffset").and_then(|v| v.as_object()) {
        Some(o) => o,
        None => return (partial, Some("missing_default_offset".into())),
    };
    let x_ok = offset.get("x").and_then(|v| v.as_f64()).is_some();
    let y_ok = offset.get("y").and_then(|v| v.as_f64()).is_some();
    if !x_ok || !y_ok {
        return (partial, Some("invalid_default_offset".into()));
    }

    let commands = match obj.get("commands").and_then(|v| v.as_array()) {
        Some(arr) if arr.iter().all(|x| x.is_string()) => arr
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect::<Vec<_>>(),
        _ => return (partial, Some("invalid_commands".into())),
    };
    partial.commands = commands;

    // Credentials are a first-party contract: the host resolves secrets in Rust
    // and hands sandboxed packages nothing. A package that asks for them is
    // rejected rather than silently ignored (mirrored in the FE validator).
    if obj.contains_key("credentials") {
        return (partial, Some("credentials_not_supported".into()));
    }

    let permissions = match obj.get("permissions").and_then(|v| v.as_array()) {
        Some(arr) if arr.iter().all(|x| x.is_string()) => arr
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect::<Vec<_>>(),
        _ => return (partial, Some("invalid_permissions".into())),
    };
    for perm in &permissions {
        if !is_known_permission(perm) {
            return (partial, Some(format!("unknown_permission:{perm}")));
        }
        if perm == "backend.sidecar" {
            partial.permissions = permissions;
            return (partial, Some("sidecar_not_supported".into()));
        }
    }
    partial.permissions = permissions;

    // Entry file must exist on disk.
    match safe_join(package_root, entry) {
        Ok(entry_path) if entry_path.is_file() => {}
        Ok(_) => return (partial, Some("missing_ui_entry_file".into())),
        Err(e) => return (partial, Some(format!("unsafe_ui_entry:{e}"))),
    }

    // Declared HTTP endpoints (`api.json`) — the permission and the file must
    // agree, so neither an unannounced network capability nor a dead permission
    // can reach the consent dialog.
    match load_api_declaration(package_root, &partial.permissions) {
        Ok((summaries, hash)) => {
            partial.api_endpoints = summaries;
            partial.api_hash = hash;
        }
        Err(error) => return (partial, Some(error)),
    }

    (partial, None)
}

/// Hash of a declaration's exact bytes.
///
/// The consent record stores this, so a package cannot be enabled with one set
/// of endpoints and then quietly ship another: any edit changes the hash and the
/// grant stops matching.
pub fn declaration_hash(source: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(source.as_bytes());
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

/// Credential types the package's declaration references.
///
/// Read from disk, so a grant can only ever cover what the endpoints actually
/// ask for — the confirm step's list and this list come from the same bytes.
pub fn declared_credential_types(app: &AppHandle, ext_id: &str) -> Vec<String> {
    let Some(package_root) = package_root_for(app, ext_id) else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(package_root.join("api.json")) else {
        return Vec::new();
    };
    credential_types_of(&text)
}

/// Credential types referenced by a declaration's source. Invalid input yields
/// nothing, so a broken file can never widen a grant.
pub fn credential_types_of(source: &str) -> Vec<String> {
    let Ok(raw) = serde_json::from_str::<Value>(source) else {
        return Vec::new();
    };
    let Ok(declaration) = api_declaration::parse_api_declaration(&raw) else {
        return Vec::new();
    };
    let mut types: Vec<String> = declaration
        .endpoints
        .into_iter()
        .filter_map(|endpoint| endpoint.credential)
        .collect();
    types.sort();
    types.dedup();
    types
}

/// Current declaration hash of an installed package, if it has one.
pub fn current_api_hash(app: &AppHandle, ext_id: &str) -> Option<String> {
    let text = fs::read_to_string(package_root_for(app, ext_id)?.join("api.json")).ok()?;
    Some(declaration_hash(&text))
}

/// Reads and validates `api.json`, cross-checked against `network.declared`.
///
/// Returns the consent-facing endpoint summaries plus the declaration hash, or
/// a stable error code that puts the whole package into `error`.
fn load_api_declaration(
    package_root: &Path,
    permissions: &[String],
) -> Result<(Vec<api_declaration::EndpointSummary>, Option<String>), String> {
    let declared = permissions.iter().any(|perm| perm == NETWORK_DECLARED);
    let path = package_root.join("api.json");

    if !path.is_file() {
        // A granted permission with nothing behind it would show up in consent
        // as "may call endpoints" with an empty list.
        return if declared {
            Err("api_declaration_missing".into())
        } else {
            Ok((Vec::new(), None))
        };
    }

    // The file alone must never grant anything; the user consents to the
    // permission, not to a file appearing on disk.
    if !declared {
        return Err("api_permission_missing".into());
    }

    let text = fs::read_to_string(&path).map_err(|e| format!("api_read:{e}"))?;
    let raw: Value = serde_json::from_str(&text).map_err(|e| format!("api_json:{e}"))?;
    let declaration =
        api_declaration::parse_api_declaration(&raw).map_err(|e| format!("api:{e}"))?;
    Ok((declaration.summaries(), Some(declaration_hash(&text))))
}

/// Fields filled while validating (may be partial on error).
struct PartialScan {
    id: String,
    name: String,
    version: String,
    description: Option<String>,
    ui_entry: String,
    default_size: Option<WidgetSize>,
    default_hide_title: Option<bool>,
    default_scale: Option<f64>,
    icon: Option<String>,
    permissions: Vec<String>,
    commands: Vec<String>,
    api_endpoints: Vec<api_declaration::EndpointSummary>,
    api_hash: Option<String>,
    format: PackageFormat,
    contract_manifest: Option<Value>,
}

/// When a directory was last written, ms since the epoch.
///
/// Shared with the draft service, which uses it for drafts that carry no
/// authorship note. A filesystem date is a weak signal in general; for these two
/// directories it is exact, because both are only ever written by a publish.
pub(crate) fn folder_time(dir: &Path) -> Option<i64> {
    let modified = fs::metadata(dir).ok()?.modified().ok()?;
    let since = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(since.as_millis() as i64)
}

/// Build a scan row from partial fields + status/error.
fn scan_row(
    partial: &PartialScan,
    path: String,
    origin: PackageOrigin,
    status: &str,
    error: Option<String>,
) -> ScannedRuntimeExtension {
    // From the path rather than from a seventh argument threaded through six
    // call sites, all of which name the same directory this one does.
    let updated_at = folder_time(Path::new(&path));
    ScannedRuntimeExtension {
        id: partial.id.clone(),
        name: partial.name.clone(),
        version: partial.version.clone(),
        description: partial.description.clone(),
        path,
        ui_entry: partial.ui_entry.clone(),
        default_size: partial.default_size,
        default_hide_title: partial.default_hide_title,
        default_scale: partial.default_scale,
        icon: partial.icon.clone(),
        permissions: partial.permissions.clone(),
        commands: partial.commands.clone(),
        api_endpoints: partial.api_endpoints.clone(),
        api_hash: partial.api_hash.clone(),
        format: partial.format,
        contract_manifest: partial.contract_manifest.clone(),
        updated_at,
        origin,
        status: status.into(),
        error,
    }
}

fn scan_package_dir(
    folder_name: &str,
    package_root: &Path,
    origin: PackageOrigin,
) -> ScannedRuntimeExtension {
    let path_str =
        path_to_string(package_root).unwrap_or_else(|_| package_root.display().to_string());
    let empty = PartialScan {
        id: folder_name.to_string(),
        name: String::new(),
        version: String::new(),
        description: None,
        ui_entry: String::new(),
        default_size: None,
        default_hide_title: None,
        default_scale: None,
        icon: None,
        permissions: Vec::new(),
        commands: Vec::new(),
        api_endpoints: Vec::new(),
        api_hash: None,
        // A directory whose manifest could not be read is a broken runtime
        // package, not a contract one: the discriminator lives *in* the file,
        // so no file means no claim to the other format.
        format: PackageFormat::Runtime,
        contract_manifest: None,
    };

    let manifest_path = package_root.join("manifest.json");
    if !manifest_path.is_file() {
        return scan_row(
            &empty,
            path_str,
            origin,
            "error",
            Some("missing_manifest".into()),
        );
    }

    let text = match fs::read_to_string(&manifest_path) {
        Ok(t) => t,
        Err(e) => {
            return scan_row(
                &empty,
                path_str,
                origin,
                "error",
                Some(format!("manifest_read:{e}")),
            );
        }
    };

    let raw: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            return scan_row(
                &empty,
                path_str,
                origin,
                "error",
                Some(format!("manifest_json:{e}")),
            );
        }
    };

    // The same fork the draft path takes. An installed contract package was
    // still read as a runtime one, so a correct package sat in Settings →
    // Extensions saying `missing_id` — the field it is right not to have.
    if raw.get("widget").map(|w| w.is_object()).unwrap_or(false) {
        let (partial, api_error) = contract_partial(folder_name, package_root, &raw);
        // The package's own rules first: a broken `index.html` is a worse
        // failure than a broken `api.json`, and reporting the second while the
        // first is true would send somebody to the wrong file.
        return match contract_draft_error(folder_name, package_root).or(api_error) {
            Some(error) => scan_row(&partial, path_str, origin, "error", Some(error)),
            None => scan_row(&partial, path_str, origin, "ready", None),
        };
    }

    let (partial, err) = validate_manifest_on_disk(folder_name, package_root, &raw);
    match err {
        Some(error) => scan_row(&partial, path_str, origin, "error", Some(error)),
        None => scan_row(&partial, path_str, origin, "ready", None),
    }
}

/// Scan-row fields for a contract package.
///
/// A contract package's *account* grants are the user's, in a different
/// vocabulary from the runtime catalog, and listing them here would put them
/// through the wrong consent dialog — the one place a wrong answer actually
/// grants something. Declared HTTP endpoints are the opposite: they are exactly
/// the runtime catalog's vocabulary, and they now travel the same path.
///
/// `network.declared` is **derived from the file's presence**, not read from
/// the manifest. A contract manifest has no `permissions` array to state it in,
/// and inventing one would mean a package could ask for the permission without
/// shipping the declaration it is about. Here the two cannot disagree: an
/// `api.json` is the request, and there is nothing else to write.
fn contract_partial(
    folder_name: &str,
    package_root: &Path,
    raw: &Value,
) -> (PartialScan, Option<String>) {
    let string = |key: &str| {
        raw.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };
    // Read with the permission the file itself implies, so `load_api_declaration`
    // does not refuse it for a permission a contract manifest cannot carry.
    //
    // The error is CARRIED, not swallowed. It was `.ok()` here, and that one
    // call cost an evening: a malformed `api.json` became "no api.json", which
    // became "no `network.declared`", which became `permission_denied` at the
    // call — a message about a permission, for a file with a typo in it. Every
    // layer behaved correctly on the answer it was given, and the answer was
    // wrong at the first one.
    //
    // Claimed only when the file is actually there: `load_api_declaration`
    // enforces that the permission and the file agree, so passing the
    // permission for a package with no `api.json` reports the *absence* as an
    // error. Most contract widgets ship none, and none of them is broken.
    let declaration = if package_root.join("api.json").exists() {
        load_api_declaration(package_root, &[NETWORK_DECLARED.to_string()])
    } else {
        Ok((Vec::new(), None))
    };
    let endpoints = declaration
        .as_ref()
        .ok()
        .filter(|(summaries, _)| !summaries.is_empty())
        .cloned();

    let partial = PartialScan {
        id: folder_name.to_string(),
        name: string("displayName"),
        version: string("version"),
        description: raw
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        // Always, and not named anywhere: the format has three files.
        ui_entry: "index.html".to_string(),
        default_size: None,
        default_hide_title: None,
        default_scale: None,
        icon: None,
        permissions: endpoints
            .as_ref()
            .map(|_| vec![NETWORK_DECLARED.to_string()])
            .unwrap_or_default(),
        commands: Vec::new(),
        api_endpoints: endpoints
            .clone()
            .map(|(summaries, _)| summaries)
            .unwrap_or_default(),
        api_hash: endpoints.and_then(|(_, hash)| hash),
        format: PackageFormat::Contract,
        // The bytes the checks below are about. The approval dialog and the
        // loader both read this and never the file again.
        contract_manifest: Some(raw.clone()),
    };

    (
        partial,
        declaration.err().map(|error| format!("api_json:{error}")),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Temporary package root holding a valid `ui/index.html` entry.
    fn temp_package() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("kavibay_manifest_{}_{}", std::process::id(), nanos));
        fs::create_dir_all(dir.join("ui")).unwrap();
        fs::write(dir.join("ui/index.html"), "<!doctype html>").unwrap();
        dir
    }

    fn manifest(extra: Value) -> Value {
        let mut base = serde_json::json!({
            "id": "demo",
            "name": "Demo",
            "version": "1.0.0",
            "ui": { "entry": "ui/index.html", "defaultOffset": { "x": 0, "y": 0 } },
            "commands": [],
            "permissions": [],
        });
        if let (Some(base_obj), Some(extra_obj)) = (base.as_object_mut(), extra.as_object()) {
            for (key, value) in extra_obj {
                base_obj.insert(key.clone(), value.clone());
            }
        }
        base
    }

    #[test]
    fn valid_manifest_passes() {
        let root = temp_package();
        let (_, error) = validate_manifest_on_disk("demo", &root, &manifest(Value::Null));
        assert_eq!(error, None);
        let _ = fs::remove_dir_all(&root);
    }

    /// `defaultHideTitle` / `defaultScale` reach the FE, so a package can open
    /// chromeless and zoomed the way a first-party widget can.
    #[test]
    fn default_chrome_and_scale_are_carried() {
        let root = temp_package();
        let raw = manifest(serde_json::json!({
            "ui": {
                "entry": "ui/index.html",
                "defaultOffset": { "x": 0, "y": 0 },
                "defaultHideTitle": true,
                "defaultScale": 1.5,
            },
        }));
        let (partial, error) = validate_manifest_on_disk("demo", &root, &raw);
        assert_eq!(error, None);
        assert_eq!(partial.default_hide_title, Some(true));
        assert_eq!(partial.default_scale, Some(1.5));
        let _ = fs::remove_dir_all(&root);
    }

    /// A nonsense scale falls back to the host default instead of failing the
    /// package — same treatment `defaultSize` already gets.
    #[test]
    fn non_positive_default_scale_is_dropped() {
        let root = temp_package();
        let raw = manifest(serde_json::json!({
            "ui": {
                "entry": "ui/index.html",
                "defaultOffset": { "x": 0, "y": 0 },
                "defaultScale": 0,
            },
        }));
        let (partial, error) = validate_manifest_on_disk("demo", &root, &raw);
        assert_eq!(error, None);
        assert_eq!(partial.default_scale, None);
        let _ = fs::remove_dir_all(&root);
    }

    /// Credentials are a first-party contract: a sandboxed package that asks for
    /// them must be rejected, not silently ignored (mirrored in the FE
    /// validator — AGENTS.md invariant 4).
    #[test]
    fn credential_declarations_are_rejected() {
        let root = temp_package();
        let raw = manifest(serde_json::json!({
            "credentials": [{ "type": "githubPat", "required": true }],
        }));
        let (_, error) = validate_manifest_on_disk("demo", &root, &raw);
        assert_eq!(error.as_deref(), Some("credentials_not_supported"));
        let _ = fs::remove_dir_all(&root);
    }

    /// Even an empty list is a request for credential access.
    #[test]
    fn empty_credential_list_is_still_rejected() {
        let root = temp_package();
        let raw = manifest(serde_json::json!({ "credentials": [] }));
        let (_, error) = validate_manifest_on_disk("demo", &root, &raw);
        assert_eq!(error.as_deref(), Some("credentials_not_supported"));
        let _ = fs::remove_dir_all(&root);
    }

    fn write_api_json(root: &Path, body: Value) {
        fs::write(root.join("api.json"), body.to_string()).unwrap();
    }

    fn weather_declaration() -> Value {
        serde_json::json!({
            "schemaVersion": 1,
            "endpoints": [{
                "id": "forecast",
                "description": "Reads the current temperature from Open-Meteo.",
                "method": "GET",
                "url": "https://api.open-meteo.com/v1/forecast"
            }]
        })
    }

    fn row(id: &str, origin: PackageOrigin, status: &str) -> ScannedRuntimeExtension {
        ScannedRuntimeExtension {
            id: id.into(),
            name: id.into(),
            version: "1.0.0".into(),
            description: None,
            path: format!("/{}/{id}", origin.dir_name()),
            ui_entry: "ui/index.html".into(),
            default_size: None,
            default_hide_title: None,
            default_scale: None,
            icon: None,
            permissions: Vec::new(),
            commands: Vec::new(),
            api_endpoints: Vec::new(),
            api_hash: None,
            format: PackageFormat::Runtime,
            contract_manifest: None,
            updated_at: None,
            origin,
            status: status.into(),
            error: None,
        }
    }

    #[test]
    fn roots_are_separate_directories() {
        assert_eq!(PackageOrigin::Installed.dir_name(), "extensions");
        assert_eq!(PackageOrigin::Custom.dir_name(), "extensions-custom");
        assert_eq!(PackageOrigin::all().len(), 2);
    }

    /// The resolver is the only place that turns an id into a path, so its id
    /// rules are the ones that matter.
    #[test]
    fn the_resolver_finds_a_package_in_either_root() {
        let installed = temp_package();
        let custom = temp_package();
        let roots = vec![installed.clone(), custom.clone()];

        fs::create_dir_all(installed.join("alpha")).unwrap();
        fs::create_dir_all(custom.join("beta")).unwrap();

        assert_eq!(
            resolve_in_roots(&roots, "alpha"),
            Some(installed.join("alpha"))
        );
        assert_eq!(resolve_in_roots(&roots, "beta"), Some(custom.join("beta")));
        assert_eq!(resolve_in_roots(&roots, "gamma"), None);

        let _ = fs::remove_dir_all(&installed);
        let _ = fs::remove_dir_all(&custom);
    }

    /// The installed root wins a name clash here, but the scan refuses both —
    /// this only fixes which path a *lookup* returns while that error stands.
    #[test]
    fn the_resolver_prefers_the_installed_root() {
        let installed = temp_package();
        let custom = temp_package();
        let roots = vec![installed.clone(), custom.clone()];
        fs::create_dir_all(installed.join("clash")).unwrap();
        fs::create_dir_all(custom.join("clash")).unwrap();

        assert_eq!(
            resolve_in_roots(&roots, "clash"),
            Some(installed.join("clash"))
        );

        let _ = fs::remove_dir_all(&installed);
        let _ = fs::remove_dir_all(&custom);
    }

    /// A dot id would reach into `.drafts`, which is the one directory the
    /// draft namespace relies on staying unreachable.
    #[test]
    fn the_resolver_rejects_ids_that_are_not_plain_directory_names() {
        let root = temp_package();
        let roots = vec![root.clone()];
        fs::create_dir_all(root.join(".drafts")).unwrap();

        assert_eq!(resolve_in_roots(&roots, ".drafts"), None);
        assert_eq!(resolve_in_roots(&roots, ""), None);
        assert_eq!(resolve_in_roots(&roots, "a/b"), None);
        assert_eq!(resolve_in_roots(&roots, "a\\b"), None);
        assert_eq!(resolve_in_roots(&roots, ".."), None);
        // A drive-relative id escapes the root on Windows (the cwd is a dir).
        assert_eq!(resolve_in_roots(&roots, "C:"), None);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_duplicate_id_fails_both_copies() {
        let rows = mark_duplicate_ids(vec![
            row("alpha", PackageOrigin::Installed, "ready"),
            row("clash", PackageOrigin::Installed, "ready"),
            row("clash", PackageOrigin::Custom, "ready"),
        ]);

        let clashes: Vec<_> = rows.iter().filter(|row| row.id == "clash").collect();
        assert_eq!(clashes.len(), 2);
        for row in clashes {
            assert_eq!(row.status, "error");
            assert_eq!(row.error.as_deref(), Some("duplicate_id_across_roots"));
        }

        let alpha = rows.iter().find(|row| row.id == "alpha").unwrap();
        assert_eq!(alpha.status, "ready", "unrelated packages are untouched");
    }

    /// A grant may only ever cover what the endpoints actually reference.
    #[test]
    fn credential_types_come_from_the_declaration() {
        let declaration = serde_json::json!({
            "schemaVersion": 1,
            "endpoints": [
                {
                    "id": "runs",
                    "description": "Reads workflow runs.",
                    "method": "GET",
                    "url": "https://api.github.com/user/repos",
                    "credential": "githubPat"
                },
                {
                    "id": "again",
                    "description": "Reads them once more.",
                    "method": "GET",
                    "url": "https://api.github.com/user",
                    "credential": "githubPat"
                },
                {
                    "id": "open",
                    "description": "Reads a public forecast.",
                    "method": "GET",
                    "url": "https://api.open-meteo.com/v1/forecast"
                }
            ]
        })
        .to_string();

        assert_eq!(credential_types_of(&declaration), vec!["githubPat"]);
        assert!(credential_types_of("not json").is_empty());
        assert!(credential_types_of(&weather_declaration().to_string()).is_empty());
    }

    /// The hash is what consent is *about*, so any edit has to change it.
    #[test]
    fn the_declaration_hash_covers_every_byte() {
        let base = weather_declaration().to_string();
        assert_eq!(declaration_hash(&base), declaration_hash(&base));

        let edited = base.replace("api.open-meteo.com", "api.evil.example.com");
        assert_ne!(declaration_hash(&base), declaration_hash(&edited));

        // Even a change that does not alter meaning changes the hash — better a
        // needless re-consent than a missed one.
        assert_ne!(
            declaration_hash(&base),
            declaration_hash(&format!("{base} "))
        );
    }

    #[test]
    fn the_scan_row_carries_the_declaration_hash() {
        let root = temp_package();
        write_api_json(&root, weather_declaration());
        let raw = manifest(serde_json::json!({ "permissions": ["network.declared"] }));

        let (partial, error) = validate_manifest_on_disk("demo", &root, &raw);
        assert_eq!(error, None);
        assert_eq!(
            partial.api_hash.as_deref(),
            Some(declaration_hash(&weather_declaration().to_string()).as_str())
        );
        let _ = fs::remove_dir_all(&root);
    }

    /// A package without declared endpoints has nothing to consent to.
    #[test]
    fn no_declaration_means_no_hash() {
        let root = temp_package();
        let (partial, error) = validate_manifest_on_disk("demo", &root, &manifest(Value::Null));
        assert_eq!(error, None);
        assert_eq!(partial.api_hash, None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn declared_endpoints_reach_the_scan_row() {
        let root = temp_package();
        write_api_json(&root, weather_declaration());
        let raw = manifest(serde_json::json!({ "permissions": ["network.declared"] }));

        let (partial, error) = validate_manifest_on_disk("demo", &root, &raw);
        assert_eq!(error, None);
        assert_eq!(partial.api_endpoints.len(), 1);
        assert_eq!(partial.api_endpoints[0].hosts, vec!["api.open-meteo.com"]);
        let _ = fs::remove_dir_all(&root);
    }

    /// A file appearing on disk must never grant a capability the user did not
    /// see in the consent dialog.
    #[test]
    fn api_json_without_the_permission_is_rejected() {
        let root = temp_package();
        write_api_json(&root, weather_declaration());
        let (_, error) = validate_manifest_on_disk("demo", &root, &manifest(Value::Null));
        assert_eq!(error.as_deref(), Some("api_permission_missing"));
        let _ = fs::remove_dir_all(&root);
    }

    /// The mirror case: consent would promise endpoints that do not exist.
    #[test]
    fn permission_without_api_json_is_rejected() {
        let root = temp_package();
        let raw = manifest(serde_json::json!({ "permissions": ["network.declared"] }));
        let (_, error) = validate_manifest_on_disk("demo", &root, &raw);
        assert_eq!(error.as_deref(), Some("api_declaration_missing"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_broken_declaration_fails_the_whole_package() {
        let root = temp_package();
        write_api_json(
            &root,
            serde_json::json!({
                "schemaVersion": 1,
                "endpoints": [{
                    "id": "forecast",
                    "description": "Calls a plain-http host.",
                    "method": "GET",
                    "url": "http://api.open-meteo.com/v1/forecast"
                }]
            }),
        );
        let raw = manifest(serde_json::json!({ "permissions": ["network.declared"] }));
        let (_, error) = validate_manifest_on_disk("demo", &root, &raw);
        assert_eq!(error.as_deref(), Some("api:url_not_https"));
        let _ = fs::remove_dir_all(&root);
    }
}

/// Return `{data_dir}/extensions` (creates dir if missing).
#[tauri::command]
pub fn runtime_extensions_root(app: AppHandle) -> Result<String, String> {
    let dir = extensions_root_path(&app)?;
    path_to_string(&dir)
}

/// Return the custom package root, where the wizard writes.
#[tauri::command]
pub fn runtime_extensions_custom_root(app: AppHandle) -> Result<String, String> {
    let dir = root_path(&app, PackageOrigin::Custom)?;
    path_to_string(&dir)
}

/// Validation verdict for a directory that is not (yet) a package in a root.
///
/// Runs the *same* chain the package list runs, so a draft cannot pass here and
/// fail after promotion — and an authoring agent sees the codes it will be
/// judged by.
pub(crate) fn scan_package_dir_for_draft(folder_name: &str, package_root: &Path) -> Option<String> {
    // Two package formats share this directory, and the manifest says which.
    // Without the fork a correct contract package is reported as `missing_id`,
    // which names the one field it is right not to have.
    if is_contract_manifest(package_root) {
        return contract_draft_error(folder_name, package_root);
    }
    scan_package_dir(folder_name, package_root, PackageOrigin::Custom).error
}

/// True when the manifest is a contract package rather than a runtime package.
///
/// `widget` is the discriminator, not the absence of `id`: a manifest missing
/// its id is a broken runtime package and must still be reported as one, rather
/// than silently becoming a different format that happens to fail differently.
fn is_contract_manifest(package_root: &Path) -> bool {
    let Ok(text) = fs::read_to_string(package_root.join("manifest.json")) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|raw| raw.get("widget").map(|w| w.is_object()))
        .unwrap_or(false)
}

/// Why a contract draft cannot load, or `None` when it can.
///
/// The checks are the ones whose failures are invisible. A missing mount point,
/// a module script or a missing runtime tag all produce a frame that loads,
/// renders nothing, and reports no error anywhere a person looks — so they are
/// worth catching here, where the wizard can show them next to the files.
fn contract_draft_error(folder_name: &str, package_root: &Path) -> Option<String> {
    let text = fs::read_to_string(package_root.join("manifest.json")).ok()?;
    let raw: serde_json::Value = serde_json::from_str(&text).ok()?;

    match raw.get("name").and_then(|v| v.as_str()) {
        Some(name) if name == folder_name => {}
        // A write moves the folder to whatever the manifest names, so the two
        // can only still differ when that name is not a directory name at all.
        // Reporting the mismatch there sends the author to rename the folder —
        // the one thing that would not help.
        Some(name) if !drafts::is_valid_package_id(name) => {
            return Some("invalid_package_id".into())
        }
        Some(_) => return Some("name_folder_mismatch".into()),
        None => return Some("missing_name".into()),
    }
    if raw.get("displayName").and_then(|v| v.as_str()).is_none() {
        return Some("missing_display_name".into());
    }
    if raw
        .get("engines")
        .and_then(|e| e.get("kavibay"))
        .and_then(|v| v.as_str())
        .is_none()
    {
        return Some("missing_engine_range".into());
    }
    if raw
        .get("widget")
        .and_then(|w| w.get("name"))
        .and_then(|v| v.as_str())
        .is_none()
    {
        return Some("missing_widget_name".into());
    }

    let Ok(html) = fs::read_to_string(package_root.join("index.html")) else {
        return Some("missing_index_html".into());
    };
    if !package_root.join("widget.js").is_file() {
        return Some("missing_widget_js".into());
    }
    // Comments are prose, not markup, and every check below is about markup.
    // The example package — the document authors copy and the generator is
    // shown — explains the module-script rule in a comment, quoting the exact
    // string, and was therefore refused for following the rule it documents.
    // Stripping first also makes the two positive checks stricter, which is
    // right: a mount point that exists only inside a comment is not one.
    let html = strip_html_comments(&html);
    if !html.contains("id=\"kavibay-widget\"") {
        return Some("missing_mount_point".into());
    }
    if !html.contains("@kavibay/contract.js") {
        return Some("missing_contract_runtime".into());
    }
    // Finding 17: an opaque origin makes a module script a cross-origin fetch,
    // so it never loads and nothing says so.
    if html.contains("type=\"module\"") {
        return Some("module_script".into());
    }
    None
}

/// Drops `<!-- … -->` spans, so a rule stated in prose is not read as markup.
///
/// The frontend guard (`scripts/extensionHostSandboxGuard.assert.mjs`) has done
/// this since it was written, which is exactly why the disagreement was
/// invisible: the assert was green on the very package the scanner refused.
/// Two implementations of one rule need the same notion of what the input is.
fn strip_html_comments(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        rest = match rest[start..].find("-->") {
            // An unterminated comment runs to the end of the file, which is how
            // a browser reads it too.
            None => return out,
            Some(end) => &rest[start + end + 3..],
        };
    }
    out.push_str(rest);
    out
}

/// Scan one root's child directories into rows.
fn scan_root<R: Runtime>(
    app: &AppHandle<R>,
    origin: PackageOrigin,
) -> Vec<ScannedRuntimeExtension> {
    let Ok(root) = root_path(app, origin) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        if !entry.metadata().map(|meta| meta.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(folder_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        // Skip hidden / dot dirs — this is what keeps `.drafts/` out of the
        // list, and out of the palette, without any extra state.
        if folder_name.starts_with('.') {
            continue;
        }
        out.push(scan_package_dir(&folder_name, &entry.path(), origin));
    }
    out
}

/// Scan every root; invalid packages → status error.
///
/// Ids stay a single flat namespace across roots: a duplicate is rejected rather
/// than silently shadowed, because storage keys, grants, rate limits and the
/// `kavibay-ext://<id>/` url are all keyed by id alone.
#[tauri::command]
pub fn runtime_extensions_scan(app: AppHandle) -> Result<Vec<ScannedRuntimeExtension>, String> {
    scan_all(&app)
}

/// Shared scan surface for host adapters. The Tauri command above remains the
/// concrete webview boundary, while MCP can use the same filtered rows with
/// its runtime type without exposing paths to its own DTOs.
pub(crate) fn scan_all<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<ScannedRuntimeExtension>, String> {
    let mut rows: Vec<ScannedRuntimeExtension> = Vec::new();
    for origin in PackageOrigin::all() {
        rows.extend(scan_root(app, origin));
    }

    let mut rows = mark_duplicate_ids(rows);
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(rows)
}

/// Fails every package whose id appears in more than one root.
///
/// Both copies are refused, not just the later one: which copy "wins" would
/// otherwise depend on scan order, and both would share one set of grants, one
/// storage namespace and one `kavibay-ext://<id>/` url.
fn mark_duplicate_ids(mut rows: Vec<ScannedRuntimeExtension>) -> Vec<ScannedRuntimeExtension> {
    let duplicated: Vec<String> = rows
        .iter()
        .filter(|row| rows.iter().filter(|other| other.id == row.id).count() > 1)
        .map(|row| row.id.clone())
        .collect();

    for row in rows.iter_mut() {
        if duplicated.contains(&row.id) {
            row.status = "error".into();
            row.error = Some("duplicate_id_across_roots".into());
        }
    }
    rows
}

#[cfg(test)]
mod contract_draft_tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Same pattern the file_search tests use: this crate has no tempfile dep,
    /// and adding one for four tests is not worth the supply chain.
    fn temp_dir() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("kavibay_contract_draft_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A package the wizard actually produced, minus the parts these checks do
    /// not read. It was reported as `missing_id` — the one field a contract
    /// manifest is right not to have.
    fn write_good(dir: &std::path::Path, folder: &str) {
        fs::write(
            dir.join("manifest.json"),
            format!(
                r#"{{"name":"{folder}","version":"1.0.0","displayName":"Luftfeuchtigkeit",
                   "engines":{{"kavibay":"^0.1"}},"widget":{{"name":"tile"}}}}"#
            ),
        )
        .unwrap();
        fs::write(
            dir.join("index.html"),
            r#"<div id="kavibay-widget"></div><script src="@kavibay/contract.js"></script><script src="widget.js"></script>"#,
        )
        .unwrap();
        fs::write(dir.join("widget.js"), "kavibayWidget.define({});").unwrap();
    }

    #[test]
    fn a_correct_contract_draft_passes() {
        let tmp = temp_dir();
        write_good(tmp.as_path(), "dasd");
        assert_eq!(
            super::scan_package_dir_for_draft("dasd", tmp.as_path()),
            None
        );
    }

    /// The discriminator is `widget`, not the absence of `id`: a runtime package
    /// that forgot its id must still be reported as one.
    #[test]
    fn a_runtime_package_without_an_id_is_still_a_runtime_package() {
        let tmp = temp_dir();
        fs::write(tmp.as_path().join("manifest.json"), r#"{"name":"x"}"#).unwrap();
        assert_eq!(
            super::scan_package_dir_for_draft("x", tmp.as_path()),
            Some("missing_id".into())
        );
    }

    /// Each of these loads, renders nothing, and reports no error anywhere a
    /// person looks — which is exactly why they are worth catching here.
    #[test]
    fn the_silent_failures_are_named() {
        let cases: [(&str, &str, &str); 3] = [
            (
                "missing_mount_point",
                r#"<script src="@kavibay/contract.js"></script>"#,
                "no #kavibay-widget to fill",
            ),
            (
                "missing_contract_runtime",
                r#"<div id="kavibay-widget"></div><script src="widget.js"></script>"#,
                "kavibayWidget is never defined",
            ),
            (
                "module_script",
                r#"<div id="kavibay-widget"></div><script type="module" src="@kavibay/contract.js"></script>"#,
                "a module never loads under an opaque origin",
            ),
        ];
        for (expected, html, why) in cases {
            let tmp = temp_dir();
            write_good(tmp.as_path(), "d");
            fs::write(tmp.as_path().join("index.html"), html).unwrap();
            assert_eq!(
                super::scan_package_dir_for_draft("d", tmp.as_path()),
                Some(expected.into()),
                "{why}"
            );
        }
    }

    /// The document authors copy, put through the checker authors are judged
    /// by. It was refused as `module_script` because its comment explains the
    /// module-script rule and quotes the string — so the smallest, most-copied
    /// package in the repo could not be installed at all, while the frontend
    /// guard for the same rule stayed green because it strips comments first.
    #[test]
    fn the_example_package_passes_its_own_checker() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("sdk")
            .join("extension")
            .join("contract")
            .join("example-package");
        assert!(
            root.is_dir(),
            "the example package moved: {}",
            root.display()
        );
        assert_eq!(
            super::scan_package_dir_for_draft("counter", &root),
            None,
            "the package every author copies has to survive the scan"
        );
    }

    /// Prose is not markup, in both directions.
    #[test]
    fn comments_are_not_read_as_markup() {
        let tmp = temp_dir();
        write_good(tmp.as_path(), "d");
        let mount =
            r#"<div id="kavibay-widget"></div><script src="@kavibay/contract.js"></script>"#;

        fs::write(
            tmp.join("index.html"),
            format!("<!-- never write type=\"module\" here -->{mount}"),
        )
        .unwrap();
        assert_eq!(
            super::scan_package_dir_for_draft("d", tmp.as_path()),
            None,
            "a comment quoting the rule is not a violation of it"
        );

        fs::write(
            tmp.join("index.html"),
            format!("<!-- {mount} --><script src=\"widget.js\"></script>"),
        )
        .unwrap();
        assert_eq!(
            super::scan_package_dir_for_draft("d", tmp.as_path()),
            Some("missing_mount_point".into()),
            "and a mount point that exists only inside a comment is not one"
        );

        let _ = fs::remove_dir_all(tmp);
    }

    /// The installed scan takes the same fork. Without it a correct contract
    /// package sits in Settings saying missing_id, which is where this was
    /// found — after the draft path was already fixed.
    #[test]
    fn an_installed_contract_package_scans_as_one() {
        let tmp = temp_dir();
        write_good(tmp.as_path(), "dasd");
        let row = super::scan_package_dir("dasd", tmp.as_path(), super::PackageOrigin::Custom);
        assert_eq!(row.error, None, "no error");
        assert_eq!(row.status, "ready");
        assert_eq!(
            row.ui_entry, "index.html",
            "the entry is not named in the manifest"
        );
        assert_eq!(
            row.name, "Luftfeuchtigkeit",
            "the display name is the row name"
        );
        assert!(
            row.permissions.is_empty(),
            "a contract grant must not travel through the runtime consent list"
        );
        assert_eq!(
            row.format,
            super::PackageFormat::Contract,
            "the row has to say which format it is, or the host embeds it with the wrong frame"
        );
        assert_eq!(
            row.contract_manifest
                .as_ref()
                .and_then(|raw| raw.get("displayName"))
                .and_then(|value| value.as_str()),
            Some("Luftfeuchtigkeit"),
            "the manifest travels with the row, so the dialog and the loader read the same bytes"
        );
    }

    /// The other half of the fork, and the one that must not move: a runtime
    /// package is still a runtime package, and nothing about it is a contract
    /// manifest.
    #[test]
    fn a_runtime_package_is_still_reported_as_one() {
        let tmp = temp_dir();
        fs::create_dir_all(tmp.join("ui")).unwrap();
        fs::write(tmp.join("ui/index.html"), "<!doctype html>").unwrap();
        fs::write(
            tmp.join("manifest.json"),
            r#"{"id":"plain","name":"Plain","version":"1.0.0","ui":{"entry":"ui/index.html"}}"#,
        )
        .unwrap();
        let row = super::scan_package_dir("plain", tmp.as_path(), super::PackageOrigin::Custom);
        assert_eq!(row.format, super::PackageFormat::Runtime);
        assert_eq!(row.contract_manifest, None);
    }

    #[test]
    fn the_manifest_must_name_its_own_folder() {
        let tmp = temp_dir();
        write_good(tmp.as_path(), "elsewhere");
        assert_eq!(
            super::scan_package_dir_for_draft("dasd", tmp.as_path()),
            Some("name_folder_mismatch".into())
        );
    }
}
