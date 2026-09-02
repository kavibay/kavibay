//! SQLite store for every credential, in one place.
//!
//! Two tables by design: `credentials` holds only what the UI may see (name,
//! state, account label, non-secret metadata) so listing never decrypts, while
//! `credential_secrets` holds exactly one DPAPI-protected JSON blob per
//! credential. One blob keeps the schema stable when a type gains a field and
//! leaves a single encrypt/decrypt call site (AGENTS.md invariant 5).

use std::collections::BTreeMap;
use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::paths::data_dir;
use crate::security::secrets::{protect_secret, unprotect_secret};

/// Connection state of one credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialState {
    /// Required fields are missing, or an OAuth type has never been connected.
    Unconfigured,
    /// Ready to use.
    Connected,
    /// Tokens exist but the provider rejected the refresh — user must reconnect.
    NeedsReauth,
}

impl CredentialState {
    pub fn as_str(self) -> &'static str {
        match self {
            CredentialState::Unconfigured => "unconfigured",
            CredentialState::Connected => "connected",
            CredentialState::NeedsReauth => "needsReauth",
        }
    }

    /// Parses a stored state, defaulting to `Unconfigured` for unknown values
    /// so a corrupt row degrades to "needs setup" instead of "ready".
    pub fn from_str(value: &str) -> Self {
        match value {
            "connected" => CredentialState::Connected,
            "needsReauth" => CredentialState::NeedsReauth,
            _ => CredentialState::Unconfigured,
        }
    }
}

/// Non-secret credential row. Safe to serialize to the frontend.
#[derive(Debug, Clone)]
pub struct CredentialRecord {
    pub id: String,
    pub type_id: String,
    pub name: String,
    /// Provider-side account label ("alex@example.com"), set after login.
    pub account_label: Option<String>,
    pub state: CredentialState,
    /// Non-secret extras from the type's identity probe (e.g. Tado home id).
    pub metadata: Map<String, Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// OAuth token set stored inside the protected blob.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds when `access_token` expires.
    pub expires_at: i64,
}

/// Decrypted credential payload. Backend-only — never serialize this outward.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretData {
    /// User-entered field values, keyed by `FieldDef::key`.
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
    /// Present once an OAuth type has been connected.
    #[serde(default)]
    pub oauth: Option<OAuthTokens>,
}

impl SecretData {
    pub fn field(&self, key: &str) -> Option<&str> {
        self.fields
            .get(key)
            .map(String::as_str)
            .filter(|v| !v.is_empty())
    }
}

/// Resolves `{dataDir}/credentials.db` and creates its parent directory.
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("credentials.db"))
}

/// Opens the credential database and applies its idempotent schema migration.
pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

