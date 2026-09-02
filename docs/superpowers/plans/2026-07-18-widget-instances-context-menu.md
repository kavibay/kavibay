# Widget Instances + Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-widget `⋯` context menu (Duplicate / Settings / Remove), real widget instances with IDs, and a bottom-right add-widgets control.

**Architecture:** `WidgetHost` owns `instances[]` persisted as `kavibay:layout-v3` (migrate from v2). `WidgetCard` owns the `⋯` menu + settings popover and emits `duplicate` / `remove`. Clock/Pomodoro state becomes keyed by `instanceId` via `provide`/`inject`. A small `WidgetInstanceView` mounts `useWidgetData` per instance.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 overlay (no new dependencies).

## Global Constraints

- Layout key: `kavibay:layout-v3`; migrate from `kavibay:layout-v2`
- Clock keys: `kavibay:clock:<instanceId>`; migrate legacy `kavibay:clock-v1` once
- Pomodoro keys: `kavibay:pomodoro:<instanceId>`; migrate legacy `kavibay:pomodoro-v1` once
- Context menu icon: `⋯`; Settings row only when `settingsComponent` exists
- Add control: fixed bottom-right, `data-interactive`
- Duplicate offset: source + `(32, 32)`; Add offset: registry default + jitter ±24px
- Escape must close menu/popover before App hides the window (`stopImmediatePropagation` in capture)
- No test runner — verify with `npx vue-tsc --noEmit` and manual UI checks
- Skip git commits unless the user explicitly asks (this workspace may have no `.git`)

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/types.ts` | Add `WidgetInstance`, `SavedLayoutV3`, keep `WidgetDefinition` |
| `src/widgets/layoutLogic.ts` | Load/migrate/save layout; create/duplicate helpers; jitter |
| `src/widgets/clockLogic.ts` | Per-instance load/save/clear/copy + legacy migrate |
| `src/widgets/useClockSettings.ts` | Map of settings by `instanceId` |
| `src/widgets/pomodoroLogic.ts` | Per-instance load/save/clear/copy + legacy migrate |
| `src/widgets/usePomodoroState.ts` | Map of state by `instanceId` |
| `src/widgets/ClockWidget.vue` / `ClockSettings.vue` | Inject `widgetInstanceId` |
| `src/widgets/PomodoroWidget.vue` / `PomodoroSettings.vue` | Inject `widgetInstanceId` |
| `src/widgets/WidgetCard.vue` | `⋯` menu + settings popover; emit events |
| `src/widgets/WidgetInstanceView.vue` | Per-instance `useWidgetData` + card wiring |
| `src/widgets/WidgetHost.vue` | Instances, drag, add menu, duplicate/remove |
| `src/widgets/registry.ts` | Unchanged type catalog |

---

### Task 1: Layout types + `layoutLogic`

**Files:**
- Modify: `src/widgets/types.ts`
- Create: `src/widgets/layoutLogic.ts`

**Interfaces:**
- Produces:
  - `WidgetInstance { instanceId: string; typeId: string; offset: WidgetPosition }`
  - `SavedLayoutV3 { palette: WidgetPosition; instances: WidgetInstance[] }`
  - `LAYOUT_STORAGE_KEY = "kavibay:layout-v3"`
  - `LAYOUT_STORAGE_KEY_V2 = "kavibay:layout-v2"`
  - `newInstanceId(): string`
  - `defaultInstances(registry): WidgetInstance[]`
  - `loadLayout(registry): { palette: WidgetPosition; instances: WidgetInstance[] }`
  - `saveLayout(layout): void`
  - `duplicateInstance(source): WidgetInstance` (new id, offset +32/+32)
  - `createInstance(typeId, baseOffset): WidgetInstance` (jittered offset)
  - `clearInstanceSettings(typeId, instanceId): void` (delegates to clock/pomodoro clear — stub imports added in Task 2/3; for Task 1 export a no-op hook or only layout helpers and clear in Host later)

- [ ] **Step 1: Extend `src/widgets/types.ts`**

Add after `WidgetPosition`:

```ts
/** One on-screen widget card (may share a registry type with other instances). */
export interface WidgetInstance {
  instanceId: string;
  typeId: string;
  offset: WidgetPosition;
}

