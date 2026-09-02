//! One-time import of the per-integration credential stores that existed
//! before this layer.
//!
//! Rules (from the credentials plan): imports are lazy, run at most once per
//! legacy source, and must never force the user to authenticate again. A failed
//! import is logged and retried on the next run rather than creating a
//! half-configured credential that looks ready.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::{Connection, OptionalExtension};
use tauri::AppHandle;

use crate::paths::data_dir;
use crate::security::secrets::unprotect_or_legacy_plaintext;

use super::db::{self, CredentialRecord, CredentialState, OAuthTokens, SecretData};
use super::registry;

/// Legacy database file name → importer.
type Importer = fn(&Connection, &Connection, i64) -> Result<bool, String>;

/// Every legacy source, as `(marker, legacy db file, importer)`.
const SOURCES: &[(&str, &str, Importer)] = &[
    ("github_actions", "github_actions.db", import_github),
    ("cloudflare_ai", "cloudflare_ai.db", import_cloudflare),
    ("calendar", "calendar.db", import_google_calendar),
    ("tado", "tado.db", import_tado),
];

/// Set once every source is marked, so the common case (nothing left to
/// import) costs nothing on the widget-polling path.
static ALL_DONE: AtomicBool = AtomicBool::new(false);

/// Runs every not-yet-executed import. Best effort by design: credential
/// listing and resolution must work even if a legacy file is unreadable.
pub fn run_pending_imports(app: &AppHandle, conn: &Connection) {
    if ALL_DONE.load(Ordering::Relaxed) {
        return;
    }

    let now = super::now_secs();
    let mut pending = 0usize;
    for (marker, file, importer) in SOURCES {
        match db::is_imported(conn, marker) {
            Ok(true) => continue,
            Ok(false) => {}
            Err(error) => {
                eprintln!("[credentials] import check failed for {marker}: {error}");
                pending += 1;
                continue;
            }
        }

        let path = match legacy_path(app, file) {
            Ok(path) => path,
            Err(error) => {
                eprintln!("[credentials] cannot resolve {file}: {error}");
                pending += 1;
                continue;
            }
        };

        if !path.is_file() {
            // Nothing to import — record it so we stop looking.
            if db::mark_imported(conn, marker, now).is_err() {
                pending += 1;
            }
            continue;
        }

        let legacy = match Connection::open(&path) {
            Ok(legacy) => legacy,
            Err(error) => {
                eprintln!("[credentials] cannot open {file}: {error}");
                pending += 1;
                continue;
            }
        };

        match importer(&legacy, conn, now) {
            Ok(imported) => {
                if let Err(error) = db::mark_imported(conn, marker, now) {
                    eprintln!("[credentials] marking {marker} imported failed: {error}");
                    pending += 1;
                } else if imported {
                    println!("[credentials] imported legacy credentials from {file}");
                }
            }
            // Left unmarked on purpose: the next start retries.
            Err(error) => {
                eprintln!("[credentials] import from {file} failed: {error}");
                pending += 1;
            }
        }
    }

    if pending == 0 {
        ALL_DONE.store(true, Ordering::Relaxed);
    }
}

fn legacy_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(file))
}

