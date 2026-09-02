# Calendar Widget + Google Calendar Sync — Design

**Date:** 2026-07-19  
**Status:** Approved for implementation planning  
**Approach:** Provider trait + Google first (Outlook-shaped Integrations slot later)

## Goal

Add a first-party **Calendar** widget: compact month (event dots), day event list, and light **quick add**. V1 syncs with **Google Calendar** (read + create). Settings and Rust APIs are shaped so **Outlook / Microsoft 365** can plug in later under the same Integrations → Calendar tree without rewriting the widget.

## Decisions

| Topic | Choice |
|-------|--------|
| Sync | Real calendar API sync (not ICS-only) |
| V1 provider | Google Calendar |
| Later providers | Outlook under same Settings/commands shape |
| Capabilities | Read + light write (quick create); no edit/delete/recurrence in V1 |
| Widget surface | Hybrid: month dots + selected-day list + quick add |
| Accounts | One Google account app-global |
| Calendars | Multi-select checkboxes (which calendars to show) |
| Secrets | OAuth tokens in Rust SQLite only (Tado pattern); never Vue/localStorage |
| Architecture | Thin `CalendarProvider` trait; `GoogleCalendarProvider` for V1 |
| Settings nav | Integrations → Calendar → Google (Outlook reserved/hidden until implemented) |
| Instance prefs | Selected calendar IDs + UI prefs in per-instance localStorage |
| List scope | Selected day only (default selection = today) |
| Refresh | On mount, after create, manual Refresh; ~5 min poll while resumed |

## Requirements

### Behavior

- Extension id `calendar`, catalog name “Calendar”, category `information`
- `allowDuplicate: true` — same account, different calendar subsets / placements
- On duplicate: copy selected calendars + prefs; do **not** copy cached event payloads
- On dispose: clear that instance’s localStorage key
- Per-instance localStorage `kavibay:calendar:{instanceId}`:
  - `selectedCalendarIds: string[]`
  - `defaultCalendarId: string | null` (quick-add target; fallback primary)
  - optional UI prefs later (e.g. week start) — only if needed in V1
- Account tokens are **app-global** (not per widget)
- Month grid: today highlighted; days with ≥1 event from selected calendars show a dot
- Click/select day → list that day’s events (time range, title, calendar color when available)
- Optional: if event has a meeting URL, affordance to open in system browser
- Quick add: title (required) + start (default next hour on selected day) + optional duration (default 30m) + target calendar → `create_event` → refresh dots/list
- Menu: Refresh; Open Google Calendar (browser)
- Suspend: stop background poll; Resume: refresh + restart poll

### Visual (widget)

- Compact month on top
- Event list for selected day
- Quick-add row/section at bottom
- Empty / misconfigured states:
  - Not connected → Connect CTA (Settings and/or inline auth panel like Tado)
  - Needs reauth → Reconnect CTA
  - Connected, no calendars selected → hint to open widget settings
  - Day with no events → minimal empty hint

### Widget settings popover

- Calendar checkboxes from `list_calendars`
- Default calendar for quick add

### Settings modal

Under existing Integrations tree:

- **Integrations**
  - … existing (LLM, Tado, …)
  - **Calendar**
    - **Google** — Connect / Disconnect / status (`not configured` | `connected` | `needs reauth`)
    - **Outlook** — out of scope for V1 (hidden or disabled placeholder only if it clarifies the slot; prefer hidden until implemented)

### States

| State | UI |
|-------|-----|
| Not connected | Widget + Settings show connect CTA |
| Connected, idle | Month/list/quick add work when calendars selected |
| Needs reauth | Reconnect CTA; last cached list optional |
| Network / API error | Inline error; keep last good data if any |
| Quick add validation | Block empty title; field hint |
| Create failed | Inline error; form stays filled |
| Polling | Silent refresh; no full-widget spinner on every poll |

### Out of scope (V1)

- Outlook / Microsoft Graph provider implementation
- Multiple Google accounts
- Edit, delete, drag-reschedule, recurrence UI
- Full week/day planner views
- ICS-only read path as primary sync
- Encrypted-at-rest vault beyond OS profile permissions on the SQLite file
- Push / webhook live sync (polling is enough)

## Architecture

### Layers