/** Persisted layout for layout-v3. */
export interface SavedLayoutV3 {
  palette: WidgetPosition;
  instances: WidgetInstance[];
}
```

- [ ] **Step 2: Create `src/widgets/layoutLogic.ts`**

```ts
import type { WidgetDefinition, WidgetInstance, WidgetPosition, SavedLayoutV3 } from "./types";

export const LAYOUT_STORAGE_KEY = "kavibay:layout-v3";
export const LAYOUT_STORAGE_KEY_V2 = "kavibay:layout-v2";

const DUPLICATE_DELTA = 32;
const JITTER = 24;

/** Cryptographically random instance id (falls back if crypto unavailable). */
export function newInstanceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `inst-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** One instance per registry entry using registry default positions. */
export function defaultInstances(registry: WidgetDefinition[]): WidgetInstance[] {
  return registry.map((def) => ({
    instanceId: newInstanceId(),
    typeId: def.id,
    offset: { ...def.position },
  }));
}

function jitter(n: number): number {
  return n + (Math.random() * 2 - 1) * JITTER;
}

/** New instance at base offset with small random jitter. */
export function createInstance(typeId: string, baseOffset: WidgetPosition): WidgetInstance {
  return {
    instanceId: newInstanceId(),
    typeId,
    offset: { x: jitter(baseOffset.x), y: jitter(baseOffset.y) },
  };
}

/** Clone instance with new id and +32/+32 offset. */
export function duplicateInstance(source: WidgetInstance): WidgetInstance {
  return {
    instanceId: newInstanceId(),
    typeId: source.typeId,
    offset: {
      x: source.offset.x + DUPLICATE_DELTA,
      y: source.offset.y + DUPLICATE_DELTA,
    },
  };
}

interface SavedLayoutV2 {
  palette?: WidgetPosition;
  offsets?: Record<string, WidgetPosition>;
}

/**
 * Load layout-v3, or migrate v2 (one instance per registry type), or defaults.
 * Does not delete the v2 key (optional cleanup left to caller).
 */
export function loadLayout(registry: WidgetDefinition[]): SavedLayoutV3 {
  const defaultPalette: WidgetPosition = {
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 0,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 0,
  };

  try {
    const v3raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (v3raw) {
      const v3 = JSON.parse(v3raw) as SavedLayoutV3;
      if (Array.isArray(v3.instances) && v3.palette) {
        return {
          palette: { ...v3.palette },
          instances: v3.instances
            .filter(
              (i) =>
                i &&
                typeof i.instanceId === "string" &&
                typeof i.typeId === "string" &&
                i.offset &&
                typeof i.offset.x === "number" &&
                typeof i.offset.y === "number",
            )
            .map((i) => ({
              instanceId: i.instanceId,
              typeId: i.typeId,
              offset: { x: i.offset.x, y: i.offset.y },
            })),
        };
      }
    }
  } catch {
    // fall through
  }

  try {
    const v2raw = localStorage.getItem(LAYOUT_STORAGE_KEY_V2);
    if (v2raw) {
      const v2 = JSON.parse(v2raw) as SavedLayoutV2;
      const palette = v2.palette ?? defaultPalette;
      const instances = registry.map((def) => ({
        instanceId: newInstanceId(),
        typeId: def.id,
        offset: v2.offsets?.[def.id]
          ? { ...v2.offsets[def.id] }
          : { ...def.position },
      }));
      const migrated: SavedLayoutV3 = { palette: { ...palette }, instances };
      saveLayout(migrated);
      return migrated;
    }
  } catch {
    // fall through
  }

  return {
    palette: defaultPalette,
    instances: defaultInstances(registry),
  };
}

/** Persist layout-v3. */
export function saveLayout(layout: SavedLayoutV3): void {
  const payload: SavedLayoutV3 = {
    palette: { ...layout.palette },
    instances: layout.instances.map((i) => ({
      instanceId: i.instanceId,
      typeId: i.typeId,
      offset: { x: i.offset.x, y: i.offset.y },
    })),
  };
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
}
```

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS (or only pre-existing errors unrelated to these files)

---

### Task 2: Per-instance Clock settings