/// True when the table exists — legacy files from a partially-used integration
/// may be present without their table.
fn has_table(conn: &Connection, table: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

/// Creates a credential row + secret blob with an explicit state, for sources
/// where "has values" and "is connected" are different things (OAuth).
fn store_imported_with_state(
    store: &Connection,
    type_id: &str,
    account_label: Option<String>,
    secret: SecretData,
    state: CredentialState,
    now: i64,
) -> Result<bool, String> {
    if db::find_by_type(store, type_id)?.is_some() {
        return Ok(false);
    }
    let type_def = registry::require(type_id)?;
    let record = CredentialRecord {
        id: db::new_id(),
        type_id: type_id.to_string(),
        name: type_def.display_name.to_string(),
        account_label,
        state,
        metadata: serde_json::Map::new(),
        created_at: now,
        updated_at: now,
    };
    db::upsert_record(store, &record)?;
    db::save_secret(store, &record.id, &secret)?;
    Ok(true)
}

/// Creates the credential row + secret blob for an imported legacy credential.
///
/// Skips (returns `false`) when a credential of that type already exists, so a
/// re-run can never duplicate what the user already has.
fn store_imported(
    store: &Connection,
    type_id: &str,
    account_label: Option<String>,
    secret: SecretData,
    now: i64,
) -> Result<bool, String> {
    if db::find_by_type(store, type_id)?.is_some() {
        return Ok(false);
    }
    let type_def = registry::require(type_id)?;
    let record = CredentialRecord {
        id: db::new_id(),
        type_id: type_id.to_string(),
        name: type_def.display_name.to_string(),
        account_label,
        state: CredentialState::Connected,
        metadata: serde_json::Map::new(),
        created_at: now,
        updated_at: now,
    };
    db::upsert_record(store, &record)?;
    db::save_secret(store, &record.id, &secret)?;
    Ok(true)
}

/// `github_actions.db`: single-row `credentials(id=1, token_protected, …)`.
fn import_github(legacy: &Connection, store: &Connection, now: i64) -> Result<bool, String> {
    if !has_table(legacy, "credentials")? {
        return Ok(false);
    }
    let stored: Option<String> = legacy
        .query_row(
            "SELECT token_protected FROM credentials WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(stored) = stored else {
        return Ok(false);
    };
    let (token, _was_plaintext) = unprotect_or_legacy_plaintext(&stored);
    if token.trim().is_empty() {
        return Ok(false);
    }

    let mut secret = SecretData::default();
    secret.fields.insert("token".into(), token);
    store_imported(store, registry::GITHUB_PAT, None, secret, now)
}

/// `cloudflare_ai.db`: single-row `credentials(id=1, account_id, api_token, …)`.
fn import_cloudflare(legacy: &Connection, store: &Connection, now: i64) -> Result<bool, String> {
    if !has_table(legacy, "credentials")? {
        return Ok(false);
    }
    let stored: Option<(String, String)> = legacy
        .query_row(
            "SELECT account_id, api_token FROM credentials WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((account_id, api_token)) = stored else {
        return Ok(false);
    };
    let (api_token, _was_plaintext) = unprotect_or_legacy_plaintext(&api_token);
    if account_id.trim().is_empty() || api_token.trim().is_empty() {
        return Ok(false);
    }

    let mut secret = SecretData::default();
    secret.fields.insert("accountId".into(), account_id);
    secret.fields.insert("apiToken".into(), api_token);
    store_imported(store, registry::CLOUDFLARE_WORKERS_AI, None, secret, now)
}

/// `calendar.db`: `oauth_app_credentials` (client id + protected secret) plus
/// `oauth_tokens` (the connected account). Both are optional — a user may have
/// entered client details without ever completing the consent flow.
///
/// Note the security upgrade this migration performs: the legacy access and
/// refresh tokens were stored in plaintext, while the new store keeps the whole
/// payload inside one DPAPI-protected blob.
fn import_google_calendar(
    legacy: &Connection,
    store: &Connection,
    now: i64,
) -> Result<bool, String> {
    let mut secret = SecretData::default();

    if has_table(legacy, "oauth_app_credentials")? {
        let app_row: Option<(String, String)> = legacy
            .query_row(
                "SELECT client_id, client_secret_protected FROM oauth_app_credentials WHERE provider = 'google'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((client_id, protected)) = app_row {
            let (client_secret, _was_plaintext) = unprotect_or_legacy_plaintext(&protected);
            if !client_id.trim().is_empty() && !client_secret.trim().is_empty() {
                secret.fields.insert("clientId".into(), client_id);
                secret.fields.insert("clientSecret".into(), client_secret);
            }
        }
    }

    let mut account_label = None;
    if has_table(legacy, "oauth_tokens")? {
        let token_row: Option<(String, String, i64, String)> = legacy
            .query_row(
                "SELECT access_token, refresh_token, expires_at, account_email FROM oauth_tokens WHERE provider = 'google'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((access_token, refresh_token, expires_at, email)) = token_row {
            if !refresh_token.trim().is_empty() {
                secret.oauth = Some(OAuthTokens {
                    access_token,
                    refresh_token,
                    expires_at,
                });
                account_label = Some(email).filter(|value| !value.trim().is_empty());
            }
        }
    }

    if secret.fields.is_empty() && secret.oauth.is_none() {
        return Ok(false);
    }

    // Only a stored token set means "connected"; client details alone leave the
    // credential waiting for its sign-in.
    let state = if secret.oauth.is_some() {
        CredentialState::Connected
    } else {
        CredentialState::Unconfigured
    };
    store_imported_with_state(
        store,
        registry::GOOGLE_CALENDAR_OAUTH2,
        account_label,
        secret,
        state,
        now,
    )
}

/// `tado.db`: single-row `auth` table with protected tokens plus the home the
/// account is linked to. The home id/name become credential metadata, which is
/// exactly what the type's identity probe would capture on a fresh login — so
/// the zone API keeps working without re-authenticating.
fn import_tado(legacy: &Connection, store: &Connection, now: i64) -> Result<bool, String> {
    if !has_table(legacy, "auth")? {
        return Ok(false);
    }
    let row: Option<(String, String, i64, String, i64, String)> = legacy
        .query_row(
            "SELECT access_token, refresh_token, expires_at, account_email, home_id, home_name FROM auth WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((access_token, refresh_token, expires_at, email, home_id, home_name)) = row else {
        return Ok(false);
    };
    let (access_token, _) = unprotect_or_legacy_plaintext(&access_token);
    let (refresh_token, _) = unprotect_or_legacy_plaintext(&refresh_token);
    if refresh_token.trim().is_empty() {
        return Ok(false);
    }

    let secret = SecretData {
        oauth: Some(OAuthTokens {
            access_token,
            refresh_token,
            expires_at,
        }),
        ..Default::default()
    };

    if db::find_by_type(store, registry::TADO_OAUTH2)?.is_some() {
        return Ok(false);
    }
    let type_def = registry::require(registry::TADO_OAUTH2)?;
    let mut metadata = serde_json::Map::new();
    metadata.insert("homeId".into(), serde_json::Value::from(home_id));
    metadata.insert("homeName".into(), serde_json::Value::from(home_name));

    let record = CredentialRecord {
        id: db::new_id(),
        type_id: registry::TADO_OAUTH2.to_string(),
        name: type_def.display_name.to_string(),
        account_label: Some(email).filter(|value| !value.trim().is_empty()),
        state: CredentialState::Connected,
        metadata,
        created_at: now,
        updated_at: now,
    };
    db::upsert_record(store, &record)?;
    db::save_secret(store, &record.id, &secret)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::db::migrate;

    fn store() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn legacy_github(token_column: Option<&str>) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE credentials (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              token_protected TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            );
            "#,
        )
        .unwrap();
        if let Some(token) = token_column {
            conn.execute(
                "INSERT INTO credentials (id, token_protected, updated_at) VALUES (1, ?1, 10)",
                [token],
            )
            .unwrap();
        }
        conn
    }

    #[test]
    fn missing_table_is_not_an_error() {
        let legacy = Connection::open_in_memory().unwrap();
        let store = store();
        assert!(!import_github(&legacy, &store, 1).unwrap());
    }

    #[test]
    fn empty_legacy_store_imports_nothing() {
        assert!(!import_github(&legacy_github(None), &store(), 1).unwrap());
    }

    /// A legacy value that is not a DPAPI blob is treated as plaintext (the
    /// same lazy-migration rule the old stores used), so no one has to re-enter
    /// a token that predates protection.
    #[cfg(windows)]
    #[test]
    fn plaintext_legacy_token_is_imported_and_protected() {
        let store = store();
        let imported = import_github(&legacy_github(Some("ghp_legacy")), &store, 1).unwrap();
        assert!(imported);

        let record = db::find_by_type(&store, registry::GITHUB_PAT)
            .unwrap()
            .unwrap();
        assert_eq!(record.state, CredentialState::Connected);
        let secret = db::load_secret(&store, &record.id).unwrap().unwrap();
        assert_eq!(secret.field("token"), Some("ghp_legacy"));

        let stored: String = store
            .query_row(
                "SELECT data_protected FROM credential_secrets WHERE credential_id = ?1",
                [&record.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!stored.contains("ghp_legacy"));
    }

    #[cfg(windows)]
    #[test]
    fn protected_legacy_token_roundtrips() {
        use crate::security::secrets::protect_secret;
        let protected = protect_secret("ghp_protected").unwrap();
        let store = store();
        assert!(import_github(&legacy_github(Some(&protected)), &store, 1).unwrap());

        let record = db::find_by_type(&store, registry::GITHUB_PAT)
            .unwrap()
            .unwrap();
        let secret = db::load_secret(&store, &record.id).unwrap().unwrap();
        assert_eq!(secret.field("token"), Some("ghp_protected"));
    }

    fn legacy_cloudflare(row: Option<(&str, &str)>) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE credentials (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              account_id TEXT NOT NULL,
              api_token TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            );
            "#,
        )
        .unwrap();
        if let Some((account_id, api_token)) = row {
            conn.execute(
                "INSERT INTO credentials (id, account_id, api_token, updated_at) VALUES (1, ?1, ?2, 10)",
                [account_id, api_token],
            )
            .unwrap();
        }
        conn
    }

    #[cfg(windows)]
    #[test]
    fn cloudflare_row_imports_both_fields() {
        let store = store();
        assert!(
            import_cloudflare(&legacy_cloudflare(Some(("acc-1", "cf-token"))), &store, 1).unwrap()
        );

        let record = db::find_by_type(&store, registry::CLOUDFLARE_WORKERS_AI)
            .unwrap()
            .unwrap();
        let secret = db::load_secret(&store, &record.id).unwrap().unwrap();
        assert_eq!(secret.field("accountId"), Some("acc-1"));
        assert_eq!(secret.field("apiToken"), Some("cf-token"));
    }

    /// A half-filled legacy row must not become a credential that claims to be
    /// connected.
    #[test]
    fn cloudflare_row_without_token_is_skipped() {
        assert!(!import_cloudflare(&legacy_cloudflare(Some(("acc-1", ""))), &store(), 1).unwrap());
        assert!(!import_cloudflare(&legacy_cloudflare(None), &store(), 1).unwrap());
    }

    fn legacy_calendar(
        app: Option<(&str, &str)>,
        tokens: Option<(&str, &str, i64, &str)>,
    ) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE oauth_tokens (
              provider TEXT PRIMARY KEY,
              access_token TEXT NOT NULL,
              refresh_token TEXT NOT NULL,
              expires_at INTEGER NOT NULL,
              account_email TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE oauth_app_credentials (
              provider TEXT PRIMARY KEY,
              client_id TEXT NOT NULL,
              client_secret_protected TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            );
            "#,
        )
        .unwrap();
        if let Some((client_id, protected)) = app {
            conn.execute(
                "INSERT INTO oauth_app_credentials VALUES ('google', ?1, ?2, 1)",
                [client_id, protected],
            )
            .unwrap();
        }
        if let Some((access, refresh, expires_at, email)) = tokens {
            conn.execute(
                "INSERT INTO oauth_tokens VALUES ('google', ?1, ?2, ?3, ?4, 1)",
                rusqlite::params![access, refresh, expires_at, email],
            )
            .unwrap();
        }
        conn
    }

    /// The whole point of the calendar migration: an already-connected account
    /// must survive without a new consent round-trip.
    #[cfg(windows)]
    #[test]
    fn calendar_import_keeps_the_connected_account() {
        let store = store();
        let legacy = legacy_calendar(
            Some((
                "cid",
                &crate::security::secrets::protect_secret("csecret").unwrap(),
            )),
            Some(("at", "rt", 1_700_000_000, "alex@example.com")),
        );
        assert!(import_google_calendar(&legacy, &store, 1).unwrap());

        let record = db::find_by_type(&store, registry::GOOGLE_CALENDAR_OAUTH2)
            .unwrap()
            .unwrap();
        assert_eq!(record.state, CredentialState::Connected);
        assert_eq!(record.account_label.as_deref(), Some("alex@example.com"));

        let secret = db::load_secret(&store, &record.id).unwrap().unwrap();
        assert_eq!(secret.field("clientId"), Some("cid"));
        assert_eq!(secret.field("clientSecret"), Some("csecret"));
        let tokens = secret.oauth.unwrap();
        assert_eq!(tokens.refresh_token, "rt");
        assert_eq!(tokens.expires_at, 1_700_000_000);
    }

    /// Client details without tokens are values, not a connection.
    #[cfg(windows)]
    #[test]
    fn calendar_import_without_tokens_stays_unconfigured() {
        let store = store();
        let legacy = legacy_calendar(
            Some((
                "cid",
                &crate::security::secrets::protect_secret("csecret").unwrap(),
            )),
            None,
        );
        assert!(import_google_calendar(&legacy, &store, 1).unwrap());

        let record = db::find_by_type(&store, registry::GOOGLE_CALENDAR_OAUTH2)
            .unwrap()
            .unwrap();
        assert_eq!(record.state, CredentialState::Unconfigured);
        assert!(db::load_secret(&store, &record.id)
            .unwrap()
            .unwrap()
            .oauth
            .is_none());
    }

    #[test]
    fn calendar_import_skips_an_empty_legacy_db() {
        assert!(!import_google_calendar(&legacy_calendar(None, None), &store(), 1).unwrap());
    }

    /// Google tokens were stored in plaintext before this layer; the imported
    /// blob must not be.
    #[cfg(windows)]
    #[test]
    fn calendar_import_protects_previously_plaintext_tokens() {
        let store = store();
        let legacy = legacy_calendar(None, Some(("at", "plain-refresh", 10, "a@b.c")));
        assert!(import_google_calendar(&legacy, &store, 1).unwrap());

        let record = db::find_by_type(&store, registry::GOOGLE_CALENDAR_OAUTH2)
            .unwrap()
            .unwrap();
        let stored: String = store
            .query_row(
                "SELECT data_protected FROM credential_secrets WHERE credential_id = ?1",
                [&record.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!stored.contains("plain-refresh"));
    }

    fn legacy_tado(row: Option<(&str, &str, i64, &str, i64, &str)>) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE auth (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              access_token TEXT NOT NULL,
              refresh_token TEXT NOT NULL,
              expires_at INTEGER NOT NULL,
              account_email TEXT NOT NULL,
              home_id INTEGER NOT NULL,
              home_name TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            );
            "#,
        )
        .unwrap();
        if let Some((access, refresh, expires_at, email, home_id, home_name)) = row {
            conn.execute(
                "INSERT INTO auth VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, 1)",
                rusqlite::params![access, refresh, expires_at, email, home_id, home_name],
            )
            .unwrap();
        }
        conn
    }

    /// The home id has to survive: the zone API addresses every request with
    /// it, so losing it would break the widget even though the tokens are fine.
    #[cfg(windows)]
    #[test]
    fn tado_import_keeps_tokens_and_home_metadata() {
        let store = store();
        let legacy = legacy_tado(Some((
            &crate::security::secrets::protect_secret("at").unwrap(),
            &crate::security::secrets::protect_secret("rt").unwrap(),
            1_700_000_000,
            "alex@example.com",
            4242,
            "Home",
        )));
        assert!(import_tado(&legacy, &store, 1).unwrap());

        let record = db::find_by_type(&store, registry::TADO_OAUTH2)
            .unwrap()
            .unwrap();
        assert_eq!(record.state, CredentialState::Connected);
        assert_eq!(record.account_label.as_deref(), Some("alex@example.com"));
        assert_eq!(
            record.metadata.get("homeId").unwrap(),
            &serde_json::json!(4242)
        );
        assert_eq!(
            record.metadata.get("homeName").unwrap(),
            &serde_json::json!("Home")
        );

        let tokens = db::load_secret(&store, &record.id)
            .unwrap()
            .unwrap()
            .oauth
            .unwrap();
        assert_eq!(tokens.access_token, "at");
        assert_eq!(tokens.refresh_token, "rt");
    }

    #[test]
    fn tado_import_skips_a_row_without_a_refresh_token() {
        let legacy = legacy_tado(Some(("at", "", 1, "a@b.c", 1, "Home")));
        assert!(!import_tado(&legacy, &store(), 1).unwrap());
        assert!(!import_tado(&legacy_tado(None), &store(), 1).unwrap());
    }

    /// Re-running an import must never create a second credential.
    #[cfg(windows)]
    #[test]
    fn import_is_idempotent() {
        let store = store();
        let legacy = legacy_github(Some("ghp_legacy"));
        assert!(import_github(&legacy, &store, 1).unwrap());
        assert!(!import_github(&legacy, &store, 2).unwrap());
        assert_eq!(db::list(&store).unwrap().len(), 1);
    }
}
