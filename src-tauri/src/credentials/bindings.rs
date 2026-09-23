//! Persistent selections. Missing selected IDs are kept as tombstones: deleting
//! an account must never redirect a consumer to another account.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::AppHandle;

use super::{db, registry};

pub const HOST_OWNER: &str = "host:default";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionBinding {
    pub type_id: String,
    pub credential_id: Option<String>,
    pub available: bool,
    pub revision: i64,
}

pub fn initialize(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS connection_bindings (
            owner TEXT NOT NULL, type_id TEXT NOT NULL, credential_id TEXT NOT NULL,
            PRIMARY KEY(owner, type_id)
        );
        CREATE TABLE IF NOT EXISTS credential_revisions (
            credential_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0
        );
        CREATE TRIGGER IF NOT EXISTS credential_revision_insert AFTER INSERT ON credentials
        BEGIN INSERT INTO credential_revisions VALUES (NEW.id, 1)
            ON CONFLICT(credential_id) DO UPDATE SET revision = revision + 1; END;
        CREATE TRIGGER IF NOT EXISTS credential_revision_update AFTER UPDATE ON credentials
        BEGIN INSERT INTO credential_revisions VALUES (NEW.id, 1)
            ON CONFLICT(credential_id) DO UPDATE SET revision = revision + 1; END;
        CREATE TRIGGER IF NOT EXISTS credential_revision_secret AFTER UPDATE ON credential_secrets
        BEGIN INSERT INTO credential_revisions VALUES (NEW.credential_id, 1)
            ON CONFLICT(credential_id) DO UPDATE SET revision = revision + 1; END;",
    )
    .map_err(|e| e.to_string())
}

