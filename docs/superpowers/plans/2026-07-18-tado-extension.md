# Tado Thermostat Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Tado extension: OAuth device-flow login (tokens in SQLite), one flush thermostat tile per HEATING zone, Settings connect/disconnect + “Add all rooms”.

**Architecture:** Rust owns OAuth, token refresh, SQLite (`{app_data}/tado.db`), and classic Tado zone HTTP. Vue extension renders the mockup tile and per-instance zone binding (localStorage). App Settings hosts account management; host `kavibayAddWidget` returns the new `instanceId` so Add-all can seed zone settings without a host type-switch.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2, `reqwest` (form + json), `rusqlite` (bundled), existing `serde`/`serde_json`.

## Global Constraints

- Extension id `tado`, title **Tado**
- Classic Tado zones only; filter `type === "HEATING"` (skip `HOT_WATER` etc.)
- Read-only — no overlay/setpoint/presence write APIs
- OAuth device flow; public client id `1bb50063-6b0c-4d11-bd99-387f4a91cc46`; scope `offline_access`
- Tokens in SQLite under Tauri app data; never persist tokens in localStorage
- First home from `getMe().homes[0]` only
- Hybrid widgets: Add all rooms + manual add/remove; `allowDuplicate: true`
- Poll zone state ~60s while mounted; keep last-good on transient errors
- Visual: flush dark square mockup; power icon display-only
- Auth UX: Settings → Tado **and** widget Connect CTA
- No git repository in this workspace — skip all commit steps
- No Vitest — verify with Node assert scripts, `npx vue-tsc --noEmit`, `cargo test`, `cargo check`, manual UI
- Spec: `docs/superpowers/specs/2026-07-18-tado-extension-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/extensions/tado/tadoLogic.ts` | Settings types, temp/mode helpers, heating filter, Add-all skip |
| `src/extensions/tado/useTadoSettings.ts` | Per-instance settings cache (Weather pattern) |
| `src/extensions/tado/TadoWidget.vue` | Tile + connect / zone-pick / data states |
| `src/extensions/tado/TadoSettings.vue` | Per-instance zone picker |
| `src/extensions/tado/TadoAuthPanel.vue` | Shared Connect/device-flow UI (Settings + widget) |
| `src/extensions/tado/manifest.json` | Catalog metadata + declared commands |
| `src/extensions/tado/index.ts` | Extension module + lifecycle |
| `src/settings/TadoPanel.vue` | Account status, disconnect, Add all rooms |
| `src/settings/SettingsModal.vue` | Nav section `tado` |
| `src/core/host/WidgetHost.vue` | `kavibayAddWidget` returns `instanceId` |
| `src/palette/CommandPalette.vue` | Typing for new inject signature (if needed) |
| `src-tauri/src/tado/mod.rs` | Module root + command exports |
| `src-tauri/src/tado/db.rs` | SQLite schema + auth CRUD |
| `src-tauri/src/tado/auth.rs` | Device flow + refresh |
| `src-tauri/src/tado/api.rs` | Read-only me/zones/state + view-model map |
| `src-tauri/src/tado/commands.rs` | Tauri commands |
| `src-tauri/src/lib.rs` | `mod tado`; manage state; register commands |
| `src-tauri/Cargo.toml` | `rusqlite`, reqwest `form` + `json` |

---

### Task 1: Pure frontend helpers

**Files:**
- Create: `src/extensions/tado/tadoLogic.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export interface TadoSettings { zoneId: number | null; zoneName: string }`
  - `export interface TadoZoneInfo { id: number; name: string; type: string }`
  - `export interface TadoZoneStateView { zone_id: number; temperature_c: number | null; humidity_percent: number | null; power_on: boolean; mode_label: string; is_manual: boolean; zone_unavailable: boolean }`
  - `export interface TempParts { whole: string; fraction: string }`
  - `export function normalizeTadoSettings(raw: unknown): TadoSettings`
  - `export function formatTempParts(celsius: number | null): TempParts`
  - `export function heatingZonesOnly(zones: TadoZoneInfo[]): TadoZoneInfo[]`
  - `export function zonesToAdd(all: TadoZoneInfo[], boundZoneIds: Iterable<number>): TadoZoneInfo[]`
  - storage helpers: `tadoStorageKey`, `load/save/clearTadoSettings`

