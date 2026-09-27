//! Generic credential commands — the whole frontend surface of this layer.
//!
//! Seven commands replace the per-integration credential commands. Nothing here
//! ever returns a secret value: password fields come back as "set / not set",
//! text fields (account ids, client ids) come back as values because the editor
//! has to show them.

use std::collections::BTreeMap;

use serde::Serialize;
use tauri::AppHandle;

use super::db::{self, CredentialRecord, CredentialState, SecretData};
use super::now_secs;
use super::oauth::device_code::DeviceVerification;
use super::registry;
use super::resolve::{field_value, has_required_fields, resolve};
use super::types::{render_template, AuthKind, ClientSource, CredentialTypeSchema, FieldKind};

/// User-Agent for credential test requests (GitHub rejects requests without one).
const TEST_USER_AGENT: &str = "kavibay-credentials";

/// Frontend-safe view of one stored credential.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSummary {
    pub id: String,
    pub type_id: String,
    pub name: String,
    pub account_label: Option<String>,
    /// `"unconfigured" | "connected" | "needsReauth"`.
    pub state: &'static str,
    /// True while a sign-in flow is waiting for the user.
    pub pending: bool,
    /// Why the last sign-in attempt failed (device-code logins fail in the
    /// background, so the UI cannot learn this from the command it called).
    pub error: Option<String>,
    /// Values of non-secret fields, so the editor can show what is saved.
    pub values: BTreeMap<String, String>,
    /// Keys of secret fields that currently hold a value (never the value).
    pub secrets_set: Vec<String>,
    /// Required keys that are still empty.
    pub missing: Vec<String>,
    pub metadata: serde_json::Map<String, serde_json::Value>,
    pub updated_at: i64,
}

/// Result of a "Test connection" run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialTestResult {
    pub ok: bool,
    pub message: String,
}

/// Builds the frontend view of a record + its (decrypted, never exposed) secret.
fn summarize(
    record: &CredentialRecord,
    secret: &SecretData,
    pending: bool,
    error: Option<String>,
) -> Result<CredentialSummary, String> {
    let type_def = registry::require(&record.type_id)?;

    let mut values = BTreeMap::new();
    let mut secrets_set = Vec::new();
    let mut missing = Vec::new();

    for field in type_def.fields {
        let value = field_value(secret, field.key);
        match (field.kind, &value) {
            (FieldKind::Password, Some(_)) => secrets_set.push(field.key.to_string()),
            (FieldKind::Text, Some(value)) => {
                values.insert(field.key.to_string(), value.clone());
            }
            _ => {}
        }
        if field.required && value.is_none() {
            missing.push(field.key.to_string());
        }
    }

    Ok(CredentialSummary {
        id: record.id.clone(),
        type_id: record.type_id.clone(),
        name: record.name.clone(),
        account_label: record.account_label.clone(),
        state: record.state.as_str(),
        pending,
        error,
        values,
        secrets_set,
        missing,
        metadata: record.metadata.clone(),
        updated_at: record.updated_at,
    })
}

/// State a credential should have after its fields changed.
///
/// Static types are usable as soon as their required fields are filled. OAuth
/// types additionally need a completed consent flow, so they stay
/// `Unconfigured` until the flow persists tokens.
fn state_after_field_change(
    type_def: &super::types::CredentialTypeDef,
    secret: &SecretData,
    previous: CredentialState,
) -> CredentialState {
    if !has_required_fields(type_def, secret) {
        return CredentialState::Unconfigured;
    }
    match type_def.auth {
        AuthKind::Static => CredentialState::Connected,
        _ => {
            if secret.oauth.is_some() {
                previous
            } else {
                CredentialState::Unconfigured
            }
        }
    }
}

/// Field keys that identify the OAuth client. Changing one invalidates any
/// tokens issued for the old client, so they must be dropped.
fn client_field_keys(type_def: &super::types::CredentialTypeDef) -> Vec<&'static str> {
    let client = match type_def.auth {
        AuthKind::Static => return Vec::new(),
        AuthKind::OAuth2AuthCode(auth) => auth.client,
        AuthKind::OAuth2DeviceCode(device) => device.client,
    };
    match client {
        ClientSource::Fields { id_key, secret_key } => {
            let mut keys = vec![id_key];
            keys.extend(secret_key);
            keys
        }
        ClientSource::BuiltIn { .. } => Vec::new(),
    }
}

