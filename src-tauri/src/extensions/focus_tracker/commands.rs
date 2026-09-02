//! Tauri commands for Focus Tracker status, summaries, and habit rules.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, TimeZone};
use tauri::State;

use super::db::FocusDb;
use super::tracker::FocusTrackerState;
use super::types::{
    FocusRange, FocusSummary, FocusTrackerStatus, GroupBy, HabitRule, IgnoreRule, IgnoreRuleKind,
};

/// Live tracker status from managed state (no DB).
#[tauri::command]
pub fn focus_tracker_status(state: State<'_, Arc<FocusTrackerState>>) -> FocusTrackerStatus {
    let available = state.available.load(Ordering::SeqCst);
    let idle = state.idle.load(Ordering::SeqCst);
    FocusTrackerStatus {
        available,
        // Actively recording when the poller is up and the user is not idle.
        tracking: available && !idle,
        idle,
    }
}

/// Aggregate focus sessions for a local day/week/month range.
#[tauri::command]
pub fn focus_tracker_summary(
    db: State<'_, Arc<FocusDb>>,
    range: String,
    group_by: String,
) -> Result<FocusSummary, String> {
    let range = parse_range(&range)?;
    let group_by = parse_group_by(&group_by)?;
    let (start_ms, end_ms) = range_bounds_ms(range, Local::now());
    let payload = db.with_conn(|conn| super::db::summary(conn, start_ms, end_ms, group_by))?;
    Ok(FocusSummary {
        range,
        group_by: payload.group_by,
        rows: payload.rows,
        habits: payload.habits,
        total_ms: payload.total_ms,
    })
}

/// List all habit rules ordered by app name.
#[tauri::command]
pub fn focus_tracker_list_habit_rules(
    db: State<'_, Arc<FocusDb>>,
) -> Result<Vec<HabitRule>, String> {
    db.with_conn(super::db::list_habit_rules)
}

/// Insert or update a habit rule; rejects empty name and non-positive limits.
#[tauri::command]
pub fn focus_tracker_upsert_habit_rule(
    db: State<'_, Arc<FocusDb>>,
    app_name: String,
    limit_minutes: i64,
) -> Result<HabitRule, String> {
    let app_name = app_name.trim();
    if app_name.is_empty() {
        return Err("app_name required".into());
    }
    if limit_minutes <= 0 {
        return Err("limit_minutes must be > 0".into());
    }
    db.with_conn(|conn| super::db::upsert_habit_rule(conn, app_name, limit_minutes))
}

/// Delete a habit rule by id.
#[tauri::command]
pub fn focus_tracker_delete_habit_rule(db: State<'_, Arc<FocusDb>>, id: i64) -> Result<(), String> {
    db.with_conn(|conn| super::db::delete_habit_rule(conn, id))
}

/// Distinct recent app names (default limit 20).
#[tauri::command]
pub fn focus_tracker_recent_apps(
    db: State<'_, Arc<FocusDb>>,
    limit: Option<i64>,
) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(20);
    db.with_conn(|conn| super::db::recent_apps(conn, limit))
}

/// Lists all exclusions shown in Focus Tracker settings.
#[tauri::command]
pub fn focus_tracker_list_ignore_rules(
    db: State<'_, Arc<FocusDb>>,
) -> Result<Vec<IgnoreRule>, String> {
    db.with_conn(super::db::list_ignore_rules)
}

/// Adds an exact app or window-title exclusion.
#[tauri::command]
pub fn focus_tracker_upsert_ignore_rule(
    db: State<'_, Arc<FocusDb>>,
    kind: String,
    value: String,
) -> Result<IgnoreRule, String> {
    let kind = parse_ignore_kind(&kind)?;
    let value = value.trim();
    if value.is_empty() {
        return Err("ignore value required".into());
    }
    db.with_conn(|conn| super::db::upsert_ignore_rule(conn, kind, value))
}

/// Removes an exclusion and lets the poller record it again on its next sample.
#[tauri::command]
pub fn focus_tracker_delete_ignore_rule(
    db: State<'_, Arc<FocusDb>>,
    id: i64,
) -> Result<(), String> {
    db.with_conn(|conn| super::db::delete_ignore_rule(conn, id))
}

