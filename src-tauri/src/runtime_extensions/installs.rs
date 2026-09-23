//! Rust-owned record of which runtime packages are enabled and what they were
//! granted.
//!
//! Design: `docs/superpowers/specs/2026-08-01-declarative-http-api-design.md` §8.
//!
//! These records used to live in `localStorage`. That is fine while the only
//! consumer is the frontend deciding what to render — but Rust builds the HTTP
//! requests for declared endpoints, and **Rust must not ask the frontend for
//! permission**. A compromised or merely buggy renderer could otherwise grant
//! itself a capability by writing one key. So the grant moves to a file only the
//! backend writes, and the frontend becomes a view of it.
//!
//! Storing it next to the packages (`{data_dir}/extensions/installs.json`)
//! also fixes an old papercut: clearing the webview profile silently wiped every
//! grant.

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::extensions_root_path;
use super::http::RuntimeHttpState;
use super::limits::{clamp_daily_budget, DEFAULT_DAILY_BUDGET};

/// Permissions that may be granted when a user enables a ready package.
///
/// `backend.sidecar` is catalogued but never grantable (no sidecars yet), and
/// `network.client` (raw fetch) stays reserved and unimplemented — see the
/// design, section 3.
const GRANTABLE: &[&str] = &["storage.instance", "network.declared"];

/// What a contract package was allowed to read.
///
/// A separate vocabulary from `granted_permissions`, deliberately: that list is
/// the runtime catalogue (`storage.instance`, `network.declared`) and a query
/// name put through it would be dropped as unknown. The two consent screens ask
/// different questions and neither answer belongs in the other's field.
///
/// **There is no `actions` field.** Approving an account approves its actions
/// too (FINDINGS §27). A shape that cannot hold a per-action list cannot be
/// edited into a second grant. The frontend's `grantFrom` makes the same
/// decision the same way, by not taking actions as a parameter.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractGrant {
    /// Which accounts the person approved this widget for.
    ///
    /// The whole answer now. Per-query grants are gone (FINDINGS §27): what a
    /// person decides is which accounts a widget may use. Provider actions on
    /// those accounts run through `Host.action`.
    #[serde(default)]
    pub approved: Vec<String>,
    /// Two older spellings, read and never written. `migrate` folds them into
    /// `approved` on load, so the file rewrites itself the first time anything
    /// else changes.
    ///
    /// Dropping them would not have failed loudly. The grant would parse as
    /// empty, the package would load approved for nothing and render blank —
    /// the exact silent failure the loader was written to stop producing.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub providers: Vec<ContractProviderGrant>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub queries: Vec<String>,
}

/// One provider's per-query grant, from a record written before §27.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractProviderGrant {
    pub provider: String,
    pub queries: Vec<String>,
}

impl ContractGrant {
    /// Folds every older spelling into `approved`. Idempotent.
    ///
    /// The query lists are dropped rather than carried: approving a provider is
    /// the wider answer, and asking somebody again for something they already
    /// answered more narrowly is the interruption `askedNothingNew` exists to
    /// avoid.
    pub fn migrated(mut self) -> Self {
        for row in std::mem::take(&mut self.providers) {
            if !self.approved.contains(&row.provider) {
                self.approved.push(row.provider);
            }
        }
        if let Some(provider) = self.provider.take() {
            if !self.approved.contains(&provider) {
                self.approved.push(provider);
            }
        }
        self.queries.clear();
        self
    }
}

/// One package's install state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRecord {
    pub id: String,
    pub enabled: bool,
    /// Permissions the user actually consented to — not what the manifest asked
    /// for.
    pub granted_permissions: Vec<String>,
    /// The answer to the contract package's approval dialog, or `None` when the
    /// package is not one / was never approved.
    ///
    /// `None` is not "allow nothing" — it is "never asked", and the loader
    /// refuses to build a manifest at all without a grant. That is the same
    /// shape `widgetPackageManifest` has on the frontend, where the grant is a
    /// required argument rather than a defaulted one.
    #[serde(default)]
    pub contract_grant: Option<ContractGrant>,
    /// Hash of the `api.json` shown at consent time. A package that edits its
    /// declaration afterwards no longer matches, and its calls stop until the
    /// user has seen the new endpoints and re-enabled it.
    #[serde(default)]
    pub api_hash: Option<String>,
    /// Credential **types** this package may have injected into its declared
    /// requests. Owning a credential is not the same as sharing it, so this is
    /// granted per package and separately from the permission itself.
    #[serde(default)]
    pub granted_credentials: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallsFile {
    #[serde(default)]
    installs: Vec<InstallRecord>,
    /// Calls one package may make per UTC day. `None` means the default —
    /// an older file simply does not have the field yet.
    #[serde(default)]
    daily_budget: Option<u32>,
}

