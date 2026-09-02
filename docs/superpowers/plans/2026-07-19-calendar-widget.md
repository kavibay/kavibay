# Calendar Widget + Google Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Calendar widget with hybrid month/list/quick-add UI, Google Calendar OAuth sync (read + create), and Settings under Integrations → Calendar → Google, shaped for Outlook later.

**Architecture:** Rust `calendar` module owns a thin `CalendarProvider` trait, Google OAuth (loopback + PKCE), token SQLite, and Calendar API calls. Vue extension owns hybrid UI, per-instance calendar selection, and invoke wrappers. Tokens never enter frontend storage.

**Tech Stack:** Vue 3 + TypeScript, Tauri 2, `reqwest`, `rusqlite`, `sha2` (PKCE), `rand` (verifier), `open` (system browser), Google Calendar API v3.

## Global Constraints

- Extension id `calendar`, name **Calendar**, category `information`, `allowDuplicate: true`
- V1 provider: Google only; commands/DTOs provider-agnostic; Outlook hidden until a later plan
- One Google account app-global; multi-calendar checkboxes per widget instance
- Read + quick create only (no edit/delete/recurrence)
- Hybrid UI: month dots + selected-day list + quick add
- Tokens in `{app_data_dir}/calendar.db`; status DTO never includes tokens
- OAuth: Desktop client, **loopback `http://127.0.0.1:<port>/` + PKCE S256**, `access_type=offline`, `prompt=consent` on first connect
- Scopes: `https://www.googleapis.com/auth/calendar.calendarlist.readonly` + `https://www.googleapis.com/auth/calendar.events` + `https://www.googleapis.com/auth/userinfo.email`
- Client ID/secret from env `KAVIBAY_GOOGLE_CALENDAR_CLIENT_ID` / `KAVIBAY_GOOGLE_CALENDAR_CLIENT_SECRET` (Rust only)
- Poll ~5 min while resumed; stop on suspend; refresh after create
- No Vitest — Node assert scripts, `npx vue-tsc --noEmit`, `cargo test -p kavibay_lib calendar::`, `cargo check -p kavibay_lib`, manual UI
- Spec: `docs/superpowers/specs/2026-07-19-calendar-widget-design.md`
- Thin plan: implement code in the repo, not by pasting whole files from this document
- Match Kavibay dark glass UI; clone patterns from `tado` (auth) + `weather`/`todo` (widget prefs)

## File Structure

| File | Responsibility |
|------|----------------|
| `src/extensions/calendar/calendarLogic.ts` | Types, localStorage, month grid, dots, quick-add defaults |
| `src/extensions/calendar/calendarLogic.assert.ts` | Node assert script for pure helpers |
| `src/extensions/calendar/useCalendarState.ts` | Per-instance prefs cache + seed/dispose |
| `src/extensions/calendar/CalendarWidget.vue` | Hybrid UI + poll + quick add + auth empty states |
| `src/extensions/calendar/CalendarSettings.vue` | Calendar checkboxes + default calendar |
| `src/extensions/calendar/CalendarMenu.vue` | Refresh + Open Google Calendar |
| `src/extensions/calendar/CalendarAuthPanel.vue` | Inline connect/reauth (Tado-like) |
| `src/extensions/calendar/manifest.json` | Catalog + declared commands |
| `src/extensions/calendar/index.ts` | Extension module + lifecycle |
| `src/settings/GoogleCalendarPanel.vue` | Connect / disconnect / status |
| `src/settings/SettingsModal.vue` | Integrations → Calendar → Google nav |
| `src-tauri/src/calendar/mod.rs` | Module root |
| `src-tauri/src/calendar/types.rs` | Shared DTOs (`CalendarInfo`, `CalendarEvent`, …) |
| `src-tauri/src/calendar/provider.rs` | `CalendarProvider` trait |
| `src-tauri/src/calendar/db.rs` | SQLite `oauth_tokens` by provider |
| `src-tauri/src/calendar/google/mod.rs` | Google provider root |
| `src-tauri/src/calendar/google/auth.rs` | Loopback PKCE OAuth + refresh |
| `src-tauri/src/calendar/google/api.rs` | calendarList / events.list / events.insert + mapping |
| `src-tauri/src/calendar/google/fixtures/` | JSON fixtures for mapping tests |
| `src-tauri/src/calendar/commands.rs` | Tauri commands |
| `src-tauri/src/lib.rs` | `mod calendar` + register commands |
| `src-tauri/Cargo.toml` | Add `rand`, `open` (and `base64` already present) |

