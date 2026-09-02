# Focus Tracker Widget — Design

**Date:** 2026-07-21  
**Status:** Approved for implementation planning  
**Tier:** L — new Rust module, Win32 focus/idle APIs, SQLite persistence  
**Approach:** App-global Rust background tracker + SQLite; Vue widget is read/query UI only

## Goal

Track which Windows applications (and window titles) were focused over time, so the user can spot overuse (e.g. Netflix). Show aggregated time in a compact widget with day/week/month filters, a horizontal bar chart, per-app habit limits, and a habits callout when limits are exceeded.

## Decisions

| Topic | Choice |
|-------|--------|
| Identity | App name + window title |
| Chart grouping | By app by default; toggle to by title |
| Habits | Chart + per-app minute limits + callout when over limit in selected range |
| Idle | Pause after **5 minutes** with no keyboard/mouse input (fixed in v1) |
| Privacy | Track everything (no exclude list in v1) |
| Tracker lifecycle | Starts with Kavibay; independent of widget mount |
| Persistence | SQLite (sessions + habit rules) |
| Platform | Windows only in v1 |
| Duplicate | `allowDuplicate: false` (data is global) |
| Retention | 90 days; prune on startup |

## Requirements

### Behavior

- Extension id `focus-tracker`, catalog name **Focus Tracker**, category `productivity`
- While Kavibay runs, Rust listens for foreground window changes and records sessions
- On focus change: end open session, start new with `app_name`, `window_title`, `started_at`
- Same process, title change (e.g. browser tab): debounce **~400ms**, then split session so “by title” stays accurate
- Idle: if no input for 5 minutes (`GetLastInputInfo`), end open session and stay paused until input resumes
- On Kavibay shutdown: close any open session
- Empty desktop / unresolved window: skip opening a session (do not invent fake rows)
- Widget queries aggregates for selected range; does not own the tracker process
- Habit rules: user picks specific apps and a minutes limit each; match `app_name` case-insensitively
- Habits evaluated against the **currently selected** range (day / week / month)

### Visual (widget)

- Width ~280–320px, dark glass Kavibay chrome
- Top: segmented **Day · Week · Month**; toggle **By app · By title**
- Habits callout (only if any rule over limit): e.g. `Netflix 2h 14m / 1h`
- Horizontal bar chart: label, bar proportional to share of total focused time, duration on the right
- Show top ~8–12 rows; “+N more” if needed (no endless scroll in v1)
- Footer status: `Tracking` or `Idle` (or `Tracking unavailable` on OS failure)

### Settings (gear)

- Habit rules list: add/remove app name + limit minutes
- Suggest recent `app_name`s from stored sessions when adding a rule
- Idle timeout and retention are fixed (not settings) in v1

### States

| State | UI |
|-------|-----|
| Tracking | Footer `Tracking`; chart shows data or empty hint |
| Idle (no input ≥5m) | Footer `Idle`; last aggregates still shown |
| No sessions in range | Empty chart hint |
| No habits over limit | Hide callout section |
| OS hook / DB failure | Short error; `Tracking unavailable` if listener dead |
| Query error | Inline error; chart empty |

### Out of scope (v1)

- macOS / Linux
- Exclude lists
- Configurable idle or retention
- Export / CSV
- Per-hour timeline
- Notifications when over limit
- Settings app nav (widget gear only)

## Architecture

### Layers

```
Win32 foreground + last-input
        ↓
Rust focus_tracker module (background)
  - session open/close
  - SQLite: focus_sessions, habit_rules
        ↓
Tauri commands (aggregates, habit CRUD, tracker status)
        ↓
Vue extension focus-tracker
  - range + group toggle
  - horizontal bars + habits callout
  - settings for habit rules
```

### Data model

**`focus_sessions`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer PK | |
| `app_name` | text | Process / display name |
| `window_title` | text | Title at session (split on title change) |
| `started_at` | integer | Unix ms |
| `ended_at` | integer nullable | Null = currently open |

**`habit_rules`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer PK | |
| `app_name` | text | Matched case-insensitively |
| `limit_minutes` | integer | Max allowed in selected range |

Aggregates are computed at query time (not stored): sum duration per app or per `(app_name, window_title)` for `[rangeStart, rangeEnd)`.

### Commands (illustrative)

| Command | Purpose |
|---------|---------|
| `focus_tracker_status` | `{ tracking: bool, idle: bool }` |
| `focus_tracker_summary` | `{ range, groupBy, rows[], habits[] }` |
| `focus_tracker_list_habit_rules` | List rules |
| `focus_tracker_upsert_habit_rule` | Add/update rule |
| `focus_tracker_delete_habit_rule` | Remove rule |
| `focus_tracker_recent_apps` | Distinct recent app names for settings picker |

Exact names finalized in the implementation plan; declare them on the extension manifest `commands`.

### Frontend files (planned)

| File | Responsibility |
|------|----------------|
| `src/extensions/focus-tracker/manifest.json` | Catalog |
| `src/extensions/focus-tracker/index.ts` | Module export |
| `src/extensions/focus-tracker/focusTrackerLogic.ts` | Types, range helpers, bar math, format duration |
| `src/extensions/focus-tracker/focusTrackerLogic.assert.ts` | Pure helper checks |
| `src/extensions/focus-tracker/FocusTrackerWidget.vue` | Controls, habits, bars, status |
| `src/extensions/focus-tracker/FocusTrackerSettings.vue` | Habit rules CRUD |

### Backend files (planned)

| File | Responsibility |
|------|----------------|
| `src-tauri/src/focus_tracker/mod.rs` | Module + startup hook |
| `src-tauri/src/focus_tracker/tracker.rs` | Win32 focus + idle loop |
| `src-tauri/src/focus_tracker/db.rs` | SQLite schema, prune, queries |
| `src-tauri/src/focus_tracker/commands.rs` | Tauri commands |

Reference patterns: `calendar` / `tado` for SQLite; `now_playing` / `color_picker` for Win32.

## Error handling

- Listener failure at startup: log; status reports unavailable; widget shows error (no fake sessions)
- DB write failure on session close: log; best-effort; do not crash the app
- Widget invoke failure: inline error string; keep prior good summary if any

## Testing

- TS assert script: range bounds, aggregation grouping, habit over-limit, bar width ratios, duration formatting
- Rust: session split / idle close logic unit-tested where practical without UI
- Manual: add widget; switch Day/Week/Month; toggle By title; add Netflix limit; confirm callout; leave idle 5+ minutes and confirm `Idle` + session closed

## Success criteria

1. Focus sessions are recorded while Kavibay runs, with app + title and start/end.
2. Idle pause works after 5 minutes without input.
3. Widget shows horizontal bars for day/week/month, with app/title toggle.
4. Per-app habit limits surface in a callout when exceeded in the selected range.
5. Data persists across restarts (SQLite); old sessions pruned after 90 days.
