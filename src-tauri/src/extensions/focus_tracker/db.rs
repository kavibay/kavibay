//! SQLite persistence for focus sessions and habit rules.

#[cfg(test)]
use rusqlite::OptionalExtension;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use super::types::{
    FocusHabitHit, FocusSummaryPayload, FocusSummaryRow, GroupBy, HabitRule, IgnoreRule,
    IgnoreRuleKind,
};

/// Retention window for session rows (90 days in milliseconds).
pub const RETENTION_MS: i64 = 90 * 24 * 60 * 60 * 1000;

/// Shared SQLite connection for poller writes and command reads.
///
/// Opened once at startup (migrate + prune). Callers lock briefly per operation —
/// never hold the mutex across sleeps or UI awaits.
pub struct FocusDb {
    conn: Mutex<Connection>,
}

impl FocusDb {
    /// Opens `{app_data_dir}/focus_tracker.db`, migrates, prunes once, wraps in Arc.
    pub fn open(app: &AppHandle) -> Result<Arc<Self>, String> {
        let conn = connect_db(app)?;
        let cutoff_ms = now_ms().saturating_sub(RETENTION_MS);
        prune_older_than(&conn, cutoff_ms)?;
        Ok(Arc::new(Self {
            conn: Mutex::new(conn),
        }))
    }

    /// In-memory DB for boot fallback when the on-disk open fails.
    pub fn open_in_memory() -> Result<Arc<Self>, String> {
        let conn = Connection::open_in_memory().map_err(|error| error.to_string())?;
        migrate(&conn)?;
        Ok(Arc::new(Self {
            conn: Mutex::new(conn),
        }))
    }

    /// Runs `f` with exclusive access to the shared connection.
    pub fn with_conn<R>(
        &self,
        f: impl FnOnce(&Connection) -> Result<R, String>,
    ) -> Result<R, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "focus_tracker db lock poisoned".to_string())?;
        f(&conn)
    }
}

/// Resolves `{app_data_dir}/focus_tracker.db` and creates its parent directory.
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("focus_tracker.db"))
}

/// Opens the DB and applies schema/indexes without pruning (for tests / rare one-offs).
pub fn connect_db(app: &AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|error| error.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

/// Creates focus_sessions and habit_rules tables plus range-query indexes.
pub fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS focus_sessions (
          id INTEGER PRIMARY KEY,
          app_name TEXT NOT NULL,
          window_title TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER NULL
        );
        CREATE TABLE IF NOT EXISTS habit_rules (
          id INTEGER PRIMARY KEY,
          app_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          limit_minutes INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ignore_rules (
          id INTEGER PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('app', 'title')),
          value TEXT NOT NULL,
          UNIQUE(kind, value COLLATE NOCASE)
        );
        CREATE INDEX IF NOT EXISTS idx_focus_sessions_started
          ON focus_sessions(started_at);
        CREATE INDEX IF NOT EXISTS idx_focus_sessions_ended
          ON focus_sessions(ended_at);
        "#,
    )
    .map_err(|error| error.to_string())
}

/// Deletes sessions whose `started_at` is strictly before `cutoff_ms`.
pub fn prune_older_than(conn: &Connection, cutoff_ms: i64) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM focus_sessions WHERE started_at < ?1",
        params![cutoff_ms],
    )
    .map_err(|error| error.to_string())
}

/// Inserts an open session (`ended_at` null) and returns its row id.
///
/// Written only by the Win32 poller; the schema and the queries over it stay
/// cross-platform, so the tests keep exercising this everywhere.
#[cfg(any(windows, test))]
pub fn insert_open_session(
    conn: &Connection,
    app_name: &str,
    window_title: &str,
    started_at: i64,
) -> Result<i64, String> {
    conn.execute(
        r#"
        INSERT INTO focus_sessions (app_name, window_title, started_at, ended_at)
        VALUES (?1, ?2, ?3, NULL)
        "#,
        params![app_name, window_title, started_at],
    )
    .map_err(|error| error.to_string())?;
    Ok(conn.last_insert_rowid())
}

