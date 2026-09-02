# Focus Tracker Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Focus Tracker widget that records Windows focused app + window title sessions, shows day/week/month horizontal bar charts (app or title grouping), and flags per-app habit overages.

**Architecture:** App-global Rust background tracker (poll Win32 foreground + idle) writes sessions to SQLite. Tauri commands expose status, summary aggregates, habit CRUD, and recent apps. Vue extension is read/query UI only — tracker lifecycle is independent of widget mount.

**Tech Stack:** Vue 3 + TypeScript, Tauri 2, `rusqlite`, `windows` 0.61 (Win32 messaging / process / last-input).

## Global Constraints

- Extension id `focus-tracker`, name **Focus Tracker**, category `productivity`, `allowDuplicate: false`
- Track app name + window title; split session on title change after ~400ms debounce
- Idle pause after **5 minutes** no keyboard/mouse (`GetLastInputInfo`); fixed in v1
- Track everything (no exclude list)
- Tracker starts with Kavibay in `setup`; widget does not start/stop OS listening
- SQLite at `{app_data_dir}/focus_tracker.db`; retain **90 days**; prune on startup
- Ranges (local time): **Day** = today 00:00→now; **Week** = Monday 00:00→now; **Month** = 1st 00:00→now
- Habits: per-app `limit_minutes`; evaluated against **selected** range; case-insensitive `app_name` match
- Chart: by app default, toggle by title; top 10 rows + “+N more”; CSS horizontal bars (no chart lib)
- Windows only; non-Windows: tracker no-op, commands return empty/unavailable
- No Vitest — `npx tsx` assert scripts, `npx vue-tsc --noEmit`, `cargo test -p kavibay_lib focus_tracker::`, `cargo check -p kavibay_lib`, manual UI
- Spec: `docs/superpowers/specs/2026-07-21-focus-tracker-widget-design.md`
- Thin plan: implement code in the repo, not by pasting whole files here
- Match Kavibay dark glass UI; clone `system-info` / `stocks` (settings + invoke) + `calendar`/`tado` (SQLite)

## File Structure

| File | Responsibility |
|------|----------------|
| `src/extensions/focus-tracker/focusTrackerLogic.ts` | Types, range bounds, duration format, bar %, habit filter |
| `src/extensions/focus-tracker/focusTrackerLogic.assert.ts` | Node assert script |
| `src/extensions/focus-tracker/FocusTrackerWidget.vue` | Range, group toggle, habits callout, bars, status |
| `src/extensions/focus-tracker/FocusTrackerSettings.vue` | Habit rules CRUD + recent apps |
| `src/extensions/focus-tracker/manifest.json` | Catalog + commands |
| `src/extensions/focus-tracker/index.ts` | Extension module |
| `src-tauri/src/focus_tracker/mod.rs` | Module root, re-exports, startup |
| `src-tauri/src/focus_tracker/types.rs` | Serde DTOs shared with frontend |
| `src-tauri/src/focus_tracker/db.rs` | Schema, prune, sessions, habits, summary SQL |
| `src-tauri/src/focus_tracker/tracker.rs` | Win32 poll loop, idle, session open/close |
| `src-tauri/src/focus_tracker/commands.rs` | Tauri commands |
| `src-tauri/src/lib.rs` | `mod focus_tracker`; manage state; start tracker; register commands |
| `src-tauri/Cargo.toml` | Extra `windows` features if needed |

---

### Task 1: Frontend pure helpers