/// Merges submitted values into the stored payload.
///
/// An empty submitted value means "leave the stored secret alone" for password
/// fields (the editor shows a masked placeholder, not the value) and "clear it"
/// for text fields. Unknown keys are rejected rather than silently stored.
fn merge_fields(
    type_def: &super::types::CredentialTypeDef,
    secret: &mut SecretData,
    submitted: &BTreeMap<String, String>,
) -> Result<(), String> {
    for (key, value) in submitted {
        let field = type_def
            .field(key)
            .ok_or_else(|| format!("unknown field {key} for credential type {}", type_def.id))?;
        let value = value.trim();
        if value.is_empty() {
            if field.kind.is_secret() {
                continue;
            }
            secret.fields.remove(key.as_str());
        } else {
            secret.fields.insert(key.clone(), value.to_string());
        }
    }
    Ok(())
}

/// All known credential types (schema only — labels, field kinds, urls).
#[tauri::command]
pub fn credential_types_list() -> Vec<CredentialTypeSchema> {
    registry::ALL.iter().map(|def| def.schema()).collect()
}

/// All stored credentials, without secret values.
#[tauri::command]
pub fn credentials_list(app: AppHandle) -> Result<Vec<CredentialSummary>, String> {
    let conn = db::open_db(&app)?;

    let mut out = Vec::new();
    for record in db::list(&conn)? {
        // A row whose type disappeared from the registry is skipped rather than
        // failing the whole list — it would otherwise brick the settings panel.
        if registry::find(&record.type_id).is_none() {
            continue;
        }
        let secret = db::load_secret(&conn, &record.id)?.unwrap_or_default();
        let pending = super::oauth::is_pending(&app, &record.id);
        let error = super::oauth::last_error(&app, &record.id);
        out.push(summarize(&record, &secret, pending, error)?);
    }
    Ok(out)
}

/// Forgets a refused keychain read, so the next load asks macOS for access again.
#[tauri::command]
pub fn credentials_retry_access() {
    crate::security::secrets::retry_access();
}

/// One credential's current state (poll target while an OAuth flow is pending).
#[tauri::command]
pub fn credentials_status(app: AppHandle, id: String) -> Result<Option<CredentialSummary>, String> {
    let conn = db::open_db(&app)?;
    let Some(record) = db::load(&conn, &id)? else {
        return Ok(None);
    };
    let secret = db::load_secret(&conn, &record.id)?.unwrap_or_default();
    let pending = super::oauth::is_pending(&app, &record.id);
    let error = super::oauth::last_error(&app, &record.id);
    Ok(Some(summarize(&record, &secret, pending, error)?))
}

/// Creates or updates a credential and returns its id.
///
/// Without an ID, this always creates a new connection.
#[tauri::command]
pub fn credentials_save(
    app: AppHandle,
    type_id: String,
    id: Option<String>,
    name: Option<String>,
    fields: BTreeMap<String, String>,
) -> Result<String, String> {
    let type_def = registry::require(&type_id)?;
    let conn = db::open_db(&app)?;

    let existing = match &id {
        Some(id) => Some(db::load(&conn, id)?.ok_or("connection not found")?),
        None => None,
    };
    if let Some(record) = &existing {
        if record.type_id != type_id {
            return Err("credential type cannot be changed".into());
        }
    }

    let now = now_secs();
    let mut record = existing.clone().unwrap_or_else(|| CredentialRecord {
        id: db::new_id(),
        type_id: type_id.clone(),
        name: name
            .clone()
            .unwrap_or_else(|| type_def.display_name.to_string()),
        account_label: None,
        state: CredentialState::Unconfigured,
        metadata: serde_json::Map::new(),
        created_at: now,
        updated_at: now,
    });
    if let Some(name) = name {
        let name = name.trim();
        if !name.is_empty() {
            record.name = name.to_string();
        }
    }

    let mut secret = db::load_secret(&conn, &record.id)?.unwrap_or_default();
    let before: Vec<Option<String>> = client_field_keys(type_def)
        .iter()
        .map(|key| secret.field(key).map(str::to_string))
        .collect();

    merge_fields(type_def, &mut secret, &fields)?;
    super::instance_url::sync_instance_url(
        type_def,
        &mut secret,
        &mut record.metadata,
        &mut record.account_label,
    )?;

    let after: Vec<Option<String>> = client_field_keys(type_def)
        .iter()
        .map(|key| secret.field(key).map(str::to_string))
        .collect();
    if before != after && secret.oauth.is_some() {
        // Tokens belong to the old client — keeping them would fail at refresh
        // time with a confusing provider error instead of an obvious "connect".
        secret.oauth = None;
        record.account_label = None;
        record.metadata.clear();
    }

    record.state = state_after_field_change(type_def, &secret, record.state);
    record.updated_at = now;

    db::upsert_record(&conn, &record)?;
    db::save_secret(&conn, &record.id, &secret)?;
    if existing.is_none() {
        super::bindings::adopt_orphaned_default(&conn, &type_id, &record.id)?;
    }
    Ok(record.id)
}

