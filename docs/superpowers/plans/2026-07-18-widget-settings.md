# Widget Settings Shell + Clock Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shared hover-gear + settings popover on `WidgetCard`, Clock settings (locale/format/timezone), migrate Pomodoro onto the same shell.

**Architecture:** `WidgetCard` owns gear/popover and a `#settings` slot. Registry entries may set `settingsComponent`. Clock/Pomodoro body + settings share state via singleton composables. Pure helpers in `clockLogic.ts`; Pomodoro keeps `pomodoroLogic.ts` and extracts UI state into `usePomodoroState()`.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 overlay (no new dependencies).

## Global Constraints

- Client-side only — no new `invoke()` / `backendCommand`
- Clock persist key: `kavibay:clock-v1` (live-apply)
- Pomodoro persist key: `kavibay:pomodoro-v1` (unchanged Save semantics)
- Gear only when `settingsComponent` is set; hover-reveal; popover not fullscreen modal
- Gear/popover `@pointerdown.stop` so card drag does not start
- No test runner — verify with `npx vue-tsc --noEmit` and manual UI checks
- Skip git commits unless the user explicitly asks

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/clockLogic.ts` | Clock types, defaults, TZ list, load/save, `formatClock` |
| `src/widgets/useClockSettings.ts` | Singleton reactive clock settings |
| `src/widgets/ClockSettings.vue` | Clock settings form |
| `src/widgets/ClockWidget.vue` | Display from settings |
| `src/widgets/usePomodoroState.ts` | Singleton reactive pomodoro UI/timer state |
| `src/widgets/PomodoroSettings.vue` | Extracted settings form (draft + Save) |
| `src/widgets/PomodoroWidget.vue` | Body only; use shared state |
| `src/widgets/WidgetCard.vue` | Gear + popover shell |
| `src/widgets/WidgetHost.vue` | Wire settings slot |
| `src/widgets/types.ts` | `settingsComponent?` |
| `src/widgets/registry.ts` | Register settings components |

---

### Task 1: `clockLogic` + `useClockSettings`

**Files:**
- Create: `src/widgets/clockLogic.ts`
- Create: `src/widgets/useClockSettings.ts`

**Interfaces:**
- Produces:
  - `ClockLocale = "de-DE" | "en-US"`
  - `ClockDateStyle = "short" | "long" | "none"`
  - `ClockSettings { locale, hour12, showSeconds, dateStyle, timeZone }`
  - `CLOCK_STORAGE_KEY`, `DEFAULT_CLOCK_SETTINGS`, `CURATED_TIMEZONES`
  - `loadClockSettings()`, `saveClockSettings()`, `formatClock(date, settings): { time, date }`
  - `useClockSettings(): { settings: Ref<ClockSettings>; update(partial): void }`

- [ ] **Step 1: Create `src/widgets/clockLogic.ts`**

```ts
export type ClockLocale = "de-DE" | "en-US";
export type ClockDateStyle = "short" | "long" | "none";

export interface ClockSettings {
  locale: ClockLocale;
  hour12: boolean;
  showSeconds: boolean;
  dateStyle: ClockDateStyle;
  /** `"system"` or IANA id */
  timeZone: string;
}

export const CLOCK_STORAGE_KEY = "kavibay:clock-v1";

export const DEFAULT_CLOCK_SETTINGS: ClockSettings = {
  locale: "de-DE",
  hour12: false,
  showSeconds: true,
  dateStyle: "long",
  timeZone: "system",
};

export interface TimeZoneOption {
  id: string;
  label: string;
}

export const CURATED_TIMEZONES: TimeZoneOption[] = [
  { id: "system", label: "System" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "UTC", label: "UTC" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/Denver", label: "Denver" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Sao_Paulo", label: "São Paulo" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Asia/Shanghai", label: "Shanghai" },
  { id: "Asia/Kolkata", label: "Kolkata" },
  { id: "Australia/Sydney", label: "Sydney" },
  { id: "Pacific/Auckland", label: "Auckland" },
];

const ALLOWED_TZ = new Set(CURATED_TIMEZONES.map((z) => z.id));

/** Normalize raw persisted settings; invalid TZ → system. */
export function normalizeClockSettings(raw: unknown): ClockSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const locale: ClockLocale = o.locale === "en-US" ? "en-US" : "de-DE";
  const dateStyle: ClockDateStyle =
    o.dateStyle === "short" || o.dateStyle === "none" ? o.dateStyle : "long";
  const timeZone =
    typeof o.timeZone === "string" && ALLOWED_TZ.has(o.timeZone) ? o.timeZone : "system";
  return {
    locale,
    hour12: Boolean(o.hour12),
    showSeconds: o.showSeconds !== false,
    dateStyle,
    timeZone,
  };
}

