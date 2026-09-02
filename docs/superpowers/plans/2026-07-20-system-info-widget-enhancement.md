# System Info Widget Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade System Info into a hero-stats vitals card (CPU / RAM / Battery tiles + detail rows) with per-instance section toggles.

**Architecture:** Extend the existing `widget_system_info` Tauri command (sysinfo + `starship-battery`). Frontend keeps host polling (`backendCommand` + `refreshInterval: 5000`) and adds Clock-style settings + hero-tile UI.

**Tech Stack:** Vue 3 + TypeScript, Tauri 2, `sysinfo` 0.39, `starship-battery` 0.11, localStorage per instance.

## Global Constraints

- Extension id `system-info`, name **System Info**, category `system`
- Single command `widget_system_info`; no new host/`WidgetHost` branches
- Sections v1 only: OS & host, CPU, Memory, Battery, Uptime (no disk/load)
- Settings: `showOs` / `showCpu` / `showMemory` / `showBattery` / `showUptime` — all default `true`
- Battery `null` → auto-hide tile even when toggle on
- Layout B: equal hero tiles for enabled+available metrics; detail list below
- Battery accents: charging green · discharging amber · ≤20% not charging red
- Match Kavibay dark glass; clone Clock for settings/lifecycle
- No Vitest — Node assert script, `npx vue-tsc --noEmit`, `cargo check -p kavibay_lib`, manual UI
- Thin plan: implement code in the repo, not by pasting whole files here
- Spec: `docs/superpowers/specs/2026-07-20-system-info-widget-enhancement-design.md`
- Commit only when the user asks

## File Structure

| File | Responsibility |
|------|----------------|
| `src-tauri/Cargo.toml` | Add `starship-battery = "0.11"` |
| `src-tauri/src/commands.rs` | Expand `SystemInfo` / `BatteryInfo`; richer `widget_system_info` |
| `src/extensions/system-info/systemInfoLogic.ts` | Settings + format/visibility helpers |
| `src/extensions/system-info/systemInfoLogic.assert.ts` | Node assert script |
| `src/extensions/system-info/useSystemInfoSettings.ts` | Per-instance settings cache (Clock mirror) |
| `src/extensions/system-info/SystemInfoSettings.vue` | Checkbox popover |
| `src/extensions/system-info/SystemInfoWidget.vue` | Hero tiles + detail list |
| `src/extensions/system-info/index.ts` | Wire settings + duplicate/dispose |
| `src/extensions/system-info/manifest.json` | Description / keywords |

---