/// Parse `day` / `week` / `month` (snake_case, matching frontend).
fn parse_range(s: &str) -> Result<FocusRange, String> {
    match s.trim() {
        "day" => Ok(FocusRange::Day),
        "week" => Ok(FocusRange::Week),
        "month" => Ok(FocusRange::Month),
        other => Err(format!("invalid range: {other}")),
    }
}

/// Parse `app` / `title` group-by tokens.
fn parse_group_by(s: &str) -> Result<GroupBy, String> {
    match s.trim() {
        "app" => Ok(GroupBy::App),
        "title" => Ok(GroupBy::Title),
        other => Err(format!("invalid group_by: {other}")),
    }
}

fn parse_ignore_kind(s: &str) -> Result<IgnoreRuleKind, String> {
    match s.trim() {
        "app" => Ok(IgnoreRuleKind::App),
        "title" => Ok(IgnoreRuleKind::Title),
        other => Err(format!("invalid ignore kind: {other}")),
    }
}

/// Local `[start_ms, end_ms)` bounds matching frontend `rangeBounds` (Mon-start week).
///
/// `end_ms` is `now` so open sessions clip against wall-clock time.
pub fn range_bounds_ms(range: FocusRange, now: DateTime<Local>) -> (i64, i64) {
    let end_ms = now.timestamp_millis();
    let today = now.date_naive();
    let start_date = match range {
        FocusRange::Day => today,
        FocusRange::Month => today.with_day(1).unwrap_or(today),
        FocusRange::Week => {
            // Monday-start week: Sunday falls in the prior week (ISO-style).
            let days_since_monday = today.weekday().num_days_from_monday() as i64;
            today - Duration::days(days_since_monday)
        }
    };
    let start_naive = start_date.and_time(NaiveTime::from_hms_opt(0, 0, 0).unwrap());
    let start_ms = Local
        .from_local_datetime(&start_naive)
        .single()
        .or_else(|| Local.from_local_datetime(&start_naive).earliest())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(end_ms);
    (start_ms, end_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Local;

    #[test]
    fn parse_range_and_group_by_accept_snake_case() {
        assert_eq!(parse_range("day").unwrap(), FocusRange::Day);
        assert_eq!(parse_range("week").unwrap(), FocusRange::Week);
        assert_eq!(parse_range("month").unwrap(), FocusRange::Month);
        assert!(parse_range("year").is_err());

        assert_eq!(parse_group_by("app").unwrap(), GroupBy::App);
        assert_eq!(parse_group_by("title").unwrap(), GroupBy::Title);
        assert!(parse_group_by("window").is_err());
    }

    #[test]
    fn range_bounds_match_frontend_monday_week() {
        // Fixed local Tuesday afternoon — week starts Monday 20 Jul 2026.
        let now = Local.with_ymd_and_hms(2026, 7, 21, 15, 30, 0).unwrap();
        let end = now.timestamp_millis();

        let (day_start, day_end) = range_bounds_ms(FocusRange::Day, now);
        assert_eq!(day_end, end);
        assert_eq!(
            day_start,
            Local
                .with_ymd_and_hms(2026, 7, 21, 0, 0, 0)
                .unwrap()
                .timestamp_millis()
        );

        let (week_start, week_end) = range_bounds_ms(FocusRange::Week, now);
        assert_eq!(week_end, end);
        assert_eq!(
            week_start,
            Local
                .with_ymd_and_hms(2026, 7, 20, 0, 0, 0)
                .unwrap()
                .timestamp_millis()
        );

        let (month_start, month_end) = range_bounds_ms(FocusRange::Month, now);
        assert_eq!(month_end, end);
        assert_eq!(
            month_start,
            Local
                .with_ymd_and_hms(2026, 7, 1, 0, 0, 0)
                .unwrap()
                .timestamp_millis()
        );

        // Sunday → prior Monday (not next week).
        let sunday = Local.with_ymd_and_hms(2026, 7, 19, 12, 0, 0).unwrap();
        let (sun_week_start, _) = range_bounds_ms(FocusRange::Week, sunday);
        assert_eq!(
            sun_week_start,
            Local
                .with_ymd_and_hms(2026, 7, 13, 0, 0, 0)
                .unwrap()
                .timestamp_millis()
        );
    }
}