/// True when `permission` may be handed out at enable time.
pub fn is_grantable(permission: &str) -> bool {
    GRANTABLE.contains(&permission)
}

/// Keeps only permissions that are both requested by the manifest and grantable.
///
/// The intersection is the point: a manifest cannot widen the catalogue, and a
/// stored record cannot grant something the package no longer asks for.
pub fn grantable_from_manifest(manifest_permissions: &[String]) -> Vec<String> {
    let mut out: Vec<String> = manifest_permissions
        .iter()
        .filter(|permission| is_grantable(permission))
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    out.sort();
    out
}

fn installs_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(extensions_root_path(app)?.join("installs.json"))
}

/// Reads the install records. A missing or unreadable file means "nothing is
/// installed", never "everything is allowed".
pub fn load(app: &AppHandle) -> Result<Vec<InstallRecord>, String> {
    let path = installs_path(app)?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    Ok(normalize(read_file(app)?.installs))
}

/// Reads the whole file (records + settings), tolerating a corrupt one.
fn read_file(app: &AppHandle) -> Result<InstallsFile, String> {
    let path = installs_path(app)?;
    if !path.is_file() {
        return Ok(InstallsFile::default());
    }
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    Ok(serde_json::from_str(&text).unwrap_or_else(|error| {
        eprintln!("[runtime] installs.json is unreadable ({error}); treating as empty");
        InstallsFile::default()
    }))
}

/// Calls one package may make per UTC day, as configured.
pub fn daily_budget(app: &AppHandle) -> u32 {
    read_file(app)
        .ok()
        .and_then(|file| file.daily_budget)
        .map(clamp_daily_budget)
        .unwrap_or(DEFAULT_DAILY_BUDGET)
}

/// Drops unknown permissions and duplicate ids (last wins), so a hand-edited
/// file cannot smuggle in a capability.
fn normalize(records: Vec<InstallRecord>) -> Vec<InstallRecord> {
    let mut by_id: std::collections::BTreeMap<String, InstallRecord> =
        std::collections::BTreeMap::new();
    for mut record in records {
        if record.id.trim().is_empty() {
            continue;
        }
        record.granted_permissions = grantable_from_manifest(&record.granted_permissions);
        // Migrated here rather than at every read: normalize runs on load, so
        // one pass rewrites a pre-list record and nothing downstream has to
        // know two shapes.
        record.contract_grant = record.contract_grant.take().map(ContractGrant::migrated);
        if let Some(grant) = record.contract_grant.as_mut() {
            grant.approved.sort();
            grant.approved.dedup();
        }
        by_id.insert(record.id.clone(), record);
    }
    by_id.into_values().collect()
}

