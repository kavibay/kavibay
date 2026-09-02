# Tado Thermostat Extension — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Rust OAuth device flow + SQLite token store + classic Tado zone API (approach A)

## Goal

Add a first-party **Tado** extension that connects a Tado account via OAuth (device flow) and shows **one read-only thermostat widget per room/zone**, matching the dark square tile mockup (humidity, temperature, room name, mode, power indicator). No thermostat writes via the API.

Reference for auth/API semantics: [mattdavis90/node-tado-client](https://github.com/mattdavis90/node-tado-client) (spec only — not a Node dependency).

## Decisions

| Topic | Choice |
|-------|--------|
| Hardware / API | Classic Tado zones (`getZones` / `getZoneState`) only |
| Access | Read-only (no overlays, setpoints, presence writes) |
| Widgets | Hybrid: “Add all rooms” after connect; also add/remove individual instances |
| Home selection | Auto-pick first home from `getMe()` |
| Auth UX | Settings → Tado section **and** widget connect CTA when unauthenticated |
| Token / secrets | SQLite in Tauri app data; all HTTP + token logic in Rust |
| Client | Thin Rust client (reqwest); reuse `node-tado-client` as behavior reference |

## Requirements

### Behavior

- Extension id `tado`, catalog name “Tado”, category information / home
- `allowDuplicate: true` — one instance per zone
- Per-instance settings: `{ zoneId, zoneName }` (zoneName denormalized for empty/error UI)
- Account connection is **app-global** (not per widget)
- After connect: Settings offers **Add all rooms** — creates one widget per **HEATING** zone that does not already have a bound instance (skip `HOT_WATER` and other non-room types)
- Palette / normal add still works: new instance → zone picker when connected (picker lists HEATING zones only)
- Poll zone state ~every **60s** while mounted
- Mode / room labels: use strings returned by Tado (e.g. German `Frostschutz`) — no custom i18n layer in V1
- Power icon is **display-only** (ON/OFF from zone state), not a control

### Visual

- Flush dark square tile (`flush: true`, `defaultHideTitle: true`) matching the mockup
- Top-left: humidity pill (drop icon + `NN%`)
- Top-right: power glyph (muted; reflects ON/OFF)
- Center: large temperature — integer + smaller `°.d`
- Bottom: zone name; mode row with icon + Tado mode/overlay label
- Read-only: no setpoint UI, no clickable power

### States

| State | UI |
|-------|-----|
| Not connected | Short message + Connect (same device-flow UX as Settings) |
| Connected, no zone | Zone dropdown from live zone list |
| Loading | Compact loading on first fetch |
| Refresh error | Keep last good snapshot; subtle error hint |
| Zone gone | “Zone unavailable” + re-pick |
| Auth expired | Treat as disconnected; clear auth; show Connect |

### Out of scope (V1)

- Writing temperatures, overlays, schedules, or presence
- Tado X room APIs
- Multi-home picker (always first home)
- Background polling while overlay hidden / widget unmounted
- Encrypted-at-rest token vault beyond OS user profile permissions on the SQLite file
- Official Tado partner OAuth app registration (use the public device-flow `client_id` used by existing open-source clients)

## Architecture

### Layers

| Layer | Responsibility |
|-------|----------------|
| Rust `tado` module | Device OAuth, token refresh, SQLite, read-only Tado HTTP |
| Settings `TadoPanel` | Connect / disconnect / status / Add all rooms |
| Extension `src/extensions/tado/` | Tile UI, zone picker, per-instance settings |
| Host | Generic `addWidget(typeId, initialSettings?)` so Settings can seed zone bindings |

### Auth flow (device code)

1. Frontend calls `tado_auth_start`
2. Rust `POST https://login.tado.com/oauth2/device_authorize` with public `client_id` + `scope=offline_access` (`application/x-www-form-urlencoded`)
3. Returns `verification_uri_complete`, `user_code`, `expires_in`, `interval`
4. UI opens system browser to `verification_uri_complete` (include `client_id` on the URL if required by current Tado login)
5. Rust polls `POST …/oauth2/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code` until success, timeout, or cancel
6. On success: persist tokens; `GET /api/v2/me`; store first `homes[0].id` (+ name, account email)
7. Subsequent calls: Bearer access token; refresh via `grant_type=refresh_token` when expired or on 401; rewrite SQLite
8. `tado_auth_disconnect` deletes the auth row; widgets fall back to Connect CTA

Public device-flow client id (same family as open-source clients): `1bb50063-6b0c-4d11-bd99-387f4a91cc46`.

### SQLite

Path: `{app_data_dir}/tado.db` (Tauri `path().app_data_dir()`).

**Table `auth`** (single-row account store):

| Column | Notes |
|--------|--------|
| `id` | Constant `1` |
| `access_token` | Opaque |
| `refresh_token` | Opaque; required for reconnect without device flow |
| `expires_at` | Unix seconds (access token) |
| `account_email` | From `getMe` when available |
| `home_id` | First home |
| `home_name` | Display in Settings |
| `updated_at` | Last token/profile write |

No durable zones table — list zones live for pickers / Add all. Optional in-memory cache with short TTL only.

### Read-only API surface

| Call | Use |
|------|-----|
| `GET /api/v2/me` | Email + homes; pick first home |
| `GET /api/v2/homes/{home_id}/zones` | Zone list (id, name, type); UI filters to `type === "HEATING"` |
| `GET /api/v2/homes/{home_id}/zones/{zone_id}/state` | Temp, humidity, power, overlay/mode |

Map state → widget view model:

- `sensorDataPoints.insideTemperature.celsius`
- `sensorDataPoints.humidity.percentage`
- `setting.power` (ON/OFF)
- Mode label resolution (first match wins): active overlay type / termination that implies manual → show manual (hand) icon + overlay/setting label; else show schedule-style icon + `tadoMode` or equivalent schedule label from the payload. Exact string field chosen from fixture during implementation; no hardcoded German dictionary.

### Tauri commands

| Command | Role |
|---------|------|
| `tado_auth_start` | Begin device flow; return verification payload |
| `tado_auth_poll` / status | Report pending / connected / error (or combine with start + async completion) |
| `tado_auth_cancel` | Abort in-flight device poll |
| `tado_auth_status` | Connected flag, email, home name |
| `tado_auth_disconnect` | Wipe auth row |
| `tado_list_zones` | Zones for current home |
| `tado_zone_state(zone_id)` | Snapshot for one widget |

Exact start/poll split can follow ergonomics during implementation; must support UI that shows the link while waiting.

### Frontend files

| Path | Role |
|------|------|
| `src/extensions/tado/manifest.json` | Catalog + `commands` / `permissions` |
| `src/extensions/tado/index.ts` | Module wiring, lifecycle dispose |
| `src/extensions/tado/TadoWidget.vue` | Tile + connect / zone-pick states |
| `src/extensions/tado/TadoSettings.vue` | Per-instance zone picker (+ optional Add all) |
| `src/extensions/tado/tadoLogic.ts` | Formatting, mode helpers, duplicate-zone skip |
| `src/extensions/tado/useTadoSettings.ts` | Per-instance `{ zoneId, zoneName }` persistence |
| `src/settings/TadoPanel.vue` | App-level account + Add all rooms |
| `src/settings/SettingsModal.vue` | New nav section `tado` |

### Host glue

Extend widget add path so callers can pass **initial settings** when creating an instance (used by Add all rooms). Keep the host type-agnostic: `addWidget(typeId, initialSettings?: Record<string, unknown>)`. “Add all” skips `zoneId`s already bound on existing `tado` instances.

### Rust / Cargo

| Piece | Role |
|-------|------|
| `src-tauri/src/tado/mod.rs` (or `tado.rs` + submodules) | Auth, db, api, commands |
| `rusqlite` | SQLite |
| Existing `reqwest` | HTTPS |
| Register commands in `lib.rs` invoke handler | |

## Error handling

- Device-flow timeout → clear pending auth; user can retry
- Invalid refresh token → delete auth; UI shows Connect
- Transient zone poll failures → retain last good data + error string
- Missing home / empty zones → Settings message; Add all no-ops with explanation

## Testing

- Rust: token refresh decision; JSON fixtures → view-model mapping for `getZoneState`
- TS: temperature split formatting; Add-all duplicate skip
- Manual: device login, Add all rooms, 60s refresh, disconnect/reconnect, zone re-pick

## Success criteria

1. User can connect Tado via device flow from Settings or a widget CTA
2. Refresh token survives app restart (SQLite)
3. “Add all rooms” creates one widget per HEATING zone without duplicates
4. Each widget shows humidity, temperature, room name, mode, and power visually
5. No API path in this extension performs thermostat writes