- [ ] **Step 1: Create `src/extensions/tado/tadoLogic.ts`**

```ts
/**
 * Tado extension: per-instance settings, display helpers, Add-all filtering.
 * Backend DTOs use snake_case to match Rust serde.
 */

export interface TadoSettings {
  /** Bound classic zone id; null until picked. */
  zoneId: number | null;
  /** Denormalized name for empty/error UI. */
  zoneName: string;
}

export interface TadoZoneInfo {
  id: number;
  name: string;
  type: string;
}

export interface TadoZoneStateView {
  zone_id: number;
  temperature_c: number | null;
  humidity_percent: number | null;
  power_on: boolean;
  mode_label: string;
  is_manual: boolean;
  zone_unavailable: boolean;
}

export interface TempParts {
  /** Integer portion, e.g. "25" */
  whole: string;
  /** Fraction with leading dot, e.g. ".2" — empty if whole degrees */
  fraction: string;
}

export const DEFAULT_TADO_SETTINGS: TadoSettings = {
  zoneId: null,
  zoneName: "",
};

/** Per-instance localStorage key (account tokens stay in Rust SQLite). */
export function tadoStorageKey(instanceId: string): string {
  return `kavibay:tado:${instanceId}`;
}

/** Normalize raw settings. */
export function normalizeTadoSettings(raw: unknown): TadoSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const zoneId =
    typeof o.zoneId === "number" && Number.isFinite(o.zoneId)
      ? Math.trunc(o.zoneId)
      : null;
  const zoneName = typeof o.zoneName === "string" ? o.zoneName : "";
  return { zoneId, zoneName };
}

export function loadTadoSettings(instanceId: string): TadoSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(tadoStorageKey(instanceId)) ?? "null");
    return normalizeTadoSettings(raw);
  } catch {
    return { ...DEFAULT_TADO_SETTINGS };
  }
}

export function saveTadoSettings(instanceId: string, settings: TadoSettings): void {
  localStorage.setItem(
    tadoStorageKey(instanceId),
    JSON.stringify(normalizeTadoSettings(settings)),
  );
}

export function clearTadoSettings(instanceId: string): void {
  localStorage.removeItem(tadoStorageKey(instanceId));
}

/**
 * Split celsius into large whole + small fraction for the mockup.
 * Example: 25.2 → { whole: "25", fraction: ".2" }; 25 → { whole: "25", fraction: "" }.
 */
export function formatTempParts(celsius: number | null): TempParts {
  if (celsius === null || !Number.isFinite(celsius)) {
    return { whole: "—", fraction: "" };
  }
  const rounded = Math.round(celsius * 10) / 10;
  const whole = Math.trunc(rounded);
  const tenth = Math.abs(Math.round((rounded - whole) * 10));
  return {
    whole: String(whole),
    fraction: tenth === 0 ? "" : `.${tenth}`,
  };
}

/** Keep classic room thermostats only. */
export function heatingZonesOnly(zones: TadoZoneInfo[]): TadoZoneInfo[] {
  return zones.filter((z) => z.type === "HEATING");
}

/** Zones that do not already have a bound widget. */
export function zonesToAdd(
  all: TadoZoneInfo[],
  boundZoneIds: Iterable<number>,
): TadoZoneInfo[] {
  const bound = new Set(boundZoneIds);
  return heatingZonesOnly(all).filter((z) => !bound.has(z.id));
}

/** Collect bound zone ids from instance ids via loadTadoSettings. */
export function boundZoneIdsFromInstances(instanceIds: string[]): number[] {
  const ids: number[] = [];
  for (const instanceId of instanceIds) {
    const z = loadTadoSettings(instanceId).zoneId;
    if (z !== null) ids.push(z);
  }
  return ids;
}
```