/// Keeps only queries the package's manifest actually asks for.
///
/// The honest path cannot trip this: the dialog offers what the manifest
/// requested and `grantFrom` returns what was ticked, so the grant is already a
/// subset. It is here for the path where the renderer is not honest — the same
/// reason `grantable_from_manifest` intersects rather than trusting its
/// argument. A grant is allowed to be smaller than the request and never larger.
fn clamp_queries(granted: &[String], requested: &[String]) -> Vec<String> {
    granted
        .iter()
        .filter(|query| requested.contains(query))
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// The queries a contract package's manifest asks for, as it is on disk now.
///
/// `None` when there is no such package or it is not a contract one; the caller
/// treats that as "asks for nothing", which fails closed.
fn requested_contract_providers(app: &AppHandle, ext_id: &str) -> Option<Vec<String>> {
    let root = super::package_root_for(app, ext_id)?;
    let text = fs::read_to_string(root.join("manifest.json")).ok()?;
    let raw: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some(
        raw.get("widget")?
            .get("requires")?
            .get("providers")?
            .as_array()?
            .iter()
            .filter_map(|value| value.as_str().map(str::to_string))
            .collect(),
    )
}

#[tauri::command]
pub fn connections_package_types(app: AppHandle, id: String) -> Vec<String> {
    package_connection_types(&app, &id)
}

fn package_connection_types(app: &AppHandle, id: &str) -> Vec<String> {
    let mut types = super::declared_credential_types(app, id);
    for provider in requested_contract_providers(app, id).unwrap_or_default() {
        if let Some(type_id) = crate::extension_providers::find(&provider)
            .and_then(|provider| provider.credential_type)
        {
            types.push(type_id.into());
        }
    }
    types.sort();
    types.dedup();
    types
}

/// Credential types one consent actually covers.
///
/// Not the same as `package_connection_types`, which is everything the package
/// *asks* for: a contract package's providers count only once the person has
/// approved them, so a widget requesting Linear and GitHub but approved for
/// Linear alone does not walk away holding a GitHub grant.
fn consented_credential_types(
    app: &AppHandle,
    id: &str,
    grant: Option<&ContractGrant>,
) -> Vec<String> {
    // Endpoint credentials come from the declaration on disk, which is what the
    // consent hash is taken over.
    let mut types = super::declared_credential_types(app, id);
    let requested = requested_contract_providers(app, id).unwrap_or_default();
    for provider in grant.map(|grant| grant.approved.as_slice()).unwrap_or(&[]) {
        if !requested.contains(provider) {
            continue;
        }
        if let Some(type_id) =
            crate::extension_providers::find(provider).and_then(|found| found.credential_type)
        {
            types.push(type_id.into());
        }
    }
    types.sort();
    types.dedup();
    types
}

/// The connections a set of credential types resolves to right now.
///
/// A grant names one account, never a type: a package allowed to read the work
/// workspace must not reach a personal one the user adds afterwards. The
/// account here is the one the app itself is bound to; a widget instance that
/// later picks a *different* one asks for that separately, through
/// `connections_grant_package`.
fn connections_for_types(
    conn: &rusqlite::Connection,
    types: &[String],
) -> Result<Vec<String>, String> {
    let mut ids = Vec::new();
    for type_id in types {
        let binding = crate::credentials::bindings::selection(
            conn,
            crate::credentials::bindings::HOST_OWNER,
            type_id,
        )?;
        // Not a default whose account was deleted: granting a tombstone left
        // the package "disconnected" with no account the person could fix.
        if let Some(id) = binding.credential_id {
            if crate::credentials::db::load(conn, &id)?.is_some() {
                ids.push(id);
            }
        }
    }
    Ok(ids)
}

#[tauri::command]
pub fn connections_grant_package(
    app: AppHandle,
    id: String,
    credential_id: String,
) -> Result<(), String> {
    let connection =
        crate::credentials::db::load(&crate::credentials::db::open_db(&app)?, &credential_id)?
            .ok_or("connection not found")?;
    if !package_connection_types(&app, &id).contains(&connection.type_id) {
        return Err("package does not declare this credential type".into());
    }
    let mut records = load(&app)?;
    let record = records
        .iter_mut()
        .find(|record| record.id == id && record.enabled)
        .ok_or("package is not enabled")?;
    if !record.granted_credentials.contains(&credential_id) {
        record.granted_credentials.push(credential_id);
    }
    save(&app, &records)
}

fn save(app: &AppHandle, records: &[InstallRecord]) -> Result<(), String> {
    // Keep whatever settings the file already holds — saving records must not
    // silently reset the budget.
    let daily_budget = read_file(app).ok().and_then(|file| file.daily_budget);
    write_file(
        app,
        &InstallsFile {
            installs: records.to_vec(),
            daily_budget,
        },
    )
}

fn write_file(app: &AppHandle, file: &InstallsFile) -> Result<(), String> {
    let path = installs_path(app)?;
    let text = serde_json::to_string_pretty(file).map_err(|error| error.to_string())?;
    fs::write(&path, text).map_err(|error| error.to_string())
}

/// Sets the per-package daily budget, clamped into range.
#[tauri::command]
pub fn runtime_extensions_set_daily_budget(app: AppHandle, value: u32) -> Result<u32, String> {
    let value = clamp_daily_budget(value);
    let mut file = read_file(&app)?;
    file.daily_budget = Some(value);
    write_file(&app, &file)?;
    Ok(value)
}

/// Forgets a package's install record, grants included.
///
/// Called when a package is deleted. Leaving the record behind would mean a
/// later widget that happened to reuse the id inherited permissions and
/// credential grants nobody reviewed for it — the record is keyed by id, and an
/// id becomes free again the moment its directory is gone.
pub fn forget(app: &AppHandle, ext_id: &str) -> Result<(), String> {
    let mut records = load(app)?;
    let before = records.len();
    records.retain(|record| record.id != ext_id);
    if records.len() == before {
        return Ok(());
    }
    save(app, &records)
}

/// Moves an install record onto the id its package now carries.
///
/// A rename is the same widget in a different folder, so the record travels
/// with it: the enabled flag, the granted permissions, the credential grants and
/// the api hash. None of them describes the folder — renaming a package changes
/// not one endpoint it declares — and asking somebody to approve again what they
/// approved a minute ago is how a consent dialog becomes something people click
/// through unread.
///
/// A record already sitting on the new id wins and the old one is dropped. That
/// record was consented to under the name it holds, and a rename must never
/// silently widen it to what the other package was granted.
pub fn rename(app: &AppHandle, from: &str, to: &str) -> Result<(), String> {
    let mut records = load(app)?;
    let Some(index) = records.iter().position(|record| record.id == from) else {
        return Ok(());
    };
    let mut moved = records.remove(index);
    if !records.iter().any(|record| record.id == to) {
        moved.id = to.to_string();
        records.push(moved);
    }
    // The counters move with the record. Dropping them would hand a package a
    // fresh daily budget for the price of a rename.
    if let Some(state) = app.try_state::<RuntimeHttpState>() {
        state.rename(from, to);
    }
    save(app, &records)
}

/// Grants of one package, or an empty list when it is not enabled.
///
/// This is the function the HTTP path asks — never the frontend.
pub fn granted_permissions(app: &AppHandle, ext_id: &str) -> Vec<String> {
    load(app)
        .unwrap_or_default()
        .into_iter()
        .find(|record| record.id == ext_id && record.enabled)
        .map(|record| record.granted_permissions)
        .unwrap_or_default()
}

/// True when `ext_id` is enabled and holds `permission`.
pub fn has_permission(app: &AppHandle, ext_id: &str, permission: &str) -> bool {
    granted_permissions(app, ext_id)
        .iter()
        .any(|granted| granted == permission)
}

/// Connection ids `ext_id` was granted, if it is enabled.
pub fn granted_credentials(app: &AppHandle, ext_id: &str) -> Vec<String> {
    load(app)
        .unwrap_or_default()
        .into_iter()
        .find(|record| record.id == ext_id && record.enabled)
        .map(|record| record.granted_credentials)
        .unwrap_or_default()
}

/// True when `ext_id` may use this exact connection.
///
/// One connection, not its type: a package granted the work Linear workspace
/// must not reach a personal one the user added afterwards.
pub fn has_credential_grant(app: &AppHandle, ext_id: &str, credential_id: &str) -> bool {
    granted_credentials(app, ext_id)
        .iter()
        .any(|granted| granted == credential_id)
}

/// Packages currently holding a grant for one connection (for the revoke UI
/// in Settings → Credentials).
#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_credential_users(
    app: AppHandle,
    credential_id: String,
) -> Result<Vec<String>, String> {
    Ok(load(&app)?
        .into_iter()
        .filter(|record| record.enabled && record.granted_credentials.contains(&credential_id))
        .map(|record| record.id)
        .collect())
}