**Files:**
- Modify: `src/widgets/clockLogic.ts`
- Modify: `src/widgets/useClockSettings.ts`
- Modify: `src/widgets/ClockWidget.vue`
- Modify: `src/widgets/ClockSettings.vue`

**Interfaces:**
- Consumes: `widgetInstanceId` inject (string)
- Produces:
  - `clockStorageKey(instanceId): string` → `kavibay:clock:${instanceId}`
  - `loadClockSettings(instanceId)`, `saveClockSettings(instanceId, settings)`
  - `clearClockSettings(instanceId)`, `copyClockSettings(fromId, toId)`
  - `migrateLegacyClockSettings(instanceId)` — copies `kavibay:clock-v1` once if present
  - `useClockSettings(instanceId): { settings, update }`

- [ ] **Step 1: Update `clockLogic.ts` persistence API**

Replace `CLOCK_STORAGE_KEY` usage in load/save with keyed helpers. Keep `CLOCK_STORAGE_KEY = "kavibay:clock-v1"` as the **legacy** constant.

```ts
export const CLOCK_STORAGE_KEY = "kavibay:clock-v1"; // legacy singleton

/** Per-instance clock settings key. */
export function clockStorageKey(instanceId: string): string {
  return `kavibay:clock:${instanceId}`;
}

/** If legacy key exists and instance key does not, copy once then remove legacy. */
export function migrateLegacyClockSettings(instanceId: string): void {
  try {
    if (localStorage.getItem(clockStorageKey(instanceId))) return;
    const legacy = localStorage.getItem(CLOCK_STORAGE_KEY);
    if (!legacy) return;
    localStorage.setItem(clockStorageKey(instanceId), legacy);
    localStorage.removeItem(CLOCK_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function loadClockSettings(instanceId: string): ClockSettings {
  migrateLegacyClockSettings(instanceId);
  try {
    const raw = JSON.parse(localStorage.getItem(clockStorageKey(instanceId)) ?? "null");
    return normalizeClockSettings(raw);
  } catch {
    return { ...DEFAULT_CLOCK_SETTINGS };
  }
}

export function saveClockSettings(instanceId: string, settings: ClockSettings): void {
  localStorage.setItem(
    clockStorageKey(instanceId),
    JSON.stringify(normalizeClockSettings(settings)),
  );
}

export function clearClockSettings(instanceId: string): void {
  localStorage.removeItem(clockStorageKey(instanceId));
}

/** Copy persisted (+ in-memory later via composable) settings to a new instance id. */
export function copyClockSettings(fromId: string, toId: string): void {
  saveClockSettings(toId, loadClockSettings(fromId));
}
```

- [ ] **Step 2: Rewrite `useClockSettings.ts` as a per-instance map**

```ts
import { type Ref, ref } from "vue";
import {
  type ClockSettings,
  loadClockSettings,
  normalizeClockSettings,
  saveClockSettings,
} from "./clockLogic";

const cache = new Map<string, Ref<ClockSettings>>();

function ensure(instanceId: string): Ref<ClockSettings> {
  let existing = cache.get(instanceId);
  if (!existing) {
    existing = ref(loadClockSettings(instanceId));
    cache.set(instanceId, existing);
  }
  return existing;
}

/** Per-instance clock settings shared by ClockWidget + ClockSettings. */
export function useClockSettings(instanceId: string) {
  const settings = ensure(instanceId);

  function update(partial: Partial<ClockSettings>) {
    settings.value = normalizeClockSettings({ ...settings.value, ...partial });
    saveClockSettings(instanceId, settings.value);
  }

  return { settings, update };
}

/** Drop in-memory cache entry (after Remove). */
export function disposeClockSettings(instanceId: string): void {
  cache.delete(instanceId);
}

/** Ensure target cache matches source after Duplicate. */
export function seedClockSettingsFrom(fromId: string, toId: string): void {
  const from = ensure(fromId);
  cache.set(toId, ref(normalizeClockSettings({ ...from.value })));
  saveClockSettings(toId, cache.get(toId)!.value);
}
```

- [ ] **Step 3: Wire Clock components to inject**

In `ClockWidget.vue` and `ClockSettings.vue`:

```ts
import { inject } from "vue";
// ...
const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");
const { settings /*, update */ } = useClockSettings(instanceId);
```

(`ClockSettings` keeps its `update` handlers as today.)

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: errors only if Host/Card do not yet provide `widgetInstanceId` — acceptable until Task 5; prefer temporary provide in Host or finish Task 5 before claiming green. Prefer implementing Task 5 next so tsc stays green.

---

### Task 3: Per-instance Pomodoro state

**Files:**
- Modify: `src/widgets/pomodoroLogic.ts`
- Modify: `src/widgets/usePomodoroState.ts`
- Modify: `src/widgets/PomodoroWidget.vue`
- Modify: `src/widgets/PomodoroSettings.vue`

**Interfaces:**
- Produces:
  - `pomodoroStorageKey(instanceId)`, `loadPersisted(instanceId)`, `savePersisted(instanceId, state)`
  - `clearPomodoroSettings(instanceId)`, `migrateLegacyPomodoro(instanceId)`
  - `usePomodoroState(instanceId)` — full API as today
  - `disposePomodoroState(instanceId)`, `seedPomodoroStateFrom(fromId, toId)`

- [ ] **Step 1: Keyed persistence in `pomodoroLogic.ts`**

Mirror clock pattern:

```ts
export const POMODORO_STORAGE_KEY = "kavibay:pomodoro-v1"; // legacy

export function pomodoroStorageKey(instanceId: string): string {
  return `kavibay:pomodoro:${instanceId}`;
}

export function migrateLegacyPomodoro(instanceId: string): void {
  try {
    if (localStorage.getItem(pomodoroStorageKey(instanceId))) return;
    const legacy = localStorage.getItem(POMODORO_STORAGE_KEY);
    if (!legacy) return;
    localStorage.setItem(pomodoroStorageKey(instanceId), legacy);
    localStorage.removeItem(POMODORO_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function loadPersisted(instanceId: string): PomodoroPersisted {
  migrateLegacyPomodoro(instanceId);
  try {
    const raw = JSON.parse(localStorage.getItem(pomodoroStorageKey(instanceId)) ?? "null");
    return normalizePersisted(raw);
  } catch {
    return normalizePersisted(null);
  }
}

export function savePersisted(instanceId: string, state: PomodoroPersisted): void {
  try {
    localStorage.setItem(pomodoroStorageKey(instanceId), JSON.stringify(normalizePersisted(state)));
  } catch {
    // best-effort
  }
}

export function clearPomodoroSettings(instanceId: string): void {
  localStorage.removeItem(pomodoroStorageKey(instanceId));
}
```

Export `normalizePersisted` if needed for seeding, or keep it private and load/save only.

- [ ] **Step 2: Refactor `usePomodoroState.ts` to a factory map**

Move all module-level refs into `createPomodoroState(instanceId)` stored in `Map<string, ReturnType<...>>`. Each entry owns its own `deadlineAt` / `tickTimer`.

```ts
const cache = new Map<string, ReturnType<typeof createPomodoroState>>();

function createPomodoroState(instanceId: string) {
  const saved = loadPersisted(instanceId);
  // ... all current refs/computed/functions, but persist() calls savePersisted(instanceId, ...)
  // dispose() clears tick + cache.delete(instanceId) optionally left to disposePomodoroState
  return { /* same public fields as today */ };
}

export function usePomodoroState(instanceId: string) {
  let state = cache.get(instanceId);
  if (!state) {
    state = createPomodoroState(instanceId);
    cache.set(instanceId, state);
  }
  return state;
}

export function disposePomodoroState(instanceId: string): void {
  const state = cache.get(instanceId);
  state?.dispose();
  cache.delete(instanceId);
}

export function seedPomodoroStateFrom(fromId: string, toId: string): void {
  const from = usePomodoroState(fromId);
  savePersisted(toId, {
    settings: { ...from.settings.value },
    phase: from.phase.value,
    completedFocusSessions: from.completedFocusSessions.value,
  });
  // Ensure cache for toId loads from storage:
  disposePomodoroState(toId);
  usePomodoroState(toId);
}
```

Keep exporting `RING_R` / `RING_C`.