---

### Task 1: Frontend pure helpers (`calendarLogic`)

**Files:**
- Create: `src/extensions/calendar/calendarLogic.ts`
- Create: `src/extensions/calendar/calendarLogic.assert.ts`

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `CalendarPrefs { selectedCalendarIds: string[]; defaultCalendarId: string | null }`
  - `DEFAULT_CALENDAR_PREFS`, `calendarStorageKey`, `normalize/load/save/clearCalendarPrefs`, `prefsForDuplicate`
  - `MonthCell { dateKey: string; day: number; inMonth: boolean; isToday: boolean }`
  - `buildMonthGrid(year, monthIndex0, todayKey, weekStartsOn: 1 /* Monday */): MonthCell[]` (42 cells)
  - `dateKeyFromDate(d: Date): string` → `YYYY-MM-DD` local
  - `eventDotsForMonth(events: { start: string; allDay: boolean }[], year, monthIndex0): Set<string>`
  - `eventsForDay(events, dateKey): filtered sorted by start`
  - `defaultQuickAddStart(selectedDayKey: string, now: Date): Date` — next whole hour on that day (if day is today and hour passed, next hour; if future day, 09:00)
  - `defaultQuickAddEnd(start: Date, durationMinutes = 30): Date`
  - `monthRangeIso(year, monthIndex0): { rangeStart: string; rangeEnd: string }` — UTC/RFC3339 bounds covering the visible month grid (include leading/trailing overflow days)

- [ ] **Step 1:** Implement helpers in `calendarLogic.ts` with short purpose comments on exports
- [ ] **Step 2:** Assert script covering month grid length 42, today flag, dots, day filter sort, quick-add defaults, prefs normalize/duplicate
- [ ] **Step 3:** Verify — `npx tsx src/extensions/calendar/calendarLogic.assert.ts` → exit 0
- [ ] **Step 4:** Commit `feat(calendar): add pure month and prefs helpers`

---

### Task 2: Rust DTOs, DB, provider trait

**Files:**
- Create: `src-tauri/src/calendar/mod.rs`, `types.rs`, `provider.rs`, `db.rs`
- Modify: `src-tauri/src/lib.rs` — `mod calendar;` only (no commands yet)

**Interfaces:**
- Consumes: `rusqlite`, `tauri::AppHandle` path helpers (mirror `tado/db.rs`)
- Produces:
  - `CalendarInfo { id, name, color: Option<String>, primary: bool }`
  - `CalendarEvent { id, calendar_id, title, start, end, all_day, color: Option<String>, meeting_url: Option<String> }`
  - `CreateEventInput { calendar_id, title, start, end }` — ISO-8601 / RFC3339 strings; reject empty title in commands later
  - `CalendarAuthStatus { connected: bool, needs_reauth: bool, account_email: Option<String>, pending: bool }`
  - `trait CalendarProvider` with async-capable methods used by commands (list calendars / events / create); Google implements it
  - DB table `oauth_tokens(provider TEXT PRIMARY KEY, access_token, refresh_token, expires_at, account_email, updated_at)`
  - `load/save/clear_tokens(conn, provider)`, `open_db(app) -> calendar.db`

- [ ] **Step 1:** Add modules + DB open/migrate + unit test save/load/clear for `provider = "google"`
- [ ] **Step 2:** Verify — `cargo test -p kavibay_lib calendar::db` → PASS
- [ ] **Step 3:** Commit `feat(calendar): add token db and shared dtos`

---

### Task 3: Google Calendar API mapping + client

**Files:**
- Create: `src-tauri/src/calendar/google/mod.rs`, `api.rs`, `fixtures/*.json`
- Modify: `provider.rs` / `google/mod.rs` as needed

**Interfaces:**
- Consumes: access token string, `reqwest::Client`
- Produces:
  - `map_calendar_list_item(json) -> CalendarInfo`
  - `map_event(calendar_id, color, json) -> Option<CalendarEvent>` — timed + all-day; `hangoutLink` / `conferenceData` / first `https` in description → `meeting_url` when present
  - `list_calendars(token) -> Vec<CalendarInfo>`
  - `list_events(token, calendar_ids, range_start, range_end) -> Vec<CalendarEvent>` — fan-out per calendar (sequential OK for V1), merge sort by start
  - `create_event(token, CreateEventInput) -> CalendarEvent`
  - Base URL `https://www.googleapis.com/calendar/v3`
  - On 401 from API, callers treat as refresh/reauth (wired in Task 4/5)