pub fn selection(
    conn: &Connection,
    owner: &str,
    type_id: &str,
) -> Result<ConnectionBinding, String> {
    registry::require(type_id)?;
    if owner.is_empty() {
        return Err("connection owner is required".into());
    }
    // The INSERT selects only when exactly one candidate exists, and never
    // overwrites a previous choice, including a deleted connection.
    conn.execute(
        "INSERT OR IGNORE INTO connection_bindings(owner, type_id, credential_id)
         SELECT ?1, ?2, MIN(id) FROM credentials WHERE type_id = ?2 HAVING COUNT(*) = 1",
        params![owner, type_id],
    )
    .map_err(|e| e.to_string())?;
    let mut id: Option<String> = conn
        .query_row(
            "SELECT credential_id FROM connection_bindings WHERE owner = ?1 AND type_id = ?2",
            params![owner, type_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    // No row of its own: follow the app-wide default.
    //
    // Read, never written. A consumer that has never chosen tracks the default
    // as it changes, which is what an app-wide default means; writing a copy
    // here would freeze whatever it happened to be the first time this card was
    // looked at, and a later change to the default would then skip every widget
    // that had merely been displayed once.
    //
    // This is not the fall-back the tombstone rule forbids. That rule says a
    // *deleted* credential must never redirect a consumer to a different one,
    // and a tombstone is still a row -- so it leaves `id` as `Some` and never
    // reaches this branch. Only the total absence of a choice does.
    if id.is_none() && owner != HOST_OWNER {
        id = conn
            .query_row(
                "SELECT credential_id FROM connection_bindings WHERE owner = ?1 AND type_id = ?2",
                params![HOST_OWNER, type_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
    }
    let record = id
        .as_deref()
        .map(|id| db::load(conn, id))
        .transpose()?
        .flatten();
    let revision = if let Some(id) = &id {
        conn.query_row(
            "SELECT revision FROM credential_revisions WHERE credential_id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(0)
    } else {
        0
    };
    Ok(ConnectionBinding {
        type_id: type_id.into(),
        credential_id: id,
        available: record
            .is_some_and(|r| r.type_id == type_id && r.state == db::CredentialState::Connected),
        revision,
    })
}

pub fn select(conn: &Connection, owner: &str, type_id: &str, id: &str) -> Result<(), String> {
    registry::require(type_id)?;
    if owner.is_empty() {
        return Err("connection owner is required".into());
    }
    let record = db::load(conn, id)?.ok_or("connection not found")?;
    if record.type_id != type_id {
        return Err("connection type mismatch".into());
    }
    conn.execute(
        "INSERT INTO connection_bindings VALUES (?1, ?2, ?3)
         ON CONFLICT(owner, type_id) DO UPDATE SET credential_id = excluded.credential_id",
        params![owner, type_id, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn connections_selection(
    app: AppHandle,
    owner: String,
    type_id: String,
) -> Result<ConnectionBinding, String> {
    selection(&db::open_db(&app)?, &owner, &type_id)
}

#[tauri::command]
pub fn connections_select(
    app: AppHandle,
    owner: String,
    type_id: String,
    credential_id: String,
) -> Result<(), String> {
    select(&db::open_db(&app)?, &owner, &type_id, &credential_id)
}

#[tauri::command]
pub fn connections_copy(app: AppHandle, source: String, target: String) -> Result<(), String> {
    let conn = db::open_db(&app)?;
    conn.execute("INSERT OR REPLACE INTO connection_bindings SELECT ?2, type_id, credential_id FROM connection_bindings WHERE owner = ?1", params![source, target])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Owner prefix of the Wizard's live preview.
///
/// A preview is a widget instance like any other, but its id is derived from
/// the package rather than minted per card (`wizard-preview-${extId}` in
/// `WidgetWizardPreviewHost.vue`). No desk catalog lists it, so a prune that
/// only kept what the catalog names would delete the account the person picked
/// for the preview every time the app started.
const PREVIEW_OWNER_PREFIX: &str = "widget:wizard-preview-";

/// Drop bindings belonging to widget instances that no longer exist.
///
/// `live` is every owner the desk catalog still lists. Removing a card already
/// disposes its binding, so this only collects what earlier sessions left
/// behind -- rows that are inert rather than harmful, since their ids are
/// never minted again.
///
/// An empty `live` prunes nothing. A genuinely empty desk has nothing worth
/// collecting, while an empty list arriving because the layout failed to load
/// would take every binding in the profile with it, so the two are not worth
/// telling apart: the cautious reading costs one stale row and the other costs
/// the person every account choice they ever made.
pub fn prune(conn: &Connection, live: &[String]) -> Result<usize, String> {
    if live.is_empty() {
        return Ok(0);
    }
    let mut stale: Vec<String> = Vec::new();
    let mut stmt = conn
        .prepare("SELECT DISTINCT owner FROM connection_bindings WHERE owner LIKE 'widget:%'")
        .map_err(|e| e.to_string())?;
    let owners = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for owner in owners {
        let owner = owner.map_err(|e| e.to_string())?;
        if owner.starts_with(PREVIEW_OWNER_PREFIX) {
            continue;
        }
        if !live.iter().any(|keep| keep == &owner) {
            stale.push(owner);
        }
    }
    let mut removed = 0usize;
    for owner in &stale {
        removed += conn
            .execute(
                "DELETE FROM connection_bindings WHERE owner = ?1",
                params![owner],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(removed)
}

#[tauri::command]
pub fn connections_prune(app: AppHandle, live: Vec<String>) -> Result<usize, String> {
    prune(&db::open_db(&app)?, &live)
}

#[tauri::command]
pub fn connections_dispose(app: AppHandle, owner: String) -> Result<(), String> {
    db::open_db(&app)?
        .execute("DELETE FROM connection_bindings WHERE owner = ?1", [owner])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn add(conn: &Connection, id: &str, type_id: &str) {
        db::upsert_record(
            conn,
            &db::CredentialRecord {
                id: id.into(),
                type_id: type_id.into(),
                name: id.into(),
                account_label: None,
                state: db::CredentialState::Connected,
                metadata: Default::default(),
                created_at: 0,
                updated_at: 0,
            },
        )
        .unwrap();
    }
    #[test]
    fn choices_are_persistent_and_never_fall_back() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        add(&conn, "a", "githubPat");
        assert_eq!(
            selection(&conn, "widget:1", "githubPat")
                .unwrap()
                .credential_id
                .as_deref(),
            Some("a")
        );
        add(&conn, "b", "githubPat");
        assert_eq!(
            selection(&conn, "widget:1", "githubPat")
                .unwrap()
                .credential_id
                .as_deref(),
            Some("a")
        );
        assert_eq!(
            selection(&conn, "widget:2", "githubPat")
                .unwrap()
                .credential_id,
            None
        );
        select(&conn, "widget:2", "githubPat", "b").unwrap();
        db::delete(&conn, "a").unwrap();
        let missing = selection(&conn, "widget:1", "githubPat").unwrap();
        assert_eq!(missing.credential_id.as_deref(), Some("a"));
        assert!(!missing.available);
        assert_eq!(
            selection(&conn, "widget:2", "githubPat")
                .unwrap()
                .credential_id
                .as_deref(),
            Some("b")
        );
        assert!(select(&conn, "widget:2", "notionApi", "b").is_err());
        assert!(select(&conn, "widget:2", "githubPat", "missing").is_err());
    }

    /// A consumer that has never chosen follows the app-wide default.
    ///
    /// Not a contradiction of the test above. That one forbids redirecting a
    /// consumer to a *different* credential when its own is deleted; this one
    /// is about a consumer that never had one, where the alternative is a card
    /// asking for an account on every restart though the app already knows
    /// which one to use.
    #[test]
    fn an_unbound_consumer_follows_the_app_wide_default() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        // Two, so the single-candidate auto-bind cannot be what answers here.
        add(&conn, "a", "githubPat");
        add(&conn, "b", "githubPat");
        assert_eq!(
            selection(&conn, "widget:fresh", "githubPat")
                .unwrap()
                .credential_id,
            None,
            "no default set yet, so there is nothing to follow"
        );

        select(&conn, HOST_OWNER, "githubPat", "b").unwrap();
        let followed = selection(&conn, "widget:fresh", "githubPat").unwrap();
        assert_eq!(followed.credential_id.as_deref(), Some("b"));
        assert!(
            followed.available,
            "an inherited default is usable, not merely named"
        );

        // Read-only: reading must not have given the widget a row of its own,
        // or the next change to the default would leave it behind.
        let owned: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM connection_bindings WHERE owner = ?1",
                ["widget:fresh"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owned, 0, "following the default must not write a binding");

        select(&conn, HOST_OWNER, "githubPat", "a").unwrap();
        assert_eq!(
            selection(&conn, "widget:fresh", "githubPat")
                .unwrap()
                .credential_id
                .as_deref(),
            Some("a"),
            "a consumer with no choice of its own tracks the default as it moves"
        );

        // An explicit choice outranks the default and stays put.
        select(&conn, "widget:picky", "githubPat", "b").unwrap();
        select(&conn, HOST_OWNER, "githubPat", "a").unwrap();
        assert_eq!(
            selection(&conn, "widget:picky", "githubPat")
                .unwrap()
                .credential_id
                .as_deref(),
            Some("b")
        );

        // The tombstone still wins: a deleted choice is an absent credential,
        // not an absent choice, so it must not quietly become the default.
        db::delete(&conn, "b").unwrap();
        let dead = selection(&conn, "widget:picky", "githubPat").unwrap();
        assert_eq!(dead.credential_id.as_deref(), Some("b"));
        assert!(!dead.available);
    }

    #[test]
    fn prune_drops_dead_instances_and_spares_everything_else() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        add(&conn, "a", "githubPat");
        select(&conn, HOST_OWNER, "githubPat", "a").unwrap();
        select(&conn, "widget:alive", "githubPat", "a").unwrap();
        select(&conn, "widget:gone", "githubPat", "a").unwrap();
        // Both id shapes `newInstanceId` can produce must be collectable.
        select(&conn, "widget:inst-1730000000000-abc123", "githubPat", "a").unwrap();
        select(&conn, "widget:wizard-preview-my-widget", "githubPat", "a").unwrap();

        let live = vec!["widget:alive".to_string()];
        // Two of the four `widget:` owners are collectable: the preview and the
        // live card are not.
        assert_eq!(prune(&conn, &live).unwrap(), 2);

        let left: Vec<String> = conn
            .prepare("SELECT owner FROM connection_bindings ORDER BY owner")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            left,
            vec![
                "host:default".to_string(),
                "widget:alive".to_string(),
                "widget:wizard-preview-my-widget".to_string(),
            ],
            "the app default, the live card and the Wizard preview all survive"
        );
    }

    /// The guard that makes the prune safe to run on every start.
    #[test]
    fn prune_with_no_live_owners_removes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        add(&conn, "a", "githubPat");
        select(&conn, "widget:one", "githubPat", "a").unwrap();
        select(&conn, "widget:two", "githubPat", "a").unwrap();
        assert_eq!(
            prune(&conn, &[]).unwrap(),
            0,
            "an empty catalog is more likely a failed load than an empty desk"
        );
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM connection_bindings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }
}