**Files:**
- Create: `src/extensions/focus-tracker/focusTrackerLogic.ts`
- Create: `src/extensions/focus-tracker/focusTrackerLogic.assert.ts`

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `export type FocusRange = "day" | "week" | "month"`
  - `export type FocusGroupBy = "app" | "title"`
  - `export interface FocusSummaryRow { key: string; app_name: string; window_title: string; duration_ms: number }`
  - `export interface FocusHabitHit { app_name: string; duration_ms: number; limit_minutes: number }`
  - `export interface FocusSummary { range: FocusRange; group_by: FocusGroupBy; rows: FocusSummaryRow[]; habits: FocusHabitHit[]; total_ms: number }`
  - `export interface FocusTrackerStatus { available: boolean; tracking: boolean; idle: boolean }`
  - `export interface HabitRule { id: number; app_name: string; limit_minutes: number }`
  - `rangeBounds(range: FocusRange, now: Date): { startMs: number; endMs: number }` — local Monday week start
  - `formatDuration(ms: number): string` — `2h 14m` / `45m` / `30s` (omit zero units; floor)
  - `barPercent(durationMs: number, totalMs: number): number` — 0–100; 0 if total 0
  - `topRows(rows: FocusSummaryRow[], limit = 10): { visible: FocusSummaryRow[]; moreCount: number }`
  - `habitsOverLimit(habits: FocusHabitHit[]): FocusHabitHit[]` — `duration_ms > limit_minutes * 60_000`

- [ ] **Step 1:** Implement helpers with short purpose comments on exports
- [ ] **Step 2:** Assert script: day/week/month bounds (fixed `now`), duration format, bar %, topRows moreCount, habit filter
- [ ] **Step 3:** Verify — `npx tsx src/extensions/focus-tracker/focusTrackerLogic.assert.ts` → exit 0
- [ ] **Step 4:** Commit `feat(focus-tracker): add pure range and chart helpers`

---

### Task 2: Rust DB + types

**Files:**
- Create: `src-tauri/src/focus_tracker/mod.rs`, `types.rs`, `db.rs`
- Modify: `src-tauri/src/lib.rs` — `mod focus_tracker;` only (no commands yet)

**Interfaces:**
- Consumes: `rusqlite`, `tauri::AppHandle` path helpers (mirror `calendar/db.rs`)
- Produces:
  - DB path `{app_data_dir}/focus_tracker.db`
  - Tables:
    - `focus_sessions(id INTEGER PK, app_name TEXT NOT NULL, window_title TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NULL)`
    - `habit_rules(id INTEGER PK, app_name TEXT NOT NULL UNIQUE COLLATE NOCASE, limit_minutes INTEGER NOT NULL)`
  - `open_db(app) -> Connection` + migrate + `prune_older_than(conn, cutoff_ms)` (90 days)
  - Session helpers: `insert_open_session`, `close_session(id, ended_at)`, `close_any_open(ended_at)`, `update` as needed
  - Habit helpers: `list_habit_rules`, `upsert_habit_rule(app_name, limit_minutes) -> HabitRule`, `delete_habit_rule(id)`
  - `recent_apps(conn, limit) -> Vec<String>` — distinct `app_name` by latest `started_at`
  - `summary(conn, start_ms, end_ms, group_by: GroupBy) -> FocusSummaryPayload`:
    - Clip each session to `[start_ms, end_ms)`; open session (`ended_at` null) uses `now_ms = end_ms`
    - Group by `app_name` or `(app_name, window_title)`; sort duration desc
    - Attach habit hits for rules where app sum in range exceeds limit
  - Types in `types.rs` with `serde` snake_case matching frontend interfaces above (`FocusSummary`, `FocusSummaryRow`, `FocusHabitHit`, `HabitRule`, `FocusTrackerStatus`, `GroupBy`)

- [ ] **Step 1:** Schema + helpers + unit tests on in-memory DB (insert/close, clip across range, group by app/title, habit hit, prune)
- [ ] **Step 2:** Verify — `cargo test -p kavibay_lib focus_tracker::db` → PASS
- [ ] **Step 3:** Commit `feat(focus-tracker): add sqlite sessions and habits`

---

### Task 3: Win32 tracker loop