- [ ] **Step 3: Inject in Pomodoro widgets**

Same pattern as Clock: `inject("widgetInstanceId")` then `usePomodoroState(instanceId)`.  
`PomodoroWidget` `onUnmounted` should **not** dispose the shared instance state while settings popover might remount — only clear the tick if this was the last consumer, or leave tick running until Host removes the instance. Simplest V1: remove `dispose()` from widget `onUnmounted`; Host calls `disposePomodoroState` on Remove only.

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit`

---

### Task 4: `WidgetCard` context menu

**Files:**
- Modify: `src/widgets/WidgetCard.vue` (replace gear-direct-toggle behavior)

**Interfaces:**
- Consumes: props `title: string`, `instanceId: string`, `hasSettings: boolean`
- Produces: emits `duplicate`, `remove`; provides `widgetInstanceId`, `closeWidgetSettings`
- Settings popover still via `#settings` slot

- [ ] **Step 1: Replace script in `WidgetCard.vue`**

```ts
import { onMounted, onUnmounted, provide, ref, useSlots } from "vue";

const props = defineProps<{
  title: string;
  instanceId: string;
  hasSettings: boolean;
}>();

const emit = defineEmits<{
  duplicate: [];
  remove: [];
}>();

const slots = useSlots();
const menuOpen = ref(false);
const settingsOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);

provide("widgetInstanceId", props.instanceId);
provide("closeWidgetSettings", () => {
  settingsOpen.value = false;
});

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value) settingsOpen.value = false;
}

function openSettings() {
  menuOpen.value = false;
  if (props.hasSettings) settingsOpen.value = true;
}

function onDuplicate() {
  menuOpen.value = false;
  emit("duplicate");
}

function onRemove() {
  menuOpen.value = false;
  emit("remove");
}

function onDocPointerDown(e: PointerEvent) {
  if (!rootEl.value) return;
  if (!rootEl.value.contains(e.target as Node)) {
    menuOpen.value = false;
    settingsOpen.value = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (!menuOpen.value && !settingsOpen.value) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  menuOpen.value = false;
  settingsOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeydown, true);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onKeydown, true);
});
```

- [ ] **Step 2: Replace template**

```vue
<template>
  <div
    ref="rootEl"
    class="widget-card"
    :class="{ 'widget-card--menu-open': menuOpen || settingsOpen }"
  >
    <button
      type="button"
      class="widget-menu-trigger"
      title="Widget menu"
      aria-label="Widget menu"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      @pointerdown.stop
      @click.stop="toggleMenu"
    >
      ⋯
    </button>

    <div
      v-if="menuOpen"
      class="widget-context-menu"
      role="menu"
      @pointerdown.stop
    >
      <button type="button" role="menuitem" class="widget-menu-item" @click="onDuplicate">
        Duplicate
      </button>
      <button
        v-if="hasSettings && slots.settings"
        type="button"
        role="menuitem"
        class="widget-menu-item"
        @click="openSettings"
      >
        Settings
      </button>
      <div class="widget-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        class="widget-menu-item widget-menu-item--danger"
        @click="onRemove"
      >
        Remove
      </button>
    </div>

    <div
      v-if="hasSettings && settingsOpen"
      class="widget-settings-popover"
      @pointerdown.stop
    >
      <slot name="settings" />
    </div>

    <p class="widget-card-title">{{ title }}</p>
    <div class="widget-card-body">
      <slot />
    </div>
  </div>
</template>
```

- [ ] **Step 3: CSS**

Rename `.widget-settings-gear` → `.widget-menu-trigger` (same positioning/hover rules). Add menu styles matching the settings popover:

```css
.widget-context-menu {
  position: absolute;
  top: 40px;
  right: 8px;
  z-index: 4;
  min-width: 160px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(28, 28, 32, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.widget-menu-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.widget-menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.widget-menu-item--danger {
  color: #e07a5f;
}

.widget-menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: rgba(255, 255, 255, 0.1);
}
```

Keep `.widget-settings-popover` as today (z-index 3 is fine under menu z-index 4).

Trigger visible on `.widget-card:hover` and `.widget-card--menu-open`.

---

### Task 5: `WidgetInstanceView` + `WidgetHost` instances / add menu