/// Withdraws one connection from one package, leaving it otherwise enabled.
/// Its endpoints that use the credential start failing immediately.
#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_revoke_credential(
    app: AppHandle,
    id: String,
    credential_id: String,
) -> Result<Vec<InstallRecord>, String> {
    let mut records = load(&app)?;
    for record in records.iter_mut() {
        if record.id == id {
            record
                .granted_credentials
                .retain(|granted| *granted != credential_id);
        }
    }
    let records = normalize(records);
    save(&app, &records)?;
    Ok(records)
}

/// The declaration hash a package was enabled with, if it has a record.
///
/// Separate from `consent_matches_declaration` because a draft's declaration is
/// not "the one on disk" for its id — the draft folder is somewhere else — so
/// the comparison has to be made by the caller that knows which bytes it means.
pub fn consented_api_hash(app: &AppHandle, ext_id: &str) -> Option<String> {
    load(app)
        .unwrap_or_default()
        .into_iter()
        .find(|record| record.id == ext_id)
        .and_then(|record| record.api_hash)
}

/// Whether the consented declaration still matches the one on disk.
///
/// Compared as data, not as a promise: the hash the user consented to versus the
/// bytes that are there now.
pub fn consent_matches_declaration(app: &AppHandle, ext_id: &str) -> bool {
    consented_api_hash(app, ext_id) == super::current_api_hash(app, ext_id)
}