export function loadClockSettings(): ClockSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOCK_STORAGE_KEY) ?? "null");
    return normalizeClockSettings(raw);
  } catch {
    return { ...DEFAULT_CLOCK_SETTINGS };
  }
}

export function saveClockSettings(settings: ClockSettings): void {
  localStorage.setItem(CLOCK_STORAGE_KEY, JSON.stringify(normalizeClockSettings(settings)));
}

/** Format time + optional date line for the clock widget. */
export function formatClock(
  date: Date,
  settings: ClockSettings,
): { time: string; date: string | null } {
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: settings.hour12,
  };
  if (settings.showSeconds) timeOpts.second = "2-digit";
  if (settings.timeZone !== "system") timeOpts.timeZone = settings.timeZone;

  const time = new Intl.DateTimeFormat(settings.locale, timeOpts).format(date);

  if (settings.dateStyle === "none") return { time, date: null };

  const dateOpts: Intl.DateTimeFormatOptions =
    settings.dateStyle === "short"
      ? { day: "2-digit", month: "2-digit", year: "numeric" }
      : { weekday: "long", day: "2-digit", month: "long", year: "numeric" };
  if (settings.timeZone !== "system") dateOpts.timeZone = settings.timeZone;

  return {
    time,
    date: new Intl.DateTimeFormat(settings.locale, dateOpts).format(date),
  };
}
```

- [ ] **Step 2: Create `src/widgets/useClockSettings.ts`**

```ts
import { ref } from "vue";
import {
  type ClockSettings,
  loadClockSettings,
  saveClockSettings,
  normalizeClockSettings,
} from "./clockLogic";

const settings = ref<ClockSettings>(loadClockSettings());

/** Singleton clock settings shared by ClockWidget + ClockSettings. */
export function useClockSettings() {
  function update(partial: Partial<ClockSettings>) {
    settings.value = normalizeClockSettings({ ...settings.value, ...partial });
    saveClockSettings(settings.value);
  }

  return { settings, update };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS (or only pre-existing unrelated errors)

---

### Task 2: Clock UI (widget + settings form)

**Files:**
- Modify: `src/widgets/ClockWidget.vue`
- Create: `src/widgets/ClockSettings.vue`

- [ ] **Step 1: Rewrite `ClockWidget.vue` to use settings**

```vue
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { WidgetProps } from "./types";
import { formatClock } from "./clockLogic";
import { useClockSettings } from "./useClockSettings";

defineProps<WidgetProps>();

const { settings } = useClockSettings();
const now = ref(new Date());
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date();
  }, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const formatted = computed(() => formatClock(now.value, settings.value));
</script>

<template>
  <div class="clock">
    <p class="clock-time">{{ formatted.time }}</p>
    <p v-if="formatted.date" class="clock-date">{{ formatted.date }}</p>
  </div>
</template>

<style scoped>
.clock-time {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.clock-date {
  margin: 4px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}
</style>
```

- [ ] **Step 2: Create `ClockSettings.vue`**

Form fields: locale select (DE/US), hour12 checkbox or select (12h/24h), showSeconds checkbox, dateStyle select, timeZone select from `CURATED_TIMEZONES`. On change call `update(...)`. Style similar to pomodoro settings labels/inputs (compact dark form). `@pointerdown.stop` on root.

- [ ] **Step 3: Typecheck** — `npx vue-tsc --noEmit`

---

### Task 3: WidgetCard settings shell

**Files:**
- Modify: `src/widgets/WidgetCard.vue`

- [ ] **Step 1: Add gear + popover to `WidgetCard.vue`**

Requirements:
- `useSlots()` → `hasSettings = Boolean(slots.settings)`
- Local `open` ref; toggle on gear click
- Gear top-right; opacity 0 until `.widget-card:hover` or `open`
- Popover below gear (absolute), contains `<slot name="settings" />`
- Outside click: `mousedown`/`pointerdown` on `document` while open → close if outside card settings UI
- Escape key while open → close
- `@pointerdown.stop` on gear and popover
- `position: relative` on `.widget-card`

Sketch:

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, ref, useSlots } from "vue";