- [ ] **Step 2: Verify helpers with Node assert**

Run:

```bash
node --input-type=module -e "
import { formatTempParts, heatingZonesOnly, zonesToAdd, normalizeTadoSettings } from './src/extensions/tado/tadoLogic.ts';
import assert from 'node:assert/strict';
assert.deepEqual(formatTempParts(25.2), { whole: '25', fraction: '.2' });
assert.deepEqual(formatTempParts(25), { whole: '25', fraction: '' });
assert.deepEqual(formatTempParts(null), { whole: '—', fraction: '' });
const zones = [
  { id: 1, name: 'Wohnzimmer', type: 'HEATING' },
  { id: 2, name: 'WW', type: 'HOT_WATER' },
  { id: 3, name: 'Bad', type: 'HEATING' },
];
assert.equal(heatingZonesOnly(zones).length, 2);
assert.deepEqual(zonesToAdd(zones, [1]).map(z => z.id), [3]);
assert.deepEqual(normalizeTadoSettings({ zoneId: 5, zoneName: 'X' }), { zoneId: 5, zoneName: 'X' });
console.log('ok');
"
```

Expected: `ok`

If Vite/TS import fails under bare Node, duplicate the three pure functions into the `-e` script for the assert (keep `tadoLogic.ts` as source of truth) — same pattern as other Kavibay plans.

- [ ] **Step 3: Skip commit** (no git repo)

---

### Task 2: Settings composable + host addWidget returns instanceId

**Files:**
- Create: `src/extensions/tado/useTadoSettings.ts`
- Modify: `src/core/host/WidgetHost.vue` (`onAddType` + provide)
- Modify: `src/palette/CommandPalette.vue` (inject type only if TypeScript complains)

**Interfaces:**
- Consumes: `tadoLogic` settings helpers
- Produces:
  - `useTadoSettings(instanceId)` → `{ settings, update }`
  - `disposeTadoSettings`, `seedTadoSettings`, `seedTadoSettingsFrom`
  - `kavibayAddWidget: (typeId: string) => string | undefined`

- [ ] **Step 1: Create `useTadoSettings.ts`** (mirror Weather)

```ts
import { type Ref, ref } from "vue";
import {
  type TadoSettings,
  loadTadoSettings,
  normalizeTadoSettings,
  saveTadoSettings,
} from "./tadoLogic";

const cache = new Map<string, Ref<TadoSettings>>();

function ensure(instanceId: string): Ref<TadoSettings> {
  let existing = cache.get(instanceId);
  if (!existing) {
    existing = ref(loadTadoSettings(instanceId));
    cache.set(instanceId, existing);
  }
  return existing;
}

/** Per-instance Tado settings shared by widget + settings panel. */
export function useTadoSettings(instanceId: string) {
  const settings = ensure(instanceId);

  function update(partial: Partial<TadoSettings>) {
    settings.value = normalizeTadoSettings({ ...settings.value, ...partial });
    saveTadoSettings(instanceId, settings.value);
  }

  return { settings, update };
}

export function disposeTadoSettings(instanceId: string): void {
  cache.delete(instanceId);
}

/** Seed binding for Add-all / first create. */
export function seedTadoSettings(instanceId: string, settings: TadoSettings): void {
  const normalized = normalizeTadoSettings(settings);
  cache.set(instanceId, ref(normalized));
  saveTadoSettings(instanceId, normalized);
}

export function seedTadoSettingsFrom(fromId: string, toId: string): void {
  const from = ensure(fromId);
  seedTadoSettings(toId, { ...from.value });
}
```

- [ ] **Step 2: Change `onAddType` in `WidgetHost.vue` to return instance id**

Replace:

```ts
function onAddType(typeId: string) {
  const def = defFor(typeId);
  if (!def) return;
  const created = createInstance(typeId, def.position, {
    hideTitle: Boolean(def.defaultHideTitle),
  });
  instances.push(created);
  runExtensionHook(def, "onCreate", created.instanceId);
  persist();
  scheduleRegionSync();
}
```