**Files:**
- Create: `src-tauri/src/focus_tracker/tracker.rs`
- Modify: `src-tauri/src/focus_tracker/mod.rs`
- Modify: `src-tauri/Cargo.toml` — add windows features as needed:
  - `Win32_System_Threading`
  - `Win32_System_ProcessStatus` (or equivalent for `QueryFullProcessImageNameW`)
  - Existing `Win32_UI_WindowsAndMessaging`, `Win32_UI_Input_KeyboardAndMouse` already present

**Interfaces:**
- Consumes: `db` session helpers, `AppHandle`
- Produces:
  - `FocusTrackerState` (managed): `available: AtomicBool`, `idle: AtomicBool`, internal mutex for current session id / last focus key
  - `start_tracker(app: AppHandle, state: Arc<FocusTrackerState>)` — spawn dedicated thread; on non-Windows set `available=false` and return
  - Poll every **500ms**:
    1. Read idle via `GetLastInputInfo`; if idle ≥ 5 min → close open session, set `idle=true`, skip focus sample
    2. If was idle and input resumes → `idle=false`
    3. Read foreground: `GetForegroundWindow` → PID → exe base name (no `.exe`) as `app_name`; `GetWindowTextW` as `window_title`
    4. Skip if hwnd null / empty app / desktop worker as unresolved (no fake row)
    5. Focus key = `(app_name, window_title)`; title debounce: pending title change must be stable **400ms** before split
    6. On key change: close previous open session, insert new open session
  - `shutdown_tracker`: close any open session (call from `RunEvent::Exit` or Drop best-effort in setup cleanup if pattern exists; otherwise close on next process start via `close_any_open` at startup)
  - Startup: `open_db`, prune 90d, `close_any_open(now)` for crash recovery, then start thread

- [ ] **Step 1:** Implement poll loop + idle + debounce; unit-test pure helpers (e.g. idle threshold, debounce decision) if extracted; otherwise manual
- [ ] **Step 2:** Verify — `cargo check -p kavibay_lib` → OK
- [ ] **Step 3:** Commit `feat(focus-tracker): add win32 focus and idle poller`

---

### Task 4: Tauri commands + wire-up