- [ ] **Step 1:** Fixture-based unit tests for timed event, all-day event, meeting URL extraction, calendar list item
- [ ] **Step 2:** Implement mapping + HTTP helpers (no OAuth yet — tests use fixtures only for mapping; HTTP fns callable with a token)
- [ ] **Step 3:** Verify — `cargo test -p kavibay_lib calendar::google::api` → PASS
- [ ] **Step 4:** Commit `feat(calendar): map and call Google Calendar API`

---

### Task 4: Google OAuth (loopback + PKCE)

**Files:**
- Create: `src-tauri/src/calendar/google/auth.rs`
- Modify: `src-tauri/Cargo.toml` — `rand`, `open`
- Modify: `src-tauri/src/calendar/commands.rs` (auth commands only for now)

**Interfaces:**
- Consumes: env client id/secret; DB token helpers
- Produces commands:
  - `calendar_auth_start` → opens browser, binds `127.0.0.1:0`, redirect `http://127.0.0.1:{port}/`, PKCE, exchanges code, stores tokens + email; returns `{ pending: true }` then completes (or returns verification-less “started” and status polling like Tado — prefer **status polling**: `pending` until loopback finishes or cancel)
  - `calendar_auth_status` → `CalendarAuthStatus` (no tokens)
  - `calendar_auth_cancel` → abort in-flight listener if any
  - `calendar_auth_disconnect` → clear google row
- Token refresh helper used by API commands: if `expires_at` near, refresh; refresh fail → mark needs_reauth (e.g. clear access or set flag via empty refresh / status heuristic: connected + API 401 after refresh fail ⇒ `needs_reauth: true` when refresh_token missing/invalid)
- Missing env credentials → clear error string telling operator to set env vars

- [ ] **Step 1:** Implement PKCE + loopback listener + token exchange + refresh
- [ ] **Step 2:** Unit-test PKCE challenge shape (verifier length / S256 base64url) without network
- [ ] **Step 3:** Register auth commands in `lib.rs`; `cargo check -p kavibay_lib`
- [ ] **Step 4:** Commit `feat(calendar): add Google OAuth loopback pkce`

---

### Task 5: Data commands + provider wiring

**Files:**
- Modify: `src-tauri/src/calendar/commands.rs`, `mod.rs`, `lib.rs`

**Interfaces:**
- Produces:
  - `calendar_list_calendars() -> Vec<CalendarInfo>`
  - `calendar_list_events({ calendarIds, rangeStart, rangeEnd }) -> Vec<CalendarEvent>`
  - `calendar_create_event({ calendarId, title, start, end }) -> CalendarEvent` — reject empty/whitespace title
- Each command: ensure valid access token (refresh if needed) then call Google API
- Auth errors → `Err(String)` suitable for widget CTA

- [ ] **Step 1:** Implement commands + register all seven in `lib.rs` invoke handler
- [ ] **Step 2:** Verify — `cargo test -p kavibay_lib calendar::` && `cargo check -p kavibay_lib`
- [ ] **Step 3:** Commit `feat(calendar): expose list and create commands`

---

### Task 6: Settings — Integrations → Calendar → Google

**Files:**
- Create: `src/settings/GoogleCalendarPanel.vue`
- Modify: `src/settings/SettingsModal.vue`

**Interfaces:**
- Consumes: `calendar_auth_*` invokes
- Produces: Panel with status text, Connect, Disconnect, Cancel (when pending); show `account_email` when connected
- Nav: under Integrations add group label **Calendar** + nested **Google** (mirror LLM → Cloudflare nesting). Do **not** add Outlook row in V1.

- [ ] **Step 1:** Implement panel (follow `TadoPanel` / `CloudflareAiPanel` patterns)
- [ ] **Step 2:** Wire `SectionId` + nav + content switch
- [ ] **Step 3:** Verify — `npx vue-tsc --noEmit`
- [ ] **Step 4:** Commit `feat(settings): add Google Calendar integration panel`

---