With:

```ts
/** Add a fresh instance; returns instanceId for callers that seed settings (e.g. Tado Add all). */
function onAddType(typeId: string): string | undefined {
  const def = defFor(typeId);
  if (!def) return undefined;
  const created = createInstance(typeId, def.position, {
    hideTitle: Boolean(def.defaultHideTitle),
  });
  instances.push(created);
  runExtensionHook(def, "onCreate", created.instanceId);
  persist();
  scheduleRegionSync();
  return created.instanceId;
}
```

Update inject type in `CommandPalette.vue`:

```ts
const addWidget = inject<(typeId: string) => string | undefined>("kavibayAddWidget");
```

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS (or only pre-existing errors unrelated to these files)

- [ ] **Step 4: Skip commit**

---

### Task 3: Rust SQLite auth store

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/tado/mod.rs`
- Create: `src-tauri/src/tado/db.rs`
- Modify: `src-tauri/src/lib.rs` — `mod tado;`

**Interfaces:**
- Consumes: Tauri `AppHandle` path API
- Produces:
  - `pub struct AuthRow { access_token, refresh_token, expires_at, account_email, home_id, home_name, updated_at }`
  - `pub fn open_db(app: &AppHandle) -> Result<Connection, String>`
  - `pub fn load_auth(conn) -> Result<Option<AuthRow>, String>`
  - `pub fn save_auth(conn, &AuthRow) -> Result<(), String>`
  - `pub fn clear_auth(conn) -> Result<(), String>`

- [ ] **Step 1: Add deps to `Cargo.toml`**

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

Update existing reqwest line to:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "gzip", "brotli", "json", "form"] }
```

- [ ] **Step 2: Create `tado/db.rs`**

```rust
//! SQLite persistence for the single Tado OAuth account row.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthRow {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds when access_token expires.
    pub expires_at: i64,
    pub account_email: String,
    pub home_id: i64,
    pub home_name: String,
    pub updated_at: i64,
}

/// Resolve `{app_data}/tado.db` and ensure parent exists.
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("tado.db"))
}

pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS auth (
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
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn load_auth(conn: &Connection) -> Result<Option<AuthRow>, String> {
    conn.query_row(
        "SELECT access_token, refresh_token, expires_at, account_email, home_id, home_name, updated_at FROM auth WHERE id = 1",
        [],
        |row| {
            Ok(AuthRow {
                access_token: row.get(0)?,
                refresh_token: row.get(1)?,
                expires_at: row.get(2)?,
                account_email: row.get(3)?,
                home_id: row.get(4)?,
                home_name: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn save_auth(conn: &Connection, row: &AuthRow) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO auth (id, access_token, refresh_token, expires_at, account_email, home_id, home_name, updated_at)
        VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(id) DO UPDATE SET
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          expires_at = excluded.expires_at,
          account_email = excluded.account_email,
          home_id = excluded.home_id,
          home_name = excluded.home_name,
          updated_at = excluded.updated_at
        "#,
        params![
            row.access_token,
            row.refresh_token,
            row.expires_at,
            row.account_email,
            row.home_id,
            row.home_name,
            row.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_auth(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM auth WHERE id = 1", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn save_load_clear_roundtrip() {
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
        let row = AuthRow {
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at: 100,
            account_email: "a@b.c".into(),
            home_id: 9,
            home_name: "Home".into(),
            updated_at: 50,
        };
        save_auth(&conn, &row).unwrap();
        let loaded = load_auth(&conn).unwrap().unwrap();
        assert_eq!(loaded.home_id, 9);
        assert_eq!(loaded.refresh_token, "r");
        clear_auth(&conn).unwrap();
        assert!(load_auth(&conn).unwrap().is_none());
    }
}
```

- [ ] **Step 3: `tado/mod.rs`**

```rust
//! Tado OAuth + read-only classic zone API.

mod api;
mod auth;
mod commands;
mod db;

pub use commands::*;
```