**Files:**
- Create: `src/widgets/WidgetInstanceView.vue`
- Modify: `src/widgets/WidgetHost.vue` (major)
- Optionally add: `clearInstanceSettings` helper in a tiny `instanceCleanup.ts` or inline in Host

**Interfaces:**
- Consumes: `layoutLogic`, registry, card emits, clock/pomodoro seed/dispose/clear
- Produces: working multi-instance host with add button

- [ ] **Step 1: Create `WidgetInstanceView.vue`**

```vue
<script setup lang="ts">
import type { WidgetDefinition, WidgetInstance, WidgetProps } from "./types";
import { useWidgetData } from "./useWidgetData";
import WidgetCard from "./WidgetCard.vue";

const props = defineProps<{
  instance: WidgetInstance;
  def: WidgetDefinition;
}>();

defineEmits<{
  duplicate: [];
  remove: [];
}>();

const state = useWidgetData(props.def);

function bind(): WidgetProps {
  return {
    data: state.data.value,
    loading: state.loading.value,
    error: state.error.value,
    lastUpdated: state.lastUpdated.value,
  };
}
</script>

<template>
  <WidgetCard
    :title="def.title"
    :instance-id="instance.instanceId"
    :has-settings="Boolean(def.settingsComponent)"
    data-interactive
    @duplicate="$emit('duplicate')"
    @remove="$emit('remove')"
  >
    <component :is="def.component" v-bind="bind()" />
    <template v-if="def.settingsComponent" #settings>
      <component :is="def.settingsComponent" />
    </template>
  </WidgetCard>
</template>
```

Note: `bind()` as a function in template will not be reactive to `state.data` updates. Prefer computed:

```ts
import { computed } from "vue";
const widgetProps = computed<WidgetProps>(() => ({
  data: state.data.value,
  loading: state.loading.value,
  error: state.error.value,
  lastUpdated: state.lastUpdated.value,
}));
```

Template: `v-bind="widgetProps"`.

- [ ] **Step 2: Rewrite layout/drag section of `WidgetHost.vue`**

Key changes:

1. Remove per-type `widgetStates` Map and `offsets` Record.
2. `const layout = loadLayout(widgetRegistry)` then:
   - `palettePos = reactive(layout.palette)`
   - `instances = reactive<WidgetInstance[]>(layout.instances)`
3. `persist()` → `saveLayout({ palette: palettePos, instances })`
4. Drag target: `{ kind: "widget"; instanceId: string }`
5. `widgetStyle(instance)` from `palettePos + instance.offset`
6. On migrate path, after first load, call legacy settings migration for first clock/pomodoro instance:
   - already handled inside `loadClockSettings` / `loadPersisted` on first use
7. Template loop:

```vue
<div
  v-for="inst in instances"
  :key="inst.instanceId"
  class="widget-anchor"
  :style="widgetStyle(inst)"
  @pointerdown="onPointerDown($event, { kind: 'widget', instanceId: inst.instanceId })"
  ...
>
  <WidgetInstanceView
    v-if="defFor(inst.typeId)"
    :instance="inst"
    :def="defFor(inst.typeId)!"
    @duplicate="onDuplicate(inst.instanceId)"
    @remove="onRemove(inst.instanceId)"
  />
</div>
```

```ts
function defFor(typeId: string) {
  return widgetRegistry.find((d) => d.id === typeId);
}
```

- [ ] **Step 3: Implement Duplicate / Remove / Add**