defineProps<{ title: string }>();

const slots = useSlots();
const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

function toggle() {
  open.value = !open.value;
}

function onDocPointerDown(e: PointerEvent) {
  if (!open.value || !rootEl.value) return;
  if (!rootEl.value.contains(e.target as Node)) open.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="rootEl" class="widget-card" :class="{ 'widget-card--settings-open': open }">
    <button
      v-if="slots.settings"
      type="button"
      class="widget-settings-gear"
      title="Settings"
      aria-label="Settings"
      @pointerdown.stop
      @click.stop="toggle"
    >
      ⚙
    </button>
    <div
      v-if="slots.settings && open"
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

CSS: gear absolute top-right, opacity 0 by default, visible on `.widget-card:hover .widget-settings-gear` and when open; popover absolute top ~28px right 0, min-width ~200px, dark glass matching card.

- [ ] **Step 2: Typecheck**

---

### Task 4: Host + registry + types

**Files:**
- Modify: `src/widgets/types.ts`
- Modify: `src/widgets/registry.ts`
- Modify: `src/widgets/WidgetHost.vue`

- [ ] **Step 1: Add `settingsComponent?: Component` to `WidgetDefinition`**

- [ ] **Step 2: Register Clock settings**

```ts
import ClockSettings from "./ClockSettings.vue";
// clock entry:
settingsComponent: ClockSettings,
```

(Pomodoro settings wired in Task 5.)

- [ ] **Step 3: Update `WidgetHost.vue` template**

```vue
<WidgetCard :title="def.title" data-interactive>
  <component :is="def.component" v-bind="stateFor(def)" />
  <template v-if="def.settingsComponent" #settings>
    <component :is="def.settingsComponent" />
  </template>
</WidgetCard>
```

- [ ] **Step 4: Typecheck + manual: hover Clock → gear → change settings → persist after reload**

---

### Task 5: Pomodoro migration onto shared shell

**Files:**
- Create: `src/widgets/usePomodoroState.ts`
- Create: `src/widgets/PomodoroSettings.vue`
- Modify: `src/widgets/PomodoroWidget.vue`
- Modify: `src/widgets/registry.ts`

- [ ] **Step 1: Move reactive timer/settings state from `PomodoroWidget.vue` into `usePomodoroState.ts`**

Singleton exporting: `settings`, `phase`, `completedFocusSessions`, `remainingMs`, `running`, `draftFocus/Short/Long`, `showSettings` (optional/unused), computed helpers needed by UI, and methods: `start`, `stop`, `reset`, `toggleRun`, `openSettings`, `saveSettings`, plus mount/unmount tick lifecycle.

Keep behavior identical to current widget (deadline tick, beep, persist watch).

- [ ] **Step 2: `PomodoroSettings.vue`** — labels + inputs + Save using `usePomodoroState()`; call `openSettings()` on mount so drafts sync when popover opens… Better: WidgetCard cannot call openSettings. Instead sync drafts when the settings component is mounted (`onMounted(() => openSettings())`) or expose `syncDrafts()` called from `onMounted` of PomodoroSettings.

- [ ] **Step 3: Slim `PomodoroWidget.vue`** — remove gear, settings panel, private settings CSS; use composable for body UI only.

- [ ] **Step 4: Registry** — `settingsComponent: PomodoroSettings`

- [ ] **Step 5: Typecheck + manual: Pomodoro gear from card, Save still works, timer unchanged**

---

### Task 6: Final verification

- [ ] **Step 1:** `npx vue-tsc --noEmit` — PASS
- [ ] **Step 2:** Manual checklist from spec (gear visibility, clock options, pomodoro save, drag vs gear, Escape/outside close)