Create stub `api.rs`, `auth.rs`, `commands.rs` with `// placeholder` empty modules so the crate compiles; fill in later tasks.

- [ ] **Step 4: Register module in `lib.rs`**

Add `mod tado;` near other mods (commands still registered in Task 4/5).

- [ ] **Step 5: Run DB unit test**

Run: `cargo test -p kavibay_lib --lib tado::db::tests -- --nocapture`  
Expected: PASS

- [ ] **Step 6: Skip commit**

---

### Task 4: Rust OAuth device flow + auth commands

**Files:**
- Create/fill: `src-tauri/src/tado/auth.rs`
- Create/fill: `src-tauri/src/tado/commands.rs` (auth commands)
- Modify: `src-tauri/src/lib.rs` — manage `TadoState`, register auth commands

**Interfaces:**
- Consumes: `db::{open_db, load_auth, save_auth, clear_auth, AuthRow}`
- Produces Tauri commands:
  - `tado_auth_start() -> TadoDeviceVerification`
  - `tado_auth_status() -> TadoAuthStatus`
  - `tado_auth_cancel()`
  - `tado_auth_disconnect()`
- Shared state: `TadoState { pending: Mutex<Option<PendingDeviceAuth>>, http: Client }`

Constants:

```rust
const CLIENT_ID: &str = "1bb50063-6b0c-4d11-bd99-387f4a91cc46";
const DEVICE_AUTH_URL: &str = "https://login.tado.com/oauth2/device_authorize";
const TOKEN_URL: &str = "https://login.tado.com/oauth2/token";
const API_BASE: &str = "https://my.tado.com/api/v2";
```

DTOs (serde camelCase or snake_case — **use snake_case** to match other widgets):

```rust
#[derive(Serialize, Clone)]
pub struct TadoDeviceVerification {
    pub verification_uri_complete: String,
    pub user_code: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Serialize, Clone)]
pub struct TadoAuthStatus {
    pub connected: bool,
    pub pending: bool,
    pub account_email: String,
    pub home_name: String,
    pub error: Option<String>,
}
```

- [ ] **Step 1: Implement device authorize + token poll in `auth.rs`**

Behavior:
1. `start_device_flow`: POST form `client_id` + `scope=offline_access` → store `device_code`, interval, deadline in `PendingDeviceAuth`; return verification (ensure URL includes `client_id` query if Tado requires it — append `&client_id=…` when missing).
2. Spawn async task (or poll from `tado_auth_status` / dedicated `tado_auth_wait`): POST token with `grant_type=urn:ietf:params:oauth:grant-type:device_code`. On `authorization_pending` / `slow_down`, sleep and retry. On success: call `fetch_me`, pick `homes[0]`, `save_auth`, clear pending.
3. `refresh_if_needed(conn, row)`: if `expires_at` within 60s of now, refresh_token grant; update row; on failure `clear_auth` and return error `"Not connected"`.
4. `cancel`: drop pending + signal abort (AtomicBool / watch channel).

Prefer: `tado_auth_start` returns verification immediately and spawns `tauri::async_runtime::spawn` poller that writes auth on success; UI polls `tado_auth_status` every 2s.

Also implement `ensure_access_token(app) -> Result<(String /*bearer*/, i64 /*home_id*/), String>` used by API commands.

- [ ] **Step 2: Wire auth commands in `commands.rs` + `lib.rs`**

```rust
// lib.rs setup:
app.manage(tado::TadoState::new());

// invoke_handler add:
tado::tado_auth_start,
tado::tado_auth_status,
tado::tado_auth_cancel,
tado::tado_auth_disconnect,
```

- [ ] **Step 3: Unit-test token expiry helper**

```rust
#[test]
fn needs_refresh_when_expired() {
    assert!(auth::access_expired(100, 200)); // expires_at=100, now=200
    assert!(!auth::access_expired(300, 200));
}
```

Run: `cargo test -p kavibay_lib --lib tado:: -- --nocapture`  
Expected: PASS for db + auth helper tests (live HTTP not required).

- [ ] **Step 4: Skip commit**

---