**Files:**
- Create: `src-tauri/src/focus_tracker/commands.rs`
- Modify: `src-tauri/src/focus_tracker/mod.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `FocusTrackerState`, `db`, range computation can be done in Rust from `range: String` + `chrono` **or** accept `start_ms`/`end_ms` from frontend — **prefer Rust computes bounds** from `range` + local offset so widget stays simple
- Produces commands (declare exact names on manifest):
  - `focus_tracker_status() -> FocusTrackerStatus`
  - `focus_tracker_summary(range: String, group_by: String) -> FocusSummary` — validate enums; compute local bounds; include habit hits
  - `focus_tracker_list_habit_rules() -> Vec<HabitRule>`
  - `focus_tracker_upsert_habit_rule(app_name: String, limit_minutes: i64) -> HabitRule` — reject empty name / limit ≤ 0
  - `focus_tracker_delete_habit_rule(id: i64) -> ()`
  - `focus_tracker_recent_apps(limit: Option<i64>) -> Vec<String>` — default 20
- Wire: `mod focus_tracker`; `app.manage(FocusTrackerState::new())`; in `setup` call `focus_tracker::start(...)`; register all commands in `generate_handler![]`
- If `chrono` not in Cargo.toml, either add `chrono` with `clock` feature **or** compute bounds with `time` / manual local via Windows — prefer adding `chrono` if missing (check Cargo.toml first; reuse if present)

- [ ] **Step 1:** Implement commands + register + start tracker in setup
- [ ] **Step 2:** Verify — `cargo test -p kavibay_lib focus_tracker::` and `cargo check -p kavibay_lib` → PASS
- [ ] **Step 3:** Commit `feat(focus-tracker): expose summary and habit commands`

---

### Task 5: Extension scaffold + widget UI

**Files:**
- Create: `src/extensions/focus-tracker/manifest.json`, `index.ts`, `FocusTrackerWidget.vue`
- Reference UI: `src/extensions/stocks/StocksWidget.vue` (compact rows), `src/extensions/system-info/` (settings gear)

**Interfaces:**
- Consumes: Task 1 helpers + invoke commands from Task 4
- Produces:
  - Manifest: id `focus-tracker`, name Focus Tracker, category `productivity`, `allowDuplicate: false`, commands list matching Task 4, sensible `defaultOffset`
  - `index.ts`: `component` + `settingsComponent` (settings file may be stub until Task 6 — prefer create empty settings shell in Task 6 only; widget can ship without settingsComponent until then)
  - Widget:
    - Local state: `range`, `groupBy`, `summary`, `status`, `error`
    - Poll summary + status every **5s** while mounted (`onSuspended` not required unless extension hooks used — simple onMounted/onUnmounted interval is fine)
    - Controls: Day/Week/Month; By app / By title
    - Habits callout when `habitsOverLimit(summary.habits).length > 0`
    - Horizontal bars via `barPercent`; labels truncate; show `topRows(..., 10)`
    - Footer: Tracking / Idle / Tracking unavailable
    - Empty: “No focus data yet” / “Nothing in this range”

- [ ] **Step 1:** Scaffold extension + widget UI (dark glass, ~300px)
- [ ] **Step 2:** Verify — `npx vue-tsc --noEmit` → clean for new files; palette lists **Focus Tracker**
- [ ] **Step 3:** Commit `feat(focus-tracker): add widget with range chart UI`

---

### Task 6: Habit settings UI

**Files:**
- Create: `src/extensions/focus-tracker/FocusTrackerSettings.vue`
- Modify: `src/extensions/focus-tracker/index.ts` — set `settingsComponent`

**Interfaces:**
- Consumes: `focus_tracker_list_habit_rules`, `upsert`, `delete`, `recent_apps`
- Produces:
  - List existing rules (app + minutes + delete)
  - Add form: app name (text input; datalist from recent apps) + limit minutes + Add
  - Live-apply (no Save button), match other widget settings patterns
  - Validation: non-empty app, limit ≥ 1; show short inline error

- [ ] **Step 1:** Implement settings popover
- [ ] **Step 2:** Verify — `npx vue-tsc --noEmit`; manual add Netflix rule and see callout after usage
- [ ] **Step 3:** Commit `feat(focus-tracker): add habit rules settings`

---

### Task 7: End-to-end verification

**Files:** none new (fix only if gaps found)

- [ ] **Step 1:** `npx tsx src/extensions/focus-tracker/focusTrackerLogic.assert.ts`
- [ ] **Step 2:** `cargo test -p kavibay_lib focus_tracker::`
- [ ] **Step 3:** `cargo check -p kavibay_lib`
- [ ] **Step 4:** `npx vue-tsc --noEmit`

**Manual UI**
- [ ] Add Focus Tracker from palette
- [ ] Switch Day / Week / Month — bars update
- [ ] Toggle By title — rows change granularity
- [ ] Use another app 30s+ — appears after refresh/poll
- [ ] Add habit rule for an app with low limit — callout shows when over
- [ ] Stay idle 5+ minutes — footer shows Idle; session closed
- [ ] Restart Kavibay — past sessions still in chart; no stuck open session from crash path

- [ ] **Step 5:** Commit any fixes `fix(focus-tracker): …` or skip if clean

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| App + title sessions | 3 |
| Title-change split + debounce | 3 |
| 5 min idle pause | 3 |
| Tracker app-global / startup | 3–4 |
| SQLite + 90d prune | 2–3 |
| Day/week/month + horizontal bars | 1, 5 |
| App/title toggle | 5 |
| Per-app habits + callout | 2, 4, 5, 6 |
| Recent apps in settings | 4, 6 |
| Windows-only v1 | 3 |
| Error / unavailable states | 4, 5 |

## Out of scope (do not implement)

macOS/Linux, exclude lists, configurable idle/retention, export, timeline, notifications, Settings app nav.