| Layer | Responsibility |
|-------|----------------|
| Rust `calendar` module | Provider trait, Google OAuth + API, token SQLite, shared DTOs, Tauri commands |
| Settings `GoogleCalendarPanel` | Connect / disconnect / status |
| Settings modal nav | Integrations → Calendar → Google |
| Extension `src/extensions/calendar/` | Hybrid UI, quick add, per-instance calendar selection, invoke + display |

### Provider trait (conceptual)

Shared DTOs (names indicative):

- `CalendarInfo { id, name, color?, primary? }`
- `CalendarEvent { id, calendarId, title, start, end, allDay, color?, meetingUrl? }`
- `CreateEventInput { calendarId, title, start, end }` (end from duration)

Provider methods:

- Auth status / start / cancel / disconnect (Google-specific UX may wrap these)
- `list_calendars() -> CalendarInfo[]`
- `list_events(calendar_ids, range_start, range_end) -> CalendarEvent[]`
- `create_event(input) -> CalendarEvent`

V1: `GoogleCalendarProvider` only. Commands stay provider-agnostic so Outlook can implement the same surface later (auth entrypoints may be provider-specific under the hood).

### Credential store (SQLite)

Path: `{app_data_dir}/calendar.db` (or equivalent under app data).

**Table `oauth_tokens`** (single Google account row for V1; schema allows `provider` for later):

| Column | Notes |
|--------|--------|
| `provider` | e.g. `google` (PK or part of PK) |
| `access_token` | Never returned to frontend |
| `refresh_token` | Never returned to frontend |
| `expires_at` | Unix seconds |
| `account_email` | Optional display in Settings |
| `updated_at` | Unix seconds |

Frontend status commands return only safe fields (`connected`, `needs_reauth`, `account_email?`).

### OAuth / Google API

- Desktop OAuth client; tokens handled only in Rust
- Scopes: read calendar list + events, create events (minimal write; no delete/edit required for V1)
- Prefer a desktop-friendly flow consistent with existing Tado device-flow UX where possible; exact Google flow (device vs loopback/PKCE) decided in the implementation plan against current Google OAuth policies
- Client credentials: Rust-side / build config — never shipped into Vue storage
- API: Google Calendar v3 — calendarList, events.list (range covering visible month + selected day), events.insert for quick add
- Token refresh in Rust; refresh failure → `needs_reauth`

### Tauri commands (indicative)

| Command | Purpose |
|---------|---------|
| `calendar_auth_start` | Begin Google connect flow |
| `calendar_auth_status` | Safe status DTO |
| `calendar_auth_cancel` | Cancel in-flight connect (if applicable) |
| `calendar_auth_disconnect` | Clear tokens |
| `calendar_list_calendars` | Calendars for checkbox UI |
| `calendar_list_events` | Events for `{ calendarIds, rangeStart, rangeEnd }` |
| `calendar_create_event` | Quick add `{ calendarId, title, start, end }` |

### Data flow

```
Settings → Google connect → OAuth → SQLite tokens
Widget settings → list_calendars → user selects IDs → localStorage
Widget mount / poll / day change → list_events(range) → month dots + day list
Quick add → create_event → list_events refresh
```

### Refresh policy

- Fetch a range that covers the **visible month** (for dots) whenever the month or selected calendars change
- Day list filters that cache/result for the selected day (or a dedicated day fetch if simpler)
- Poll ~5 minutes while widget resumed; stop on suspend
- Always refresh after successful create

## Testing

- Tokens: connect → status connected; disconnect → not configured; status never includes tokens
- Mapping: Google event fixtures → shared `CalendarEvent` DTO (all-day, timed, meeting URL)
- Create: valid payload → inserted event returned; validation rejects empty title at UI (and defensively in Rust)
- Widget helpers: month day keys, dots from events, default start/duration for quick add
- Isolation: two instances with different `selectedCalendarIds` show different subsets
- Missing auth: commands return clear errors; widget shows Connect CTA
- Dispose removes `kavibay:calendar:{instanceId}`

## File touch list (expected)

- `src-tauri/src/calendar/` (new: mod, provider trait, google provider, auth, db, api, commands)
- `src-tauri/src/lib.rs` — register commands
- `src/settings/SettingsModal.vue` — Calendar under Integrations
- `src/settings/GoogleCalendarPanel.vue` (new; name may match existing panel conventions)
- `src/extensions/calendar/` (new: manifest, widget, settings, menu, logic, composables)
- Docs: this spec; thin implementation plan next