### Task 5: Rust read-only zones API + mapping tests

**Files:**
- Fill: `src-tauri/src/tado/api.rs`
- Extend: `src-tauri/src/tado/commands.rs`
- Modify: `src-tauri/src/lib.rs` — register `tado_list_zones`, `tado_zone_state`

**Interfaces:**
- Consumes: `ensure_access_token`
- Produces:
  - `tado_list_zones() -> Vec<TadoZoneDto { id, name, type_ }>` (serde rename `type`)
  - `tado_zone_state(zone_id: i64) -> TadoZoneStateView`
  - `pub fn map_zone_state(zone_id: i64, json: &Value) -> TadoZoneStateView`

- [ ] **Step 1: Implement HTTP getters**

```text
GET {API_BASE}/me
GET {API_BASE}/homes/{home_id}/zones
GET {API_BASE}/homes/{home_id}/zones/{zone_id}/state
```

Authorization: `Bearer {access_token}`. On 401: one refresh retry then fail + clear if refresh fails. On 404 for zone state: return `zone_unavailable: true`.

- [ ] **Step 2: Map zone state JSON → view model**

Use fixture-driven unit test. Create `src-tauri/src/tado/fixtures/heat_zone_state.json` with a minimal real-shaped payload:

```json
{
  "sensorDataPoints": {
    "insideTemperature": { "celsius": 25.2 },
    "humidity": { "percentage": 54.0 }
  },
  "setting": { "power": "ON", "type": "HEATING", "temperature": { "celsius": 16.0 } },
  "overlayType": "MANUAL",
  "overlay": {
    "type": "MANUAL",
    "setting": { "power": "ON", "type": "HEATING", "temperature": { "celsius": 16.0 } }
  },
  "tadoMode": "HOME"
}
```

Mapping rules:
- `temperature_c` ← `sensorDataPoints.insideTemperature.celsius`
- `humidity_percent` ← `sensorDataPoints.humidity.percentage` (round to u8/i32)
- `power_on` ← `setting.power` equals `"ON"` (case-insensitive)
- `is_manual` ← `overlayType` is some / non-null OR overlay present
- `mode_label` ← if manual: prefer overlay setting type / `"Manual"`; else use `tadoMode` string; if frost-protection-style low setpoint with known prep, keep API string when present. Minimum V1: manual → `"Manual"` if no better label; schedule → `tadoMode` (e.g. `"HOME"`). German labels from Tado are fine when the API returns them in other fields — prefer any `overlay.termination.type` / human fields if present; otherwise these fallbacks.

For frost protection displays like the mockup, if `setting.temperature.celsius` is very low (≤ 5) and power ON, `mode_label` may be set to `"Frostschutz"` only when no better API label exists — document in code comment that this is a display heuristic for classic frost preset, not a write.

Actually stick closer to YAGNI: **mode_label = if is_manual { "Manual" } else { tadoMode or "Schedule" }** and improve if a fixture field has a better string. User’s screenshot shows Tado app strings; live API often returns English enums — acceptable for V1.

- [ ] **Step 3: Register commands**

```rust
tado::tado_list_zones,
tado::tado_zone_state,
```

- [ ] **Step 4: Run mapping test**

```rust
#[test]
fn maps_heating_zone_fixture() {
    let v: serde_json::Value = serde_json::from_str(include_str!("fixtures/heat_zone_state.json")).unwrap();
    let m = map_zone_state(1, &v);
    assert!((m.temperature_c.unwrap() - 25.2).abs() < 0.01);
    assert_eq!(m.humidity_percent.unwrap(), 54);
    assert!(m.power_on);
    assert!(m.is_manual);
}
```

Run: `cargo test -p kavibay_lib --lib tado:: -- --nocapture`  
Expected: PASS

- [ ] **Step 5: Skip commit**

---

### Task 6: Extension scaffold (manifest, index, settings UI)

**Files:**
- Create: `src/extensions/tado/manifest.json`
- Create: `src/extensions/tado/index.ts`
- Create: `src/extensions/tado/TadoSettings.vue`
- Create: `src/extensions/tado/TadoAuthPanel.vue` (shared auth UI)

