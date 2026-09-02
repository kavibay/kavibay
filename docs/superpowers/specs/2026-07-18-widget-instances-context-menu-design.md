# Widget Instances + Context Menu + Add Menu — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Instance-based layout in `WidgetHost`; `⋯` context menu in `WidgetCard`; fixed add-widgets control bottom-right

## Goal

Replace the gear’s direct settings toggle with a per-widget context menu (Duplicate / Settings / Remove), introduce real widget **instances** (instance IDs), and add a bottom-right control to create new widgets from the registry.

## Requirements

### Context menu (widget card)

- Trigger sits where the gear is today (top-right of `WidgetCard`), hover-visible
- Icon: `⋯` (not ⚙)
- Menu items:
  1. **Duplicate**
  2. **Settings** — only when the widget type has a `settingsComponent`
  3. separator
  4. **Remove** — destructive styling
- **Settings** closes the menu and opens the existing settings popover
- Close menu via: outside click, Escape, toggle trigger again
- Trigger and menus use `@pointerdown.stop` so card drag does not start

### Instance model

- Each on-screen widget is an instance: `{ instanceId, typeId, offset }`
- Registry remains the type catalog (`id`, title, components, defaults)
- Multiple instances of the same `typeId` are allowed
- Layout persistence migrates to `kavibay:layout-v3`

### Actions

| Action | Behavior |
|--------|----------|
| **Duplicate** | New `instanceId`, same `typeId`, offset = source + (~32, ~32); copy per-instance settings state (Clock / Pomodoro) |
| **Settings** | Open existing settings popover for that card |
| **Remove** | Drop instance from layout (persisted); delete that instance’s settings storage keys |
| **Add** | Create instance of chosen registry type at default offset + small jitter |

### Add-widgets control

- Fixed bottom-right of the main window
- `data-interactive` (click-through aware)
- Opens a menu listing all registry types by title
- Selecting a type creates a new instance

### Out of scope

- Command-palette commands for add/remove
- Undo after Remove
- Plugin-manifest-driven registry
- Re-add flow beyond the bottom-right menu

## Architecture

### Approach

**Instance list owned by `WidgetHost`** (Approach 1). Registry stays static type definitions. `WidgetCard` owns menu + settings popover chrome and emits `duplicate` / `remove`. Host mutates instances and persists.

Rejected: separate Pinia store (extra indirection for V1); menu-only stubs without instances (does not meet Duplicate requirement).

### Data model

```ts
interface WidgetInstance {
  instanceId: string; // crypto.randomUUID()
  typeId: string;     // registry id
  offset: { x: number; y: number };
}

interface SavedLayout {
  palette: { x: number; y: number };
  instances: WidgetInstance[];
}
```

Storage key: `kavibay:layout-v3`.

**Migration from `kavibay:layout-v2`:** For each registry type with a saved offset (or all registry types if offsets missing), create one instance with a new `instanceId`. Migrate legacy Clock/Pomodoro singleton keys onto the first migrated instance of that type (see below). After successful migration, stop reading v2 for layout (may leave old key; optional delete).

**Fresh install:** One default instance per registry entry using registry `position` as offset (current behavior).

### Per-instance widget state

Today Clock and Pomodoro use module-level singletons (`useClockSettings`, `usePomodoroState`). With duplicates they must be keyed by `instanceId`:

- `WidgetHost` / card shell `provide('widgetInstanceId', instanceId)`
- Body + settings components `inject` and pass into composables
- Storage:
  - Clock: `kavibay:clock:<instanceId>` (migrate `kavibay:clock-v1` → first clock instance)
  - Pomodoro: `kavibay:pomodoro:<instanceId>` (migrate `kavibay:pomodoro-v1` → first pomodoro instance)
- `useWidgetData`: one call per instance (own poll timer); still keyed by type’s `backendCommand`

On Remove: delete that instance’s settings key(s).

### Data flow

```text
WidgetHost
  ├─ instances[]  (persist layout-v3)
  ├─ Add button (bottom-right) → type menu → push instance
  └─ per instance:
       WidgetCard (⋯ menu + settings popover)
         ├─ default → type.component
         └─ settings → type.settingsComponent (if any)
         provide: widgetInstanceId, closeWidgetSettings
```

### Files

| File | Role |
|------|------|
| `src/widgets/types.ts` | `WidgetInstance` (+ layout types if shared) |
| `src/widgets/WidgetHost.vue` | Instance list, drag by `instanceId`, persist/migrate, add button + type menu, wire Duplicate/Remove |
| `src/widgets/WidgetCard.vue` | `⋯` trigger, context menu, settings popover; emit `duplicate` / `remove`; Settings only if slot present |
| `src/widgets/useClockSettings.ts` + `clockLogic.ts` | Per-`instanceId` settings + key migration |
| `src/widgets/usePomodoroState.ts` + `pomodoroLogic.ts` | Per-`instanceId` state + key migration |
| `src/widgets/ClockWidget.vue` / `ClockSettings.vue` / Pomodoro* | Inject `widgetInstanceId` |
| `src/widgets/registry.ts` | Unchanged as type catalog (no instance data) |

### UI details

- Context menu and add menu: compact dark panels matching existing popover chrome (`rgba(28,28,32,…)`, blur, light border)
- Remove row: muted red text
- Add button: small fixed control, bottom-right with comfortable margin; opens upward/left so it stays on-screen
- New instance placement: registry default offset + small random jitter (±16–40px) so cards do not stack exactly; Duplicate uses deterministic +32,+32 from source

### Error / edge cases

- Unknown `typeId` in saved layout (removed from registry): skip rendering that instance; optionally prune on next persist
- Escape: close open menu/popover first; do not hide the Tauri window while a widget menu/popover is open (stop propagation / short-circuit in card handlers)
- Widgets without settings: no Settings row; menu still shows Duplicate + Remove

## Testing

- Migrate v2 layout → one instance per type, positions preserved
- Duplicate Clock → two clocks with independent locale/timezone after changing one
- Duplicate Pomodoro → independent timers
- Remove last weather instance → gone after reload; Add Weather restores a new instance
- Settings row absent for Weather / System Info
- Add button + menus do not start widget/palette drag; regions stay interactive (`data-interactive`)
- Escape closes menu/popover before window hide