### Task 1: Backend payload — CPU % + battery

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands.rs` (`SystemInfo` + `widget_system_info`)

**Interfaces:**
- Consumes: `sysinfo::System`, `starship-battery` Manager/Battery APIs
- Produces (serde snake_case JSON):

```ts
// Frontend mirror
interface BatteryInfo {
  percent: number; // 0..=100
  state: "charging" | "discharging" | "full" | "empty" | "unknown";
  time_to_empty_secs: number | null;
}
interface SystemInfo {
  os_name: string;
  os_version: string;
  hostname: string;
  cpu_count: number;
  cpu_brand: string;
  cpu_usage_percent: number; // 0..=100
  used_memory_mb: number;
  total_memory_mb: number;
  uptime_secs: number;
  battery: BatteryInfo | null;
}
```

- [ ] **Step 1:** Add `starship-battery = "0.11"` to `src-tauri/Cargo.toml`
- [ ] **Step 2:** Add `BatteryInfo` + expand `SystemInfo` fields in `commands.rs`
- [ ] **Step 3:** Rewrite `widget_system_info`:
  - Targeted memory + CPU refresh (avoid full `refresh_all` when possible)
  - CPU %: refresh CPUs → `std::thread::sleep(Duration::from_millis(200))` → refresh CPUs again → `sys.global_cpu_usage()`
  - `cpu_brand` from first CPU brand (trim; fallback `"CPU"`)
  - Battery helper: `Manager::new()` → first battery → map `state()` / `state_of_charge()` / `time_to_empty()`; any error or empty list → `None`
  - Map battery states to the five string literals above
- [ ] **Step 4:** Verify — `cargo check -p kavibay_lib` succeeds (ensure `cargo` on PATH / rustup env)

---

### Task 2: Pure frontend helpers + settings persistence

**Files:**
- Create: `src/extensions/system-info/systemInfoLogic.ts`
- Create: `src/extensions/system-info/systemInfoLogic.assert.ts`
- Create: `src/extensions/system-info/useSystemInfoSettings.ts`

**Interfaces:**
- Consumes: nothing (pure + localStorage)
- Produces:
  - `SystemInfoSettings { showOs, showCpu, showMemory, showBattery, showUptime: boolean }`
  - `DEFAULT_SYSTEM_INFO_SETTINGS` (all `true`)
  - `systemInfoStorageKey(instanceId: string): string` → `kavibay:system-info:{instanceId}`
  - `normalizeSystemInfoSettings(raw: unknown): SystemInfoSettings`
  - `load/save/clearSystemInfoSettings(instanceId)`
  - `copySystemInfoSettings(fromId, toId)`
  - `formatUptime(secs: number): string` → e.g. `12h 34m`
  - `formatMemoryGb(usedMb: number, totalMb: number): string` → e.g. `18.0 / 64.0 GB` (1 decimal)
  - `memoryUsagePercent(usedMb, totalMb): number` → 0..=100, 0 if total 0
  - `roundPercent(n: number): number` → clamp 0..=100, Math.round
  - `batteryAccent(state: string, percent: number): "green" | "amber" | "red"`
    - green if `charging` or `full`; red if percent ≤ 20 and not charging/full; else amber
  - `visibleHeroKeys(settings, batteryPresent: boolean): Array<"cpu"|"memory"|"battery">`
    - include key only if corresponding `show*` and (battery requires `batteryPresent`)
  - `useSystemInfoSettings(instanceId)` → `{ settings, update }` (Clock mirror)
  - `disposeSystemInfoSettings` / `seedSystemInfoSettingsFrom`

- [ ] **Step 1:** Implement `systemInfoLogic.ts` with short purpose comments on exports
- [ ] **Step 2:** Implement `useSystemInfoSettings.ts` mirroring `useClockSettings.ts`
- [ ] **Step 3:** Assert script: normalize defaults/partials; uptime; memory %; battery accents (charging/low/normal); `visibleHeroKeys` for 3/2/0 tile cases
- [ ] **Step 4:** Verify — `npx tsx src/extensions/system-info/systemInfoLogic.assert.ts` → exit 0

---

### Task 3: Settings popover + extension wiring

**Files:**
- Create: `src/extensions/system-info/SystemInfoSettings.vue`
- Modify: `src/extensions/system-info/index.ts`
- Modify: `src/extensions/system-info/manifest.json`

**Interfaces:**
- Consumes: `useSystemInfoSettings`, Clock settings CSS patterns
- Produces: `settingsComponent` on extension; lifecycle hooks

- [ ] **Step 1:** `SystemInfoSettings.vue` — five checkboxes (labels: OS & host, CPU, Memory, Battery, Uptime), live-apply via `update({ showX: checked })`, `@pointerdown.stop`, style like Clock
- [ ] **Step 2:** `index.ts` — add `settingsComponent`, `onDuplicate: seed…`, `onDispose: dispose + clear`; keep `backendCommand` + `refreshInterval: 5000`
- [ ] **Step 3:** Manifest — description mentions CPU/memory/battery; keywords include `battery`
- [ ] **Step 4:** Verify — `npx vue-tsc --noEmit` passes for these files

---

### Task 4: Hero-stats widget UI

**Files:**
- Modify: `src/extensions/system-info/SystemInfoWidget.vue`

**Interfaces:**
- Consumes: `WidgetProps` host payload (snake_case fields from Task 1); `useSystemInfoSettings` via `inject("widgetInstanceId")`; helpers from Task 2
- Produces: polished dark-glass vitals UI

- [ ] **Step 1:** Align local `SystemInfo` / `BatteryInfo` types with backend JSON
- [ ] **Step 2:** Compute `heroKeys` from settings + `data.battery != null`
- [ ] **Step 3:** Render:
  - Loading / error states (existing copy)
  - Hero grid: `grid-template-columns: repeat(N, 1fr)` for N = heroKeys.length; tiles:
    - CPU: green `#6ee7b7`, value `roundPercent(cpu_usage_percent)%`, label `CPU`
    - Memory: blue `#93c5fd`, value `roundPercent(memoryUsagePercent…)%`, label `RAM`
    - Battery: accent from `batteryAccent`; mini CSS battery glyph + `%`; label `Batt`
  - Detail `<dl>` rows when enabled: OS (`os_name os_version`), Host (`hostname`), CPU (`cpu_brand · N cores` when `showCpu`), Memory GB when `showMemory`, Uptime when `showUptime`
  - No hero row when N = 0; detail-only still valid
- [ ] **Step 4:** Scoped styles — compact (~280px), tile padding, rgba glass surfaces; no purple glow theme
- [ ] **Step 5:** Verify — `npx vue-tsc --noEmit`

---

## Manual UI

- [ ] Palette → add System Info → hero tiles + details appear within ~1s (CPU % after first sample)
- [ ] Gear → toggle each section; tiles/rows update live
- [ ] Desktop without battery: Batt tile absent; Battery checkbox still in settings
- [ ] Laptop: Batt tile shows % + glyph; plug in → green; discharge at ≤20% → red
- [ ] Duplicate instance → settings copied; remove → storage cleared
- [ ] `cargo check -p kavibay_lib` + `npx vue-tsc --noEmit` + assert script all green

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Expand Rust DTO + CPU sample + battery crate | 1 |
| Section toggles + localStorage + lifecycle | 2–3 |
| Hero stats layout B + accents + auto-hide | 2, 4 |
| Format uptime / memory GB / % | 2, 4 |
| No disk/load; no host special cases | constraints |
| Verify commands | each task + Manual UI |