**Interfaces:**
- Consumes: Tauri commands from Task 4–5; `useTadoSettings`; `launch_path` for browser open
- Produces: discoverable extension via existing `import.meta.glob`

- [ ] **Step 1: `manifest.json`**

```json
{
  "id": "tado",
  "name": "Tado",
  "description": "Read-only smart thermostat tiles for Tado heating zones.",
  "version": "1.0.0",
  "author": "kavibay",
  "keywords": ["tado", "thermostat", "heating", "temperature", "humidity"],
  "categories": ["information"],
  "ui": {
    "defaultOffset": { "x": -280, "y": 120 },
    "allowDuplicate": true,
    "flush": true,
    "defaultHideTitle": true
  },
  "commands": [
    "tado_auth_start",
    "tado_auth_status",
    "tado_auth_cancel",
    "tado_auth_disconnect",
    "tado_list_zones",
    "tado_zone_state"
  ],
  "permissions": []
}
```

- [ ] **Step 2: `TadoAuthPanel.vue`**

Props: none (self-contained). Behavior:
1. On mount, `invoke("tado_auth_status")`
2. If connected: show email + home name
3. If pending: show user code + “Waiting for login…” + Cancel
4. Connect button → `tado_auth_start` → `invoke("launch_path", { path: verification_uri_complete })` → poll status every 2s until connected or error
5. Emit `connected` event when status becomes connected (parent can reload zones)

- [ ] **Step 3: `TadoSettings.vue`**

- Inject `widgetInstanceId`
- If not connected: embed `TadoAuthPanel`
- Else: `<select>` of heating zones from `tado_list_zones`; on change `update({ zoneId, zoneName })`
- Close via `closeWidgetSettings` after pick (optional)

- [ ] **Step 4: `index.ts`**

```ts
import type { ExtensionModule } from "../../core/extensions/types";
import TadoWidget from "./TadoWidget.vue";
import TadoSettings from "./TadoSettings.vue";
import { clearTadoSettings } from "./tadoLogic";
import { disposeTadoSettings, seedTadoSettingsFrom } from "./useTadoSettings";

const extension: ExtensionModule = {
  component: TadoWidget,
  settingsComponent: TadoSettings,
  onDuplicate: (fromId, toId) => seedTadoSettingsFrom(fromId, toId),
  onDispose: (instanceId) => {
    disposeTadoSettings(instanceId);
    clearTadoSettings(instanceId);
  },
};

export default extension;
```

Note: do **not** set `backendCommand` — each instance needs a `zone_id` argument, so the widget polls via its own `invoke("tado_zone_state", { zoneId })`.

- [ ] **Step 5: `npx vue-tsc --noEmit`** (widget may still be stub)

- [ ] **Step 6: Skip commit**

---

### Task 7: Thermostat tile widget

**Files:**
- Create: `src/extensions/tado/TadoWidget.vue`

**Interfaces:**
- Consumes: `useTadoSettings`, `formatTempParts`, auth/zone commands
- Produces: mockup UI states from spec

- [ ] **Step 1: Implement `TadoWidget.vue`**

Layout (connected + zone bound):
- Outer `.tado-tile` ~220×220, `#2C2C2E`, border-radius ~28px
- Top row: humidity pill (left) + power SVG (right); power opacity higher when `power_on`
- Center: `.tado-temp-whole` + superscript-ish degree + `.tado-temp-frac`
- Bottom: `zoneName` + mode row (hand SVG if `is_manual`, else clock/calendar-ish) + `mode_label`

States:
1. `!connected` → short copy + `TadoAuthPanel` (compact)
2. `connected && zoneId == null` → zone `<select>`
3. Bound → poll every 60s; on error keep `lastGood` + dim error text
4. `zone_unavailable` → message + clear zone / re-pick control

Script sketch:

```ts
const instanceId = inject<string>("widgetInstanceId")!;
const { settings, update } = useTadoSettings(instanceId);
const view = ref<TadoZoneStateView | null>(null);
const lastGood = ref<TadoZoneStateView | null>(null);
// authStatus + loadZone loop...
async function loadZone() {
  if (settings.value.zoneId == null) return;
  try {
    const snap = await invoke<TadoZoneStateView>("tado_zone_state", {
      zoneId: settings.value.zoneId,
    });
    view.value = snap;
    if (!snap.zone_unavailable) lastGood.value = snap;
    error.value = null;
  } catch (e) {
    error.value = String(e);
  }
}
```

Power and humidity icons: inline SVG (no emoji). Degree: CSS absolute `°` beside whole number above fraction.

- [ ] **Step 2: Manual visual check against mockup screenshot** (humidity pill, big temp, room, mode)

- [ ] **Step 3: Skip commit**

---

### Task 8: App Settings Tado panel + Add all rooms

**Files:**
- Create: `src/settings/TadoPanel.vue`
- Modify: `src/settings/SettingsModal.vue`

**Interfaces:**
- Consumes: `kavibayAddWidget`, `kavibayWidgetInstances`, `seedTadoSettings`, `zonesToAdd`, `boundZoneIdsFromInstances`, Tado auth/zone commands

- [ ] **Step 1: `TadoPanel.vue`**

- Embed `TadoAuthPanel` + Disconnect button (`tado_auth_disconnect`)
- When connected: button **Add all rooms**:
  1. `zones = heatingZonesOnly(await invoke("tado_list_zones"))`
  2. `instances = inject("kavibayWidgetInstances")` filtered `typeId === "tado"`
  3. `toAdd = zonesToAdd(zones, boundZoneIdsFromInstances(ids))`
  4. For each zone: `const id = addWidget("tado"); if (id) seedTadoSettings(id, { zoneId: zone.id, zoneName: zone.name })`
  5. Show count added / “All rooms already added”

Provide `kavibayWidgetInstances` already exists on host — confirm Settings is under `WidgetHost` tree (it is via `App.vue`). If Settings cannot inject host provides, fall back to reading layout from `localStorage` `kavibay:layout-v3` for `typeId === "tado"` instance ids.

- [ ] **Step 2: Add nav section in `SettingsModal.vue`**

```ts
type SectionId = "appearance" | "behavior" | "tado";
```

Add nav button “Tado” and `<TadoPanel v-else-if="activeSection === 'tado'" />`.

- [ ] **Step 3: Typecheck + cargo check**

```bash
npx vue-tsc --noEmit
cargo check
```

Expected: PASS

- [ ] **Step 4: Skip commit**

---

### Task 9: End-to-end manual verification

**Files:** none (manual)

- [ ] **Step 1: Run app**

```bash
npm run tauri dev
```

- [ ] **Step 2: Checklist**

1. Settings → Tado → Connect → browser opens → approve → status shows email/home
2. Add all rooms → one tile per HEATING zone; humidity/temp/name/mode/power visible
3. Restart app → still connected (SQLite refresh token)
4. Remove one widget; Add all again → only missing zone re-added
5. Disconnect → widgets show Connect CTA; no tokens left (status disconnected)
6. Confirm no UI can change setpoint (read-only)

- [ ] **Step 3: Skip commit**

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| OAuth device flow in Rust | Task 4 |
| SQLite token store | Task 3 |
| Classic HEATING zones read-only | Task 5 |
| First home only | Task 4 (`fetch_me`) |
| Widget mockup UI | Task 7 |
| Settings + widget Connect CTA | Tasks 6–8 |
| Add all rooms + skip duplicates | Tasks 1, 2, 8 |
| Per-instance zone binding | Tasks 1, 2, 6 |
| 60s poll, last-good on error | Task 7 |
| No thermostat writes | Tasks 5 (API surface) — no write commands |
| Host initial settings without type switch | Task 2 (return instanceId + seed) |

No TBD placeholders remain. Command names consistent: `tado_auth_*`, `tado_list_zones`, `tado_zone_state`.