### Task 7: Extension shell (manifest, state, settings, menu, lifecycle)

**Files:**
- Create: `manifest.json`, `index.ts`, `useCalendarState.ts`, `CalendarSettings.vue`, `CalendarMenu.vue`, `CalendarAuthPanel.vue`

**Interfaces:**
- `useCalendarState(instanceId)` — reactive prefs, debounced save
- `seedCalendarPrefsFrom` / `disposeCalendarState`
- Settings: load calendars via `calendar_list_calendars` when connected; checkboxes bound to `selectedCalendarIds`; select for `defaultCalendarId`
- Menu emits/calls: Refresh (custom event or provide/inject — match `NotesMenu` / `ClipboardMenu` pattern); Open Google Calendar → `https://calendar.google.com` via existing frontend open mechanism (`@tauri-apps/plugin-dialog` is file-only — use `window.open` or a tiny Rust `calendar_open_url` if needed; prefer `open` crate command `calendar_open_external({ url })` if `window.open` is blocked)
- `index.ts`: `onDuplicate` seed prefs; `onDispose` clear; `onSuspend` / `onResume` optional no-ops here if widget owns poll — **widget owns poll**, so suspend/resume hooks should signal via a tiny module-level set or the widget listens to host lifecycle if available; if host only calls hooks on extension module, put poll control in composable toggled from `onSuspend`/`onResume`
- Manifest `commands`: all `calendar_*` names used

- [ ] **Step 1:** Scaffold files + lifecycle wiring
- [ ] **Step 2:** Verify — `npx vue-tsc --noEmit`
- [ ] **Step 3:** Commit `feat(calendar): scaffold extension settings and menu`

---

### Task 8: Hybrid widget UI + poll + quick add

**Files:**
- Create: `src/extensions/calendar/CalendarWidget.vue`

**Interfaces:**
- Consumes: prefs, auth status, `calendar_list_events`, `calendar_create_event`, logic helpers
- Behavior:
  - Mount: auth status; if connected + calendars selected → fetch month range; select today
  - Month nav (prev/next) refetches range; dots from events; click day filters list
  - Event row: time + title + optional color; meeting link button when `meetingUrl` set
  - Quick add: title, datetime-local or compact time controls, duration default 30m, calendar select defaulting to `defaultCalendarId` / primary
  - Empty states per spec; keep last good events on fetch error
  - Poll 5 minutes while not suspended; clear interval on unmount/suspend
- Visual: compact dark glass, no new purple/glow theme

- [ ] **Step 1:** Implement widget
- [ ] **Step 2:** Verify — `npx vue-tsc --noEmit`
- [ ] **Step 3:** Commit `feat(calendar): add hybrid calendar widget ui`

---

## Manual UI checklist

- [ ] Palette → add Calendar
- [ ] Not connected → Connect CTA → Settings Google panel completes OAuth in browser → status connected + email
- [ ] Widget settings → select calendars → month shows dots
- [ ] Select today / other day → list updates
- [ ] Quick add → event appears after refresh
- [ ] Meeting link opens browser when present
- [ ] Menu Refresh + Open Google Calendar
- [ ] Duplicate instance → independent calendar selection
- [ ] Dispose → prefs key removed
- [ ] Disconnect → widget returns to connect CTA
- [ ] Suspend/hide (if applicable) stops poll; resume refreshes

## Operator setup (required before manual OAuth)

1. Google Cloud Console → create project → enable **Google Calendar API**
2. OAuth consent screen + Desktop OAuth client
3. Set process env for the Kavibay app:
   - `KAVIBAY_GOOGLE_CALENDAR_CLIENT_ID`
   - `KAVIBAY_GOOGLE_CALENDAR_CLIENT_SECRET`

---

## Spec coverage (self-check)

| Spec item | Task |
|-----------|------|
| Hybrid month + list + quick add | 1, 8 |
| Google OAuth tokens in SQLite | 2, 4 |
| Provider-shaped commands | 2, 3, 5 |
| Multi-calendar checkboxes | 7, 8 |
| Settings Integrations → Calendar → Google | 6 |
| Quick create | 5, 8 |
| Poll / suspend / duplicate / dispose | 7, 8 |
| Outlook later (slot only) | 6 (Google only; no Outlook row) |
| Meeting URL open | 8 |
| Mapping tests / prefs helpers | 1, 3 |