/// All install records (frontend view).
#[tauri::command]
pub fn runtime_extensions_installs_list(app: AppHandle) -> Result<Vec<InstallRecord>, String> {
    load(&app)
}

/// Enables or disables one package.
///
/// Enabling replaces the grants with the intersection of what the manifest asks
/// for and what is grantable — the frontend passes the manifest's permissions,
/// but it cannot invent one, because `grantable_from_manifest` filters against
/// the backend's own catalogue.
///
/// `contract_grant` is the other consent screen's answer, for a contract
/// package. Enabling **without** one leaves the record with no grant rather
/// than keeping whatever was there before: enable is where consent is asked,
/// and a caller that skips the question gets the fail-closed answer. The widget
/// then reports that it has not been approved, which is a state a person can
/// act on — quietly reusing an older grant is not.
#[tauri::command(rename_all = "camelCase")]
pub fn runtime_extensions_installs_set(
    app: AppHandle,
    id: String,
    enabled: bool,
    manifest_permissions: Vec<String>,
    contract_grant: Option<ContractGrant>,
) -> Result<Vec<InstallRecord>, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("id is required".into());
    }

    let mut records = load(&app)?;
    // Recomputed from disk, never taken from the frontend: the hash is what the
    // consent is *about*, so it has to describe the bytes the backend will read.
    let api_hash = if enabled {
        super::current_api_hash(&app, &id)
    } else {
        records
            .iter()
            .find(|record| record.id == id)
            .and_then(|record| record.api_hash.clone())
    };
    let granted_credentials = if enabled {
        // What the consent covers, resolved to the accounts it is about. Both
        // halves are recomputed here rather than taken from the caller: the
        // declaration is read off disk and the provider list off the grant, so
        // a frontend cannot widen either.
        let declared = package_connection_types(&app, &id);
        let conn = crate::credentials::db::open_db(&app)?;
        let consented = consented_credential_types(&app, &id, contract_grant.as_ref());
        let mut granted = connections_for_types(&conn, &consented)?;
        // Re-enabling keeps an earlier concrete grant, but never widens it to a
        // whole type — a connection added since is not part of this consent.
        if let Some(previous) = records.iter().find(|record| record.id == id) {
            granted.extend(
                previous
                    .granted_credentials
                    .iter()
                    .filter(|id| {
                        crate::credentials::db::load(&conn, id)
                            .ok()
                            .flatten()
                            .is_some_and(|connection| declared.contains(&connection.type_id))
                    })
                    .cloned(),
            );
        }
        granted.sort();
        granted.dedup();
        granted
    } else {
        records
            .iter()
            .find(|record| record.id == id)
            .map(|record| record.granted_credentials.clone())
            .unwrap_or_default()
    };
    let granted_permissions = if enabled {
        grantable_from_manifest(&manifest_permissions)
    } else {
        // Disabling keeps the previous consent so re-enabling does not silently
        // re-grant something the user never saw again.
        records
            .iter()
            .find(|record| record.id == id)
            .map(|record| record.granted_permissions.clone())
            .unwrap_or_default()
    };

    let contract_grant = if enabled {
        // Clamped against the manifest as it is on disk, the same way the
        // permission list above is clamped against the catalogue. What the user
        // ticked can only shrink here, never grow.
        contract_grant.map(|grant| {
            // Clamped against the manifest as it is on disk, the same way the
            // permission list above is clamped against the catalogue: what the
            // user ticked can only shrink here, never grow. A provider the
            // package no longer declares is dropped rather than kept.
            let requested = requested_contract_providers(&app, &id).unwrap_or_default();
            ContractGrant {
                approved: clamp_queries(&grant.migrated().approved, &requested),
                providers: Vec::new(),
                provider: None,
                queries: Vec::new(),
            }
        })
    } else {
        // Disabling keeps the answer, for the same reason the permission list
        // is kept: re-enabling must not silently re-grant something unseen, and
        // it must not silently *lose* something the user did approve either.
        records
            .iter()
            .find(|record| record.id == id)
            .and_then(|record| record.contract_grant.clone())
    };

    if !enabled {
        // Drop the package's rate-limit counters and cached responses: a
        // disabled package should not leave answers behind that a later
        // re-enable would serve without ever calling the provider.
        if let Some(state) = app.try_state::<RuntimeHttpState>() {
            state.forget(&id);
        }
    }

    records.retain(|record| record.id != id);
    records.push(InstallRecord {
        id,
        enabled,
        granted_permissions,
        contract_grant,
        api_hash,
        granted_credentials,
    });
    let records = normalize(records);
    save(&app, &records)?;
    Ok(records)
}

