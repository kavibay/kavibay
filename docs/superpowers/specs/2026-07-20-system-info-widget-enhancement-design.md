# System Info Widget Enhancement — Design

**Date:** 2026-07-20  
**Status:** Approved for implementation planning  
**Tier:** L (extend Rust OS metrics + battery crate; settings + non-trivial UI)  
**Approach:** Extend existing `widget_system_info` + hero-stats UI with section toggles (approach 1 / layout B)

## Goal

Upgrade the System Info widget from a plain label/value list into a compact live vitals card: hero % tiles for CPU, memory, and battery (when present), with per-instance section toggles in settings.

## Requirements

### Sections (v1)

| Section | Content |
|---------|---------|
| OS & host | OS name + version; hostname |
| CPU | Usage % tile; brand; core count in detail row |
| Memory | Usage % tile (`used/total`); used/total GB as a detail row when Memory is on |
| Battery | % tile + mini glyph; auto-hide when none detected |
| Uptime | Formatted duration in detail list |

Out of scope: disk usage, load average, per-core charts, sparklines, process list, custom refresh interval.

### Settings

- Gear popover (Clock pattern), live-apply checkboxes:
  - `showOs`, `showCpu`, `showMemory`, `showBattery`, `showUptime`
- Defaults: all `true`
- Per-instance `localStorage`; copy on duplicate; clear on dispose

### Battery when unavailable

- Backend returns `battery: null` on desktops / no battery
- Frontend **auto-hides** the Battery tile even if `showBattery` is true
- Settings toggle remains available so laptops keep a consistent settings UI

### Display (hero stats — layout B)

1. **Hero row** — equal tiles for each enabled *and available* metric among CPU / Memory / Battery  
   - 3 tiles with battery; 2 tiles without; 1 tile if only one metric; no hero row if none  
2. **Battery tile** — mini battery glyph beside the %  
   - Charging → green accent  
   - Discharging (normal) → amber  
   - ≤20% and not charging → red  
3. **Detail list** below for enabled identity/uptime rows (OS, host, CPU brand + cores, uptime)  
4. Loading / error — existing host patterns (“Loading…”, error text); keep last good data on refresh errors when the host already does so

## Architecture

### Backend

Keep a single command `widget_system_info` (~5s host `refreshInterval`).

Expand `SystemInfo` (serde snake_case JSON):

```rust
struct SystemInfo {
    os_name: String,
    os_version: String,
    hostname: String,
    cpu_count: usize,
    cpu_brand: String,
    cpu_usage_percent: f32,      // 0..=100, global
    used_memory_mb: u64,
    total_memory_mb: u64,
    uptime_secs: u64,
    battery: Option<BatteryInfo>,
}

struct BatteryInfo {
    percent: f32,                // 0..=100
    state: String,               // "charging" | "discharging" | "full" | "empty" | "unknown"
    time_to_empty_secs: Option<u64>,
}
```

Implementation notes:

- Continue using `sysinfo` for OS/host/CPU/memory/uptime  
- CPU %: refresh CPUs, short sleep (~200ms), refresh again, then read global usage so the first poll is not stuck near 0  
- Battery: add `starship-battery` (or equivalent maintained crate); first battery wins; errors/no battery → `None`  
- Prefer targeted refreshes over full `refresh_all()` where practical to keep the 5s poll cheap  

Register command stays the same (`lib.rs` / `commands` list). Manifest `commands` unchanged (`widget_system_info`).

### Frontend files

| File | Role |
|------|------|
| `src/extensions/system-info/systemInfoLogic.ts` | Settings types, defaults, normalize/load/save/clear/copy; pure format helpers (uptime, memory GB, battery accent) |
| `src/extensions/system-info/useSystemInfoSettings.ts` | Per-instance reactive cache (mirror Clock) |
| `src/extensions/system-info/SystemInfoSettings.vue` | Checkbox settings popover |
| `src/extensions/system-info/SystemInfoWidget.vue` | Hero tiles + detail list; consume host `data`/`loading`/`error` |
| `src/extensions/system-info/index.ts` | Wire `settingsComponent`, `onDuplicate`, `onDispose`; keep `backendCommand` + `refreshInterval` |
| `src/extensions/system-info/manifest.json` | Update description/keywords for battery |

No host/`WidgetHost` special cases.

### Settings contract

```ts
interface SystemInfoSettings {
  showOs: boolean;
  showCpu: boolean;
  showMemory: boolean;
  showBattery: boolean;
  showUptime: boolean;
}
```

Storage key: `kavibay:system-info:{instanceId}`.

### Data flow

1. Host invokes `widget_system_info` on mount and every `refreshInterval`  
2. Widget reads payload + per-instance settings  
3. Derive visible hero tiles and detail rows  
4. Settings updates re-render immediately (no extra invoke)

### Testing / verify

- Pure helpers: small Node assert script (`npx tsx`) for normalize + formatters  
- `npx vue-tsc --noEmit`  
- `cargo check -p kavibay_lib`  
- Manual: palette add; toggles live-apply; duplicate/dispose; laptop battery vs desktop auto-hide; charging/low colors

## Non-goals

- Disk / load average / network  
- Historical graphs  
- Separate refresh commands or faster battery-only polling  
- New Settings app navigation