/// Creates the credential tables when initializing a database.
pub fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS credentials (
          id            TEXT PRIMARY KEY,
          type_id       TEXT NOT NULL,
          name          TEXT NOT NULL,
          account_label TEXT,
          state         TEXT NOT NULL,
          metadata      TEXT NOT NULL DEFAULT '{}',
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS credential_secrets (
          credential_id  TEXT PRIMARY KEY
                         REFERENCES credentials(id) ON DELETE CASCADE,
          data_protected TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS credential_imports (
          source      TEXT PRIMARY KEY,
          imported_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| e.to_string())
}

/// 16 random bytes as hex — opaque, collision-free enough for a local store,
/// and no extra dependency (the OAuth flows already use `rand`).
pub fn new_id() -> String {
    let mut bytes = [0u8; 16];
    rand::fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn parse_metadata(raw: &str) -> Map<String, Value> {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<CredentialRecord> {
    let metadata: String = row.get(5)?;
    Ok(CredentialRecord {
        id: row.get(0)?,
        type_id: row.get(1)?,
        name: row.get(2)?,
        account_label: row.get(3)?,
        state: CredentialState::from_str(&row.get::<_, String>(4)?),
        metadata: parse_metadata(&metadata),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, type_id, name, account_label, state, metadata, created_at, updated_at";

/// All credentials, newest type group first by creation order.
pub fn list(conn: &Connection) -> Result<Vec<CredentialRecord>, String> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM credentials ORDER BY created_at, id");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_record)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// One credential by id.
pub fn load(conn: &Connection, id: &str) -> Result<Option<CredentialRecord>, String> {
    let sql = format!("SELECT {SELECT_COLUMNS} FROM credentials WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_record)
        .optional()
        .map_err(|e| e.to_string())
}

/// The first credential of a type, used while the UI is single-credential.
pub fn find_by_type(conn: &Connection, type_id: &str) -> Result<Option<CredentialRecord>, String> {
    let sql =
        format!("SELECT {SELECT_COLUMNS} FROM credentials WHERE type_id = ?1 ORDER BY created_at, id LIMIT 1");
    conn.query_row(&sql, params![type_id], row_to_record)
        .optional()
        .map_err(|e| e.to_string())
}

/// Inserts or replaces the non-secret row.
pub fn upsert_record(conn: &Connection, record: &CredentialRecord) -> Result<(), String> {
    let metadata = Value::Object(record.metadata.clone()).to_string();
    conn.execute(
        r#"
        INSERT INTO credentials (
          id, type_id, name, account_label, state, metadata, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
          type_id = excluded.type_id,
          name = excluded.name,
          account_label = excluded.account_label,
          state = excluded.state,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
        "#,
        params![
            record.id,
            record.type_id,
            record.name,
            record.account_label,
            record.state.as_str(),
            metadata,
            record.created_at,
            record.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Updates state (+ optional account label / metadata) without touching secrets.
pub fn set_state(
    conn: &Connection,
    id: &str,
    state: CredentialState,
    updated_at: i64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE credentials SET state = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, state.as_str(), updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Stores the identity probe result (display label + non-secret extras).
pub fn set_identity(
    conn: &Connection,
    id: &str,
    account_label: Option<&str>,
    metadata: &Map<String, Value>,
    updated_at: i64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE credentials SET account_label = ?2, metadata = ?3, updated_at = ?4 WHERE id = ?1",
        params![
            id,
            account_label,
            Value::Object(metadata.clone()).to_string(),
            updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Loads and decrypts a credential's payload. Backend-only.
pub fn load_secret(conn: &Connection, id: &str) -> Result<Option<SecretData>, String> {
    let protected: Option<String> = conn
        .query_row(
            "SELECT data_protected FROM credential_secrets WHERE credential_id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(protected) = protected else {
        return Ok(None);
    };
    let json = unprotect_secret(&protected)?;
    let data: SecretData = serde_json::from_str(&json)
        .map_err(|e| format!("corrupt credential payload for {id}: {e}"))?;
    Ok(Some(data))
}

/// Encrypts and stores a credential's payload.
pub fn save_secret(conn: &Connection, id: &str, data: &SecretData) -> Result<(), String> {
    let json = serde_json::to_string(data).map_err(|e| e.to_string())?;
    let protected = protect_secret(&json)?;
    conn.execute(
        r#"
        INSERT INTO credential_secrets (credential_id, data_protected)
        VALUES (?1, ?2)
        ON CONFLICT(credential_id) DO UPDATE SET data_protected = excluded.data_protected
        "#,
        params![id, protected],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Removes a credential and its secret payload.
pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    // Explicit child delete: `PRAGMA foreign_keys` is per-connection, so relying
    // on ON DELETE CASCADE alone would orphan blobs on a connection without it.
    conn.execute(
        "DELETE FROM credential_secrets WHERE credential_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM credentials WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// True when a legacy store has already been imported (see `import.rs`).
pub fn is_imported(conn: &Connection, source: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM credential_imports WHERE source = ?1",
            params![source],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

/// Marks a legacy store as imported so the migration runs exactly once.
pub fn mark_imported(conn: &Connection, source: &str, at: i64) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO credential_imports (source, imported_at) VALUES (?1, ?2)",
        params![source, at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn record(id: &str) -> CredentialRecord {
        CredentialRecord {
            id: id.to_string(),
            type_id: "githubPat".into(),
            name: "GitHub".into(),
            account_label: None,
            state: CredentialState::Unconfigured,
            metadata: Map::new(),
            created_at: 10,
            updated_at: 10,
        }
    }

    #[test]
    fn upsert_load_list_and_delete() {
        let conn = test_conn();
        upsert_record(&conn, &record("a")).unwrap();
        upsert_record(&conn, &record("b")).unwrap();

        assert_eq!(list(&conn).unwrap().len(), 2);
        assert_eq!(load(&conn, "a").unwrap().unwrap().name, "GitHub");
        assert_eq!(find_by_type(&conn, "githubPat").unwrap().unwrap().id, "a");
        assert!(find_by_type(&conn, "nope").unwrap().is_none());

        delete(&conn, "a").unwrap();
        assert!(load(&conn, "a").unwrap().is_none());
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn state_and_identity_updates_are_persisted() {
        let conn = test_conn();
        upsert_record(&conn, &record("a")).unwrap();

        set_state(&conn, "a", CredentialState::Connected, 20).unwrap();
        let mut metadata = Map::new();
        metadata.insert("homeId".into(), Value::from(7));
        set_identity(&conn, "a", Some("alex@example.com"), &metadata, 21).unwrap();

        let loaded = load(&conn, "a").unwrap().unwrap();
        assert_eq!(loaded.state, CredentialState::Connected);
        assert_eq!(loaded.account_label.as_deref(), Some("alex@example.com"));
        assert_eq!(loaded.metadata.get("homeId").unwrap(), &Value::from(7));
        assert_eq!(loaded.updated_at, 21);
    }

    #[test]
    fn unknown_state_degrades_to_unconfigured() {
        assert_eq!(
            CredentialState::from_str("garbage"),
            CredentialState::Unconfigured
        );
        assert_eq!(
            CredentialState::from_str("connected"),
            CredentialState::Connected
        );
    }

    #[test]
    fn import_markers_are_recorded_once() {
        let conn = test_conn();
        assert!(!is_imported(&conn, "github_actions").unwrap());
        mark_imported(&conn, "github_actions", 5).unwrap();
        mark_imported(&conn, "github_actions", 6).unwrap();
        assert!(is_imported(&conn, "github_actions").unwrap());
    }

    // Secret round-trips go through DPAPI, so they are Windows-only (like the app).
    #[cfg(windows)]
    #[test]
    fn secret_roundtrip_and_delete_cascade() {
        let conn = test_conn();
        upsert_record(&conn, &record("a")).unwrap();

        let mut data = SecretData::default();
        data.fields.insert("token".into(), "ghp_secret".into());
        data.oauth = Some(OAuthTokens {
            access_token: "at".into(),
            refresh_token: "rt".into(),
            expires_at: 99,
        });
        save_secret(&conn, "a", &data).unwrap();

        let loaded = load_secret(&conn, "a").unwrap().unwrap();
        assert_eq!(loaded, data);
        assert_eq!(loaded.field("token"), Some("ghp_secret"));

        delete(&conn, "a").unwrap();
        assert!(load_secret(&conn, "a").unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn secrets_are_not_plaintext_at_rest() {
        let conn = test_conn();
        upsert_record(&conn, &record("a")).unwrap();
        let mut data = SecretData::default();
        data.fields.insert("token".into(), "ghp_supersecret".into());
        save_secret(&conn, "a", &data).unwrap();

        let stored: String = conn
            .query_row(
                "SELECT data_protected FROM credential_secrets WHERE credential_id = 'a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!stored.contains("ghp_supersecret"));
        assert!(!stored.contains("token"));
    }

    #[test]
    fn empty_field_values_read_as_absent() {
        let mut data = SecretData::default();
        data.fields.insert("token".into(), String::new());
        assert_eq!(data.field("token"), None);
    }
}