/// Closes one session by id with the given `ended_at` timestamp.
#[cfg(any(windows, test))]
pub fn close_session(conn: &Connection, id: i64, ended_at: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE focus_sessions SET ended_at = ?1 WHERE id = ?2 AND ended_at IS NULL",
        params![ended_at, id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// Closes every open session with the given `ended_at` timestamp.
pub fn close_any_open(conn: &Connection, ended_at: i64) -> Result<usize, String> {
    conn.execute(
        "UPDATE focus_sessions SET ended_at = ?1 WHERE ended_at IS NULL",
        params![ended_at],
    )
    .map_err(|error| error.to_string())
}

/// Lists all habit rules ordered by app name (case-insensitive).
pub fn list_habit_rules(conn: &Connection) -> Result<Vec<HabitRule>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, app_name, limit_minutes
            FROM habit_rules
            ORDER BY app_name COLLATE NOCASE ASC
            "#,
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(HabitRule {
                id: row.get(0)?,
                app_name: row.get(1)?,
                limit_minutes: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|error| error.to_string())?);
    }
    Ok(out)
}

/// Inserts or updates a habit rule by case-insensitive `app_name`.
pub fn upsert_habit_rule(
    conn: &Connection,
    app_name: &str,
    limit_minutes: i64,
) -> Result<HabitRule, String> {
    conn.execute(
        r#"
        INSERT INTO habit_rules (app_name, limit_minutes)
        VALUES (?1, ?2)
        ON CONFLICT(app_name) DO UPDATE SET
          limit_minutes = excluded.limit_minutes
        "#,
        params![app_name, limit_minutes],
    )
    .map_err(|error| error.to_string())?;

    conn.query_row(
        r#"
        SELECT id, app_name, limit_minutes
        FROM habit_rules
        WHERE app_name = ?1 COLLATE NOCASE
        "#,
        params![app_name],
        |row| {
            Ok(HabitRule {
                id: row.get(0)?,
                app_name: row.get(1)?,
                limit_minutes: row.get(2)?,
            })
        },
    )
    .map_err(|error| error.to_string())
}