```ts
import { clearClockSettings } from "./clockLogic";
import { disposeClockSettings, seedClockSettingsFrom } from "./useClockSettings";
import { clearPomodoroSettings } from "./pomodoroLogic";
import {
  disposePomodoroState,
  seedPomodoroStateFrom,
} from "./usePomodoroState";
import {
  createInstance,
  duplicateInstance,
  loadLayout,
  saveLayout,
} from "./layoutLogic";
import { scheduleRegionSync, syncInteractiveRegions } from "../system/clickThrough";

function onDuplicate(instanceId: string) {
  const source = instances.find((i) => i.instanceId === instanceId);
  if (!source) return;
  const copy = duplicateInstance(source);
  if (source.typeId === "clock") seedClockSettingsFrom(source.instanceId, copy.instanceId);
  if (source.typeId === "pomodoro") seedPomodoroStateFrom(source.instanceId, copy.instanceId);
  instances.push(copy);
  persist();
  scheduleRegionSync();
}

function onRemove(instanceId: string) {
  const idx = instances.findIndex((i) => i.instanceId === instanceId);
  if (idx < 0) return;
  const [removed] = instances.splice(idx, 1);
  if (removed.typeId === "clock") {
    disposeClockSettings(removed.instanceId);
    clearClockSettings(removed.instanceId);
  }
  if (removed.typeId === "pomodoro") {
    disposePomodoroState(removed.instanceId);
    clearPomodoroSettings(removed.instanceId);
  }
  persist();
  scheduleRegionSync();
}

const addMenuOpen = ref(false);

function onAddType(typeId: string) {
  const def = defFor(typeId);
  if (!def) return;
  instances.push(createInstance(typeId, def.position));
  addMenuOpen.value = false;
  persist();
  scheduleRegionSync();
}
```

- [ ] **Step 4: Add-widgets UI (bottom-right) in Host template**

```vue
<div class="widget-add" data-interactive @pointerdown.stop>
  <button
    type="button"
    class="widget-add-btn"
    title="Add widget"
    aria-label="Add widget"
    aria-haspopup="menu"
    :aria-expanded="addMenuOpen"
    @click="addMenuOpen = !addMenuOpen"
  >
    +
  </button>
  <div v-if="addMenuOpen" class="widget-add-menu" role="menu" @pointerdown.stop>
    <button
      v-for="def in widgetRegistry"
      :key="def.id"
      type="button"
      role="menuitem"
      class="widget-add-item"
      @click="onAddType(def.id)"
    >
      {{ def.title }}
    </button>
  </div>
</div>
```

CSS (scoped):

```css
.widget-add {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 20;
  pointer-events: auto;
}

.widget-add-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(28, 28, 32, 0.85);
  color: rgba(255, 255, 255, 0.9);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.widget-add-menu {
  position: absolute;
  right: 0;
  bottom: 48px;
  min-width: 180px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(28, 28, 32, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.widget-add-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.widget-add-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
```

Close add menu on outside click / Escape similarly (small handlers in Host, capture Escape with `stopImmediatePropagation` when open).

- [ ] **Step 5: Typecheck + region sync**

Run: `npx vue-tsc --noEmit`  
Expected: PASS  

After UI changes, ensure `scheduleRegionSync()` / `syncInteractiveRegions()` run when add menu opens (button is `data-interactive`; menu should also be inside the `data-interactive` root so rects cover it — put `data-interactive` on `.widget-add` wrapper as above).

---

### Task 6: Manual verification

**Files:** none (checklist)

- [ ] **Step 1: `npx vue-tsc --noEmit`** — PASS

- [ ] **Step 2: Manual UI**

1. Fresh / migrated layout: existing widgets appear; positions from v2 preserved  
2. Hover card → `⋯` → Duplicate Clock → second clock; change timezone on one only  
3. Duplicate Pomodoro → independent Start/Pause  
4. Settings only on Clock/Pomodoro menus  
5. Remove Weather → gone after reload; `+` → Weather restores  
6. `+` menu bottom-right lists all registry titles  
7. Escape closes menu/popover without hiding window; second Escape (or none open) may still hide per App.vue  
8. Drag still works; menu click does not start drag  

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `⋯` menu Duplicate / Settings / Remove | Task 4 |
| Settings row only if settingsComponent | Task 4 |
| Instance IDs + layout-v3 + v2 migrate | Task 1, 5 |
| Duplicate copies settings | Task 2, 3, 5 |
| Remove + clear storage | Task 2, 3, 5 |
| Add button bottom-right | Task 5 |
| Per-instance Clock/Pomodoro | Task 2, 3 |
| Escape before window hide | Task 4, 5 |
| click-through / data-interactive | Task 5 |

**Placeholder scan:** none intentional.  
**Type consistency:** `WidgetInstance.instanceId` / `typeId` / `offset` used uniformly; composables take `instanceId: string`.