/// Deletes a credential and its stored secrets.
#[tauri::command]
pub fn credentials_delete(app: AppHandle, id: String) -> Result<(), String> {
    // Stop any in-flight login first: its background task would otherwise still
    // hold this credential's id and could write tokens back after the delete.
    super::oauth::cancel_pending(&app, &id);
    let conn = db::open_db(&app)?;
    db::delete(&conn, &id)
}

/// Starts the credential type's sign-in flow.
///
/// Browser flows return `None` (the consent screen is already open); device
/// flows return the code and URL the user has to visit.
#[tauri::command]
pub async fn credentials_connect(
    app: AppHandle,
    id: String,
) -> Result<Option<DeviceVerification>, String> {
    let type_def = {
        let conn = db::open_db(&app)?;
        let record = db::load(&conn, &id)?.ok_or("credential not found")?;
        registry::require(&record.type_id)?
    };

    match type_def.auth {
        AuthKind::OAuth2AuthCode(_) => super::oauth::auth_code::start(&app, &id)
            .await
            .map(|_| None),
        AuthKind::OAuth2DeviceCode(_) => {
            super::oauth::device_code::start(&app, &id).await.map(Some)
        }
        AuthKind::Static => Err(format!(
            "{} does not need a sign-in — save its fields instead",
            type_def.display_name
        )),
    }
}

/// Stops waiting for a sign-in without touching stored tokens.
#[tauri::command]
pub fn credentials_cancel_connect(app: AppHandle, id: String) -> Result<(), String> {
    super::oauth::cancel_pending(&app, &id);
    Ok(())
}

/// Disconnects the account but keeps the user-entered fields (an OAuth app's
/// client id/secret survive; only the connected account does not).
#[tauri::command]
pub fn credentials_disconnect(app: AppHandle, id: String) -> Result<(), String> {
    super::oauth::disconnect(&app, &id)
}