/// Deletes a habit rule by id.
pub fn delete_habit_rule(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM habit_rules WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Lists exclusions, with apps first so the settings view reads naturally.
pub fn list_ignore_rules(conn: &Connection) -> Result<Vec<IgnoreRule>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, value FROM ignore_rules ORDER BY kind ASC, value COLLATE NOCASE ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let kind = match row.get::<_, String>(1)?.as_str() {
                "app" => IgnoreRuleKind::App,
                "title" => IgnoreRuleKind::Title,
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            Ok(IgnoreRule {
                id: row.get(0)?,
                kind,
                value: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

/// Saves an exact, case-insensitive app or title exclusion.
pub fn upsert_ignore_rule(
    conn: &Connection,
    kind: IgnoreRuleKind,
    value: &str,
) -> Result<IgnoreRule, String> {
    let kind_value = match kind {
        IgnoreRuleKind::App => "app",
        IgnoreRuleKind::Title => "title",
    };
    conn.execute(
        "INSERT OR IGNORE INTO ignore_rules (kind, value) VALUES (?1, ?2)",
        params![kind_value, value],
    )
    .map_err(|error| error.to_string())?;
    conn.query_row(
        "SELECT id, kind, value FROM ignore_rules WHERE kind = ?1 AND value = ?2 COLLATE NOCASE",
        params![kind_value, value],
        |row| {
            Ok(IgnoreRule {
                id: row.get(0)?,
                kind,
                value: row.get(2)?,
            })
        },
    )
    .map_err(|error| error.to_string())
}

/// Deletes one exclusion rule by id.
pub fn delete_ignore_rule(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM ignore_rules WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Checks whether an app or title must be omitted from tracking and summaries.
pub fn is_ignored(conn: &Connection, app_name: &str, window_title: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM ignore_rules WHERE (kind = 'app' AND value = ?1 COLLATE NOCASE) OR (kind = 'title' AND value = ?2 COLLATE NOCASE))",
        params![app_name, window_title],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

/// Distinct `app_name` values ordered by latest `started_at`, capped at `limit`.
pub fn recent_apps(conn: &Connection, limit: i64) -> Result<Vec<String>, String> {
    let limit = limit.max(0);
    let mut stmt = conn
        .prepare(
            r#"
            SELECT app_name
            FROM focus_sessions
            GROUP BY app_name
            ORDER BY MAX(started_at) DESC
            LIMIT ?1
            "#,
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|error| error.to_string())?);
    }
    Ok(out)
}

/// Aggregates clipped session durations in `[start_ms, end_ms)` and habit overages.
///
/// Open sessions (`ended_at` null) treat `end_ms` as now. Rows sort by duration descending.
pub fn summary(
    conn: &Connection,
    start_ms: i64,
    end_ms: i64,
    group_by: GroupBy,
) -> Result<FocusSummaryPayload, String> {
    if end_ms <= start_ms {
        return Ok(FocusSummaryPayload {
            group_by,
            rows: Vec::new(),
            habits: Vec::new(),
            total_ms: 0,
        });
    }

    let mut stmt = conn
        .prepare(
            r#"
            SELECT app_name, window_title, started_at, ended_at
            FROM focus_sessions
            WHERE started_at < ?2
              AND (ended_at IS NULL OR ended_at > ?1)
            "#,
        )
        .map_err(|error| error.to_string())?;

    let rows = stmt
        .query_map(params![start_ms, end_ms], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<i64>>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    // group_key -> (app_name, window_title, duration_ms)
    let mut grouped: HashMap<String, (String, String, i64)> = HashMap::new();
    // lowercase app -> total duration for habit evaluation
    let mut app_totals: HashMap<String, i64> = HashMap::new();
    // lowercase app -> display app_name (first seen casing)
    let mut app_display: HashMap<String, String> = HashMap::new();

    for row in rows {
        let (app_name, window_title, started_at, ended_at) =
            row.map_err(|error| error.to_string())?;
        let effective_end = ended_at.unwrap_or(end_ms);
        let clip_start = started_at.max(start_ms);
        let clip_end = effective_end.min(end_ms);
        let duration_ms = (clip_end - clip_start).max(0);
        if duration_ms <= 0 {
            continue;
        }

        if is_ignored(conn, &app_name, &window_title)? {
            continue;
        }

        let app_key = app_name.to_ascii_lowercase();
        *app_totals.entry(app_key.clone()).or_insert(0) += duration_ms;
        app_display
            .entry(app_key.clone())
            .or_insert_with(|| app_name.clone());

        // App grouping uses lowercase key so chart totals match habit case-folding;
        // display name keeps first-seen casing.
        let (key, row_app, row_title) = match group_by {
            GroupBy::App => {
                let display = app_display
                    .get(&app_key)
                    .cloned()
                    .unwrap_or_else(|| app_name.clone());
                (app_key, display, String::new())
            }
            GroupBy::Title => (
                format!("{app_name}\0{window_title}"),
                app_name,
                window_title,
            ),
        };
        let entry = grouped.entry(key).or_insert((row_app, row_title, 0));
        entry.2 += duration_ms;
    }

    let mut summary_rows: Vec<FocusSummaryRow> = grouped
        .into_iter()
        .map(
            |(key, (app_name, window_title, duration_ms))| FocusSummaryRow {
                key,
                app_name,
                window_title,
                duration_ms,
            },
        )
        .collect();
    summary_rows.sort_by(|a, b| {
        b.duration_ms
            .cmp(&a.duration_ms)
            .then_with(|| a.key.cmp(&b.key))
    });

    let total_ms: i64 = summary_rows.iter().map(|r| r.duration_ms).sum();

    let rules = list_habit_rules(conn)?;
    let mut habits = Vec::new();
    for rule in rules {
        let key = rule.app_name.to_ascii_lowercase();
        let duration_ms = app_totals.get(&key).copied().unwrap_or(0);
        let limit_ms = rule.limit_minutes.saturating_mul(60_000);
        if duration_ms > limit_ms {
            let display = app_display
                .get(&key)
                .cloned()
                .unwrap_or_else(|| rule.app_name.clone());
            habits.push(FocusHabitHit {
                app_name: display,
                duration_ms,
                limit_minutes: rule.limit_minutes,
            });
        }
    }
    habits.sort_by(|a, b| {
        b.duration_ms
            .cmp(&a.duration_ms)
            .then_with(|| a.app_name.cmp(&b.app_name))
    });

    Ok(FocusSummaryPayload {
        group_by,
        rows: summary_rows,
        habits,
        total_ms,
    })
}

/// Current unix time in milliseconds.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Loads a single session row for tests (id, app, title, started, ended).
#[cfg(test)]
fn load_session(
    conn: &Connection,
    id: i64,
) -> Result<(i64, String, String, i64, Option<i64>), String> {
    conn.query_row(
        "SELECT id, app_name, window_title, started_at, ended_at FROM focus_sessions WHERE id = ?1",
        params![id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )
    .optional()
    .map_err(|error| error.to_string())?
    .ok_or_else(|| format!("session {id} not found"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn migrate_creates_range_indexes() {
        let conn = mem_db();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN ('idx_focus_sessions_started', 'idx_focus_sessions_ended')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn insert_and_close_session() {
        let conn = mem_db();
        let id = insert_open_session(&conn, "Code", "main.rs", 1_000).unwrap();
        let row = load_session(&conn, id).unwrap();
        assert_eq!(row.1, "Code");
        assert_eq!(row.2, "main.rs");
        assert_eq!(row.3, 1_000);
        assert_eq!(row.4, None);

        close_session(&conn, id, 2_000).unwrap();
        let row = load_session(&conn, id).unwrap();
        assert_eq!(row.4, Some(2_000));
    }

    #[test]
    fn close_any_open_closes_all_open_sessions() {
        let conn = mem_db();
        let a = insert_open_session(&conn, "A", "t", 100).unwrap();
        let b = insert_open_session(&conn, "B", "t", 200).unwrap();
        close_session(&conn, a, 150).unwrap();

        let n = close_any_open(&conn, 300).unwrap();
        assert_eq!(n, 1);
        assert_eq!(load_session(&conn, a).unwrap().4, Some(150));
        assert_eq!(load_session(&conn, b).unwrap().4, Some(300));
    }

    #[test]
    fn summary_clips_sessions_across_range_and_open_uses_end_ms() {
        let conn = mem_db();
        // Fully inside: 1000–3000 → 2000ms in [0, 5000)
        insert_open_session(&conn, "In", "a", 1_000).unwrap();
        close_session(&conn, 1, 3_000).unwrap();
        // Overlaps start:  -500–1500 clipped to [0, 1500) → 1500ms
        conn.execute(
            "INSERT INTO focus_sessions (app_name, window_title, started_at, ended_at) VALUES ('Edge', 'x', -500, 1500)",
            [],
        )
        .unwrap();
        // Open session: started 4000, ended null → uses end_ms=5000 → 1000ms
        insert_open_session(&conn, "Open", "y", 4_000).unwrap();
        // Outside after range: ignored
        conn.execute(
            "INSERT INTO focus_sessions (app_name, window_title, started_at, ended_at) VALUES ('Late', 'z', 5000, 6000)",
            [],
        )
        .unwrap();

        let payload = summary(&conn, 0, 5_000, GroupBy::App).unwrap();
        assert_eq!(payload.total_ms, 2_000 + 1_500 + 1_000);
        let by_app: HashMap<_, _> = payload
            .rows
            .iter()
            .map(|r| (r.app_name.as_str(), r.duration_ms))
            .collect();
        assert_eq!(by_app["In"], 2_000);
        assert_eq!(by_app["Edge"], 1_500);
        assert_eq!(by_app["Open"], 1_000);
        assert!(!by_app.contains_key("Late"));
    }

    #[test]
    fn summary_groups_by_app_and_by_title() {
        let conn = mem_db();
        let id1 = insert_open_session(&conn, "Browser", "Tab A", 0).unwrap();
        close_session(&conn, id1, 1_000).unwrap();
        let id2 = insert_open_session(&conn, "Browser", "Tab B", 1_000).unwrap();
        close_session(&conn, id2, 4_000).unwrap();
        let id3 = insert_open_session(&conn, "Editor", "file", 0).unwrap();
        close_session(&conn, id3, 500).unwrap();

        let by_app = summary(&conn, 0, 10_000, GroupBy::App).unwrap();
        assert_eq!(by_app.rows.len(), 2);
        assert_eq!(by_app.rows[0].app_name, "Browser");
        assert_eq!(by_app.rows[0].window_title, "");
        assert_eq!(by_app.rows[0].duration_ms, 4_000);
        assert_eq!(by_app.rows[0].key, "browser");
        assert_eq!(by_app.rows[1].app_name, "Editor");
        assert_eq!(by_app.rows[1].duration_ms, 500);

        // Case variants of the same app fold into one row (first-seen display name).
        let id4 = insert_open_session(&conn, "browser", "Tab C", 5_000).unwrap();
        close_session(&conn, id4, 6_000).unwrap();
        let by_app_ci = summary(&conn, 0, 10_000, GroupBy::App).unwrap();
        let browser = by_app_ci
            .rows
            .iter()
            .find(|r| r.key == "browser")
            .expect("browser row");
        assert_eq!(browser.app_name, "Browser");
        assert_eq!(browser.duration_ms, 5_000);

        let by_title = summary(&conn, 0, 10_000, GroupBy::Title).unwrap();
        assert_eq!(by_title.rows.len(), 4);
        assert_eq!(by_title.rows[0].app_name, "Browser");
        assert_eq!(by_title.rows[0].window_title, "Tab B");
        assert_eq!(by_title.rows[0].duration_ms, 3_000);
        assert_eq!(by_title.rows[0].key, "Browser\0Tab B");
    }

    #[test]
    fn ignored_apps_and_titles_are_removed_from_existing_summaries() {
        let conn = mem_db();
        let app = insert_open_session(&conn, "Chrome", "Kavibay", 0).unwrap();
        close_session(&conn, app, 2_000).unwrap();
        let title = insert_open_session(&conn, "Code", "Secrets", 0).unwrap();
        close_session(&conn, title, 3_000).unwrap();

        upsert_ignore_rule(&conn, IgnoreRuleKind::App, "chrome").unwrap();
        upsert_ignore_rule(&conn, IgnoreRuleKind::Title, "secrets").unwrap();

        assert!(is_ignored(&conn, "Chrome", "Anything").unwrap());
        assert!(is_ignored(&conn, "Other", "Secrets").unwrap());
        assert!(!is_ignored(&conn, "Code", "main.rs").unwrap());

        let summary = summary(&conn, 0, 10_000, GroupBy::App).unwrap();
        assert!(summary.rows.is_empty());
        assert_eq!(summary.total_ms, 0);
    }

    #[test]
    fn summary_attaches_habit_hits_when_over_limit() {
        let conn = mem_db();
        let id = insert_open_session(&conn, "Netflix", "Home", 0).unwrap();
        close_session(&conn, id, 120_000).unwrap(); // 2 minutes
        upsert_habit_rule(&conn, "netflix", 1).unwrap(); // 1 minute limit
        upsert_habit_rule(&conn, "Other", 10).unwrap(); // no usage

        let payload = summary(&conn, 0, 200_000, GroupBy::App).unwrap();
        assert_eq!(payload.habits.len(), 1);
        assert_eq!(payload.habits[0].app_name, "Netflix");
        assert_eq!(payload.habits[0].duration_ms, 120_000);
        assert_eq!(payload.habits[0].limit_minutes, 1);
    }

    #[test]
    fn habit_upsert_is_case_insensitive_and_delete_works() {
        let conn = mem_db();
        let a = upsert_habit_rule(&conn, "Chrome", 30).unwrap();
        let b = upsert_habit_rule(&conn, "chrome", 45).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(b.limit_minutes, 45);
        assert_eq!(list_habit_rules(&conn).unwrap().len(), 1);

        delete_habit_rule(&conn, b.id).unwrap();
        assert!(list_habit_rules(&conn).unwrap().is_empty());
    }

    #[test]
    fn recent_apps_orders_by_latest_started_at() {
        let conn = mem_db();
        insert_open_session(&conn, "Old", "t", 100).unwrap();
        close_any_open(&conn, 200).unwrap();
        insert_open_session(&conn, "New", "t", 300).unwrap();
        close_any_open(&conn, 400).unwrap();
        insert_open_session(&conn, "Old", "t2", 500).unwrap();

        let apps = recent_apps(&conn, 10).unwrap();
        assert_eq!(apps, vec!["Old".to_string(), "New".to_string()]);
        assert_eq!(recent_apps(&conn, 1).unwrap(), vec!["Old".to_string()]);
    }

    #[test]
    fn prune_older_than_removes_old_sessions() {
        let conn = mem_db();
        insert_open_session(&conn, "Keep", "t", 1_000).unwrap();
        close_any_open(&conn, 1_100).unwrap();
        insert_open_session(&conn, "Drop", "t", 100).unwrap();
        close_any_open(&conn, 200).unwrap();

        let n = prune_older_than(&conn, 500).unwrap();
        assert_eq!(n, 1);
        let apps = recent_apps(&conn, 10).unwrap();
        assert_eq!(apps, vec!["Keep".to_string()]);
    }

    #[test]
    fn habit_exact_limit_is_not_a_hit() {
        let conn = mem_db();
        let id = insert_open_session(&conn, "App", "t", 0).unwrap();
        close_session(&conn, id, 60_000).unwrap();
        upsert_habit_rule(&conn, "App", 1).unwrap();
        let payload = summary(&conn, 0, 120_000, GroupBy::App).unwrap();
        assert!(payload.habits.is_empty());
    }
}
