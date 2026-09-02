# Widget Settings Shell + Clock Settings — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Shared hover-gear + popover shell in `WidgetCard` (slot-based); Clock settings first; migrate Pomodoro onto the same shell

## Goal

Give every settings-capable widget a consistent way to open per-widget settings: a gear in the top-right of the card that appears on hover and opens a compact popover. Ship Clock settings in this pass (locale, time format, date style, timezone). Move Pomodoro onto the shared shell so two gear patterns do not coexist.

## Requirements

### Shared shell

- Gear icon top-right of `WidgetCard`, visible only while the pointer hovers the card
- Gear appears only when a settings slot/component is provided
- Click toggles a compact popover anchored near the gear (not a fullscreen modal / backdrop)
- Close via: gear again, click outside, Escape
- Gear and popover use `@pointerdown.stop` so card drag does not start
- Widgets without settings (Weather, System Info) show no gear

### Clock settings

| Field | Values | Default |
|-------|--------|---------|
| `locale` | `"de-DE"` \| `"en-US"` | `"de-DE"` |
| `hour12` | `boolean` | `false` (24h) |
| `showSeconds` | `boolean` | `true` |
| `dateStyle` | `"short"` \| `"long"` \| `"none"` | `"long"` |
| `timeZone` | `"system"` \| IANA id | `"system"` |

- Formatting via `Intl.DateTimeFormat` (no custom format strings)
- Date examples (DE): `long` → weekday + long month; `short` → numeric short date; `none` → time only
- Timezone UI: `"system"` (OS/browser default) + curated list of ~15–20 common zones with friendly labels
- Persist under `localStorage` key `kavibay:clock-v1`
- Live-apply on change (no Save button for Clock)

### Pomodoro migration

- Remove Pomodoro’s private gear / inline overlay chrome
- Reuse shared `WidgetCard` gear + popover
- Keep existing Pomodoro settings fields and Save semantics (draft + Save)
- Keep existing `kavibay:pomodoro-v1` persistence

### Out of scope

- Fullscreen modal / dimmed backdrop
- Settings for Weather / System Info
- Full searchable IANA timezone list
- Plugin-manifest-driven settings
- Changing Pomodoro timer behavior beyond chrome migration

## Architecture

### Approach

**Slot-based shell in `WidgetCard`** with optional `settingsComponent` on the registry entry. Rejected alternatives: provide/inject registry (too much indirection for V1); per-widget copy of gear/CSS (duplicate UX).

### Data flow

```text
WidgetHost
  └─ WidgetCard (gear + popover shell)
       ├─ default slot  → widget body component
       └─ settings slot → settingsComponent (when registered)
```

Body and `settingsComponent` are separate Vue components, so they must not keep settings only in one component’s local `ref`s. Shared reactive state lives in small composables backed by the existing logic modules:

- Clock: `useClockSettings()` + `clockLogic.ts` (load/save, format, TZ list)
- Pomodoro: extract live state (settings, drafts, phase, etc.) into `usePomodoroState()` (or equivalent) on top of `pomodoroLogic.ts`, so `PomodoroWidget` and `PomodoroSettings` share one instance

Module-level singleton composables are fine for V1 (one instance of each widget on screen).

### Files

| File | Role |
|------|------|
| `src/widgets/WidgetCard.vue` | Hover gear, popover shell, `#settings` slot; gear only if slot has content |
| `src/widgets/WidgetHost.vue` | Pass body + optional settings into `WidgetCard` |
| `src/widgets/types.ts` | Optional `settingsComponent?: Component` on `WidgetDefinition` |
| `src/widgets/registry.ts` | Wire Clock + Pomodoro `settingsComponent` |
| `src/widgets/ClockWidget.vue` | Render time/date from settings |
| `src/widgets/ClockSettings.vue` (new) | Clock settings form (controls in popover) |
| `src/widgets/clockLogic.ts` (new) | Types, defaults, load/save, curated TZ list, `formatClock()` |
| `src/widgets/PomodoroWidget.vue` | Drop private gear; body only |
| `src/widgets/PomodoroSettings.vue` (new) | Existing settings form extracted for the shared popover |

### Registry shape

```ts
settingsComponent?: Component; // optional; absence ⇒ no gear
```

Host pattern:

```vue
<WidgetCard :title="def.title">
  <component :is="def.component" v-bind="stateFor(def)" />
  <template v-if="def.settingsComponent" #settings>
    <component :is="def.settingsComponent" />
  </template>
</WidgetCard>
```

### Clock formatting

- Resolve timezone: `"system"` → omit `timeZone` in `Intl` options (runtime default); else pass IANA string
- Time: `hour`/`minute` always; `second` only if `showSeconds`; `hourCycle` / `hour12` from `hour12`
- Date: omit when `dateStyle === "none"`; otherwise map to `Intl` date options for short vs long

### Curated timezones (initial set)

Include at least: system, Europe/Berlin, Europe/London, Europe/Paris, UTC, America/New_York, America/Chicago, America/Denver, America/Los_Angeles, America/Sao_Paulo, Asia/Tokyo, Asia/Shanghai, Asia/Kolkata, Australia/Sydney, Pacific/Auckland. Labels are human-readable (e.g. “Berlin”, “New York”).

### Edge cases

- Invalid / unknown stored timezone → fall back to `"system"`
- Corrupt `localStorage` JSON → defaults
- Open settings + drag elsewhere: popover closes on outside click; pointerdown on gear/popover does not drag
- Only one popover open per card (local `WidgetCard` state)
- `showSeconds: false` keeps 1s tick (harmless; display changes on minute boundary)

## Testing

- Manual: hover shows gear only on Clock/Pomodoro; Weather/System Info have none
- Clock: toggle seconds, 12h/24h, DE/US, date styles, timezone; reload app → settings persist
- Pomodoro: gear opens shared popover; Save still applies minute settings
- Drag widget by card body still works; clicking gear does not drag
- Escape / outside click closes popover