/// Runs the credential type's declared test request.
#[tauri::command]
pub async fn credentials_test(app: AppHandle, id: String) -> Result<CredentialTestResult, String> {
    let resolved = match resolve(&app, &id).await {
        Ok(resolved) => resolved,
        Err(error) => {
            return Ok(CredentialTestResult {
                ok: false,
                message: format!("Credential is not usable: {error}"),
            })
        }
    };

    let Some(test) = resolved.type_def.test else {
        return Err("this credential type has no connection test".into());
    };

    let url = render_template(test.url, |key| resolved.field(key).map(str::to_string))?;
    let client = reqwest::Client::builder()
        .user_agent(TEST_USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;

    // Linear (and any future GraphQL type) has no GET probe; a body means POST.
    let mut request = match test.body {
        Some(body) => {
            let body = render_template(body, |key| resolved.field(key).map(str::to_string))?;
            client.post(&url).body(body)
        }
        None => client.get(&url),
    };
    for (name, value) in test.headers {
        request = request.header(*name, *value);
    }
    let request = resolved.apply(request)?;

    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            return Ok(CredentialTestResult {
                ok: false,
                message: format!("Request failed: {error}"),
            })
        }
    };

    let status = response.status();
    if status.is_success() {
        Ok(CredentialTestResult {
            ok: true,
            message: test.success.to_string(),
        })
    } else {
        Ok(CredentialTestResult {
            ok: false,
            message: format!("Provider answered HTTP {}", status.as_u16()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::registry::{CLOUDFLARE_WORKERS_AI, GITHUB_PAT, GOOGLE_CALENDAR_OAUTH2};

    fn submitted(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    #[test]
    fn merge_keeps_secrets_when_the_field_is_submitted_empty() {
        let type_def = registry::require(GITHUB_PAT).unwrap();
        let mut secret = SecretData::default();
        secret.fields.insert("token".into(), "kept".into());

        merge_fields(type_def, &mut secret, &submitted(&[("token", "")])).unwrap();
        assert_eq!(secret.field("token"), Some("kept"));

        merge_fields(type_def, &mut secret, &submitted(&[("token", " new ")])).unwrap();
        assert_eq!(secret.field("token"), Some("new"));
    }

    #[test]
    fn merge_clears_text_fields_and_rejects_unknown_keys() {
        let type_def = registry::require(CLOUDFLARE_WORKERS_AI).unwrap();
        let mut secret = SecretData::default();
        secret.fields.insert("accountId".into(), "acc".into());

        merge_fields(type_def, &mut secret, &submitted(&[("accountId", "")])).unwrap();
        assert_eq!(secret.field("accountId"), None);

        let error = merge_fields(type_def, &mut secret, &submitted(&[("nope", "x")])).unwrap_err();
        assert!(error.contains("nope"), "{error}");
    }

    #[test]
    fn static_types_become_connected_once_required_fields_exist() {
        let type_def = registry::require(GITHUB_PAT).unwrap();
        let mut secret = SecretData::default();
        assert_eq!(
            state_after_field_change(type_def, &secret, CredentialState::Unconfigured),
            CredentialState::Unconfigured
        );
        secret.fields.insert("token".into(), "t".into());
        assert_eq!(
            state_after_field_change(type_def, &secret, CredentialState::Unconfigured),
            CredentialState::Connected
        );
    }

    /// Filling in an OAuth app's client id/secret is not a connection — the
    /// consent flow still has to run.
    #[test]
    fn oauth_types_stay_unconfigured_until_tokens_exist() {
        let type_def = registry::require(GOOGLE_CALENDAR_OAUTH2).unwrap();
        let mut secret = SecretData::default();
        secret.fields.insert("clientId".into(), "id".into());
        secret.fields.insert("clientSecret".into(), "sec".into());
        assert_eq!(
            state_after_field_change(type_def, &secret, CredentialState::Unconfigured),
            CredentialState::Unconfigured
        );

        secret.oauth = Some(Default::default());
        assert_eq!(
            state_after_field_change(type_def, &secret, CredentialState::Connected),
            CredentialState::Connected
        );
    }

    #[test]
    fn client_field_keys_are_type_specific() {
        assert_eq!(
            client_field_keys(registry::require(GOOGLE_CALENDAR_OAUTH2).unwrap()),
            vec!["clientId", "clientSecret"]
        );
        assert_eq!(
            client_field_keys(registry::require(registry::SPOTIFY_OAUTH2).unwrap()),
            vec!["clientId"]
        );
        assert_eq!(
            client_field_keys(registry::require(registry::FITBIT_OAUTH2).unwrap()),
            vec!["clientId", "clientSecret"]
        );
        assert!(client_field_keys(registry::require(GITHUB_PAT).unwrap()).is_empty());
    }

    #[test]
    fn summaries_never_contain_secret_values() {
        let record = CredentialRecord {
            id: "a".into(),
            type_id: CLOUDFLARE_WORKERS_AI.into(),
            name: "CF".into(),
            account_label: None,
            state: CredentialState::Connected,
            metadata: serde_json::Map::new(),
            created_at: 1,
            updated_at: 2,
        };
        let mut secret = SecretData::default();
        secret.fields.insert("accountId".into(), "acc-1".into());
        secret
            .fields
            .insert("apiToken".into(), "super-secret".into());

        let summary = summarize(&record, &secret, false, None).unwrap();
        let json = serde_json::to_string(&summary).unwrap();
        assert!(!json.contains("super-secret"), "{json}");
        assert_eq!(summary.values.get("accountId").unwrap(), "acc-1");
        assert_eq!(summary.secrets_set, vec!["apiToken".to_string()]);
        assert!(summary.missing.is_empty());
    }

    #[test]
    fn summaries_report_missing_required_fields() {
        let record = CredentialRecord {
            id: "a".into(),
            type_id: GITHUB_PAT.into(),
            name: "GH".into(),
            account_label: None,
            state: CredentialState::Unconfigured,
            metadata: serde_json::Map::new(),
            created_at: 1,
            updated_at: 1,
        };
        let summary = summarize(&record, &SecretData::default(), false, None).unwrap();
        assert_eq!(summary.missing, vec!["token".to_string()]);
        assert!(summary.secrets_set.is_empty());
    }
}