/// One-time import of the records the frontend used to own.
///
/// Called by the frontend with what it finds in `localStorage`; ignored once the
/// file exists, so a stale browser key can never resurrect a revoked grant.
#[tauri::command]
pub fn runtime_extensions_installs_import(
    app: AppHandle,
    records: Vec<InstallRecord>,
) -> Result<Vec<InstallRecord>, String> {
    let path = installs_path(&app)?;
    if path.is_file() {
        return load(&app);
    }
    let normalized = normalize(records);
    save(&app, &normalized)?;
    if !normalized.is_empty() {
        println!(
            "[runtime] imported {} install record(s) from the frontend store",
            normalized.len()
        );
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A saved account of `type_id`, the way the credentials panel writes one.
    fn add_connection(conn: &rusqlite::Connection, id: &str, type_id: &str) {
        crate::credentials::db::upsert_record(
            conn,
            &crate::credentials::db::CredentialRecord {
                id: id.into(),
                type_id: type_id.into(),
                name: id.into(),
                account_label: None,
                state: crate::credentials::db::CredentialState::Connected,
                metadata: Default::default(),
                created_at: 0,
                updated_at: 0,
            },
        )
        .unwrap();
    }

    /// A grant stores an account id, never a credential type.
    ///
    /// The regression this pins was silent and total: the consent step passes
    /// the *types* a declaration references, the store moved to account ids,
    /// and the translation between them was missing — so every grant filtered
    /// itself down to nothing and no runtime or contract package could use a
    /// credential at all. It failed closed, which is why nothing broke loudly;
    /// widgets simply reported themselves disconnected forever.
    #[test]
    fn a_consent_grants_the_account_a_type_resolves_to() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::credentials::db::migrate(&conn).unwrap();
        let types = vec!["githubPat".to_string()];

        assert!(
            connections_for_types(&conn, &types).unwrap().is_empty(),
            "with no account saved there is nothing to grant",
        );

        add_connection(&conn, "cred-work", "githubPat");
        let granted = connections_for_types(&conn, &types).unwrap();
        assert_eq!(
            granted,
            vec!["cred-work".to_string()],
            "a sole account binds itself, so enabling grants it",
        );
        assert!(
            !granted.contains(&"githubPat".to_string()),
            "the grant is the account, not the type it was requested by",
        );

        // A second account leaves the app-wide choice open, and an unmade
        // choice grants nothing rather than picking for the user.
        add_connection(&conn, "cred-personal", "githubPat");
        let conn2 = rusqlite::Connection::open_in_memory().unwrap();
        crate::credentials::db::migrate(&conn2).unwrap();
        add_connection(&conn2, "cred-a", "githubPat");
        add_connection(&conn2, "cred-b", "githubPat");
        assert!(
            connections_for_types(&conn2, &types).unwrap().is_empty(),
            "two accounts and no default: the consent covers neither",
        );
    }

    fn record(id: &str, enabled: bool, granted: &[&str]) -> InstallRecord {
        InstallRecord {
            id: id.into(),
            enabled,
            granted_permissions: granted.iter().map(|p| (*p).to_string()).collect(),
            contract_grant: None,
            api_hash: None,
            granted_credentials: Vec::new(),
        }
    }

    fn grant(providers: &[&str]) -> ContractGrant {
        ContractGrant {
            approved: providers.iter().map(|id| (*id).to_string()).collect(),
            providers: Vec::new(),
            provider: None,
            queries: Vec::new(),
        }
    }

    /// The oldest shape: one provider, its own query list, written before a
    /// widget could name more than one.
    fn legacy_grant(provider: &str, queries: &[&str]) -> ContractGrant {
        ContractGrant {
            approved: Vec::new(),
            providers: Vec::new(),
            provider: Some(provider.into()),
            queries: queries.iter().map(|q| (*q).to_string()).collect(),
        }
    }

    /// The middle shape: several providers, each with its own query list.
    fn per_query_grant(rows: &[(&str, &[&str])]) -> ContractGrant {
        ContractGrant {
            approved: Vec::new(),
            providers: rows
                .iter()
                .map(|(provider, queries)| ContractProviderGrant {
                    provider: (*provider).to_string(),
                    queries: queries.iter().map(|q| (*q).to_string()).collect(),
                })
                .collect(),
            provider: None,
            queries: Vec::new(),
        }
    }

    /// A record from an older install keeps its grant instead of quietly
    /// becoming an empty one.
    ///
    /// The failure this guards against is not a crash: an unmigrated record
    /// parses fine, `providers` comes back empty, and the package loads granted
    /// nothing and renders blank. Nothing on screen would say why.
    #[test]
    fn a_pre_list_grant_survives_normalization() {
        let mut row = record("demo", true, &[]);
        row.contract_grant = Some(legacy_grant("kavibay.tado/tado", &["zones", "zoneStates"]));

        let normalized = normalize(vec![row]);
        let stored = normalized[0]
            .contract_grant
            .as_ref()
            .expect("the grant is kept");

        assert_eq!(stored.approved, vec!["kavibay.tado/tado"]);
        assert!(
            stored.provider.is_none() && stored.queries.is_empty() && stored.providers.is_empty(),
            "and the old fields are cleared, so the file rewrites itself once",
        );
    }

    /// The middle shape migrates too, and its query lists are dropped.
    ///
    /// Dropping rather than keeping is the decision worth pinning: approving a
    /// provider is the wider answer, so somebody who ticked two of four queries
    /// now has the whole account. That is a widening the person did not do, and
    /// it is deliberate — the alternative is re-opening a dialog for everyone
    /// who ever approved anything, to ask a question that no longer exists.
    #[test]
    fn a_per_query_grant_becomes_a_provider_grant() {
        let mut row = record("demo", true, &[]);
        row.contract_grant = Some(per_query_grant(&[
            ("kavibay.tado/tado", &["zoneStates"]),
            ("kavibay.weather/weather", &["current"]),
        ]));

        let normalized = normalize(vec![row]);
        let stored = normalized[0].contract_grant.as_ref().expect("kept");

        assert_eq!(
            stored.approved,
            vec!["kavibay.tado/tado", "kavibay.weather/weather"]
        );
        assert!(stored.providers.is_empty(), "and the old rows are gone");
    }

    /// Migrating twice is migrating once. `normalize` runs on every load.
    #[test]
    fn migrating_an_already_migrated_grant_changes_nothing() {
        let once = legacy_grant("kavibay.tado/tado", &["zones"]).migrated();
        let twice = once.clone().migrated();
        assert_eq!(once, twice);

        let both = ContractGrant {
            approved: vec!["kavibay.tado/tado".into()],
            providers: vec![ContractProviderGrant {
                provider: "kavibay.tado/tado".into(),
                queries: vec!["zones".into()],
            }],
            provider: Some("kavibay.tado/tado".into()),
            queries: vec!["zones".into()],
        }
        .migrated();
        assert_eq!(
            both.approved,
            vec!["kavibay.tado/tado"],
            "a record carrying all three spellings collapses to one entry",
        );
    }

    /// The whole reason the grant is stored here and not derived: a package
    /// asking for four queries and a user ticking one must survive a restart as
    /// the one, not the four.
    /// The frontend omits `provider` for a package that declares none, so the
    /// field arrives missing rather than null. Measured rather than assumed:
    /// this is the most likely first package anyone enables.
    #[test]
    fn a_grant_without_a_provider_deserializes() {
        let parsed: ContractGrant = serde_json::from_str(r#"{"queries":[]}"#).unwrap();
        assert_eq!(parsed.provider, None);
        assert!(parsed.queries.is_empty());
    }

    #[test]
    fn a_grant_is_clamped_to_what_the_manifest_asked_for() {
        let requested: Vec<String> = ["zones", "zoneStates"]
            .iter()
            .map(|q| (*q).to_string())
            .collect();
        let granted: Vec<String> = ["zoneStates", "setTemperature", "zones"]
            .iter()
            .map(|q| (*q).to_string())
            .collect();
        assert_eq!(
            clamp_queries(&granted, &requested),
            vec!["zoneStates", "zones"],
            "a query the manifest never asked for cannot be granted, however it got into the call"
        );
        assert!(
            clamp_queries(&granted, &[]).is_empty(),
            "a package that asks for nothing can be granted nothing"
        );
    }

    /// A hand-edited `installs.json` is the case this file already guards
    /// against for permissions; the grant goes through the same door.
    #[test]
    fn normalize_keeps_the_contract_grant_and_tidies_it() {
        let mut row = record("a", true, &[]);
        row.contract_grant = Some(grant(&["kavibay.tado/tado", "kavibay.tado/tado"]));
        let normalized = normalize(vec![row]);
        let stored = normalized[0].contract_grant.as_ref().expect("grant kept");
        assert_eq!(
            stored.approved,
            vec!["kavibay.tado/tado"],
            "duplicates collapse"
        );
    }

    /// The grant travels with the record, so forgetting a deleted package
    /// forgets what it was allowed to read. An id that becomes free again must
    /// not hand a later widget somebody else's approval.
    #[test]
    fn a_record_without_a_grant_stays_without_one() {
        let normalized = normalize(vec![record("a", true, &["storage.instance"])]);
        assert_eq!(
            normalized[0].contract_grant, None,
            "never asked is not the same as approved for nothing"
        );
    }

    #[test]
    fn only_catalogued_permissions_are_grantable() {
        assert!(is_grantable("storage.instance"));
        assert!(is_grantable("network.declared"));
        // Reserved and unimplemented — a manifest asking for it gets nothing.
        assert!(!is_grantable("network.client"));
        assert!(!is_grantable("backend.sidecar"));
        assert!(!is_grantable("shell.exec"));
    }

    #[test]
    fn grants_are_the_intersection_of_manifest_and_catalogue() {
        let granted = grantable_from_manifest(&[
            "storage.instance".into(),
            "backend.sidecar".into(),
            "network.declared".into(),
            "shell.exec".into(),
        ]);
        assert_eq!(granted, vec!["network.declared", "storage.instance"]);
    }

    /// A hand-edited file must not be able to hand out a capability.
    #[test]
    fn normalize_strips_unknown_permissions_and_duplicates() {
        let normalized = normalize(vec![
            record("a", true, &["storage.instance", "shell.exec"]),
            record("a", true, &["network.declared"]),
            record("", true, &["storage.instance"]),
        ]);
        assert_eq!(
            normalized.len(),
            1,
            "duplicate ids collapse, empty id dropped"
        );
        assert_eq!(normalized[0].granted_permissions, vec!["network.declared"]);
    }

    /// Revoking a credential leaves the package enabled — it just loses that
    /// one capability, which is the point of a per-credential grant.
    #[test]
    fn credential_grants_survive_normalization_independently() {
        let mut record = record("a", true, &["network.declared"]);
        record.granted_credentials = vec!["cred-gh-work".into()];
        let normalized = normalize(vec![record]);
        assert_eq!(normalized[0].granted_credentials, vec!["cred-gh-work"]);
        assert!(normalized[0].enabled);

        let mut revoked = normalized[0].clone();
        revoked.granted_credentials.clear();
        let normalized = normalize(vec![revoked]);
        assert!(normalized[0].granted_credentials.is_empty());
        assert!(normalized[0].enabled, "revoking is not disabling");
    }

    #[test]
    fn normalize_keeps_disabled_rows() {
        let normalized = normalize(vec![record("a", false, &["storage.instance"])]);
        assert_eq!(normalized.len(), 1);
        assert!(!normalized[0].enabled);
    }
}
