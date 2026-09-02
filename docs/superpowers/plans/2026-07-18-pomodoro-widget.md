# Pomodoro Timer Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side Pomodoro widget (circular progress ring, adjustable times, classic 4-session cycle, end beep) inside the existing dark `WidgetCard`.

**Architecture:** Pure timer/phase helpers in `pomodoroLogic.ts`; short Web Audio beep in `pomodoroSound.ts`; UI + reactive state in `PomodoroWidget.vue`; register in `registry.ts` with no `backendCommand` (same client-only path as `ClockWidget`). No `WidgetHost` / `WidgetCard` changes (approach 2).

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 overlay (no new dependencies).

## Global Constraints

- Client-side only — widgets must not call `invoke()`; no `backendCommand` on this registry entry
- Persist settings/phase/session count under `localStorage` key `kavibay:pomodoro-v1`; do not persist live countdown
- Session end: advance phase, play beep, set `running = false` (manual Start for next phase)
- Invalid minutes clamp to minimum `1`
- Visual approach 2: live inside existing dark `WidgetCard` titled `Pomodoro`
- No git repository in this workspace — skip all commit steps
- No test runner in the project — verify with `npx vue-tsc --noEmit` and manual UI checks

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/pomodoroLogic.ts` | Types, defaults, clamp, phase advance, duration lookup, persist load/save, `MM:SS` format |
| `src/widgets/pomodoroSound.ts` | One-shot Web Audio beep |
| `src/widgets/PomodoroWidget.vue` | UI, timer loop, settings panel, wires logic + sound |
| `src/widgets/registry.ts` | Add `pomodoro` entry |

---

### Task 1: Pure pomodoro logic module

**Files:**
- Create: `src/widgets/pomodoroLogic.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type PomodoroPhase = "focus" | "shortBreak" | "longBreak"`
  - `export interface PomodoroSettings { focusMinutes: number; shortBreakMinutes: number; longBreakMinutes: number }`
  - `export interface PomodoroPersisted { settings: PomodoroSettings; phase: PomodoroPhase; completedFocusSessions: number }`
  - `export const POMODORO_STORAGE_KEY = "kavibay:pomodoro-v1"`
  - `export const DEFAULT_SETTINGS: PomodoroSettings`
  - `export function clampMinutes(value: unknown): number`
  - `export function durationMs(phase: PomodoroPhase, settings: PomodoroSettings): number`
  - `export function advanceAfterComplete(phase: PomodoroPhase, completedFocusSessions: number): { phase: PomodoroPhase; completedFocusSessions: number }`
  - `export function formatMmSs(ms: number): string`
  - `export function loadPersisted(): PomodoroPersisted`
  - `export function savePersisted(state: PomodoroPersisted): void`
  - `export function phaseLabel(phase: PomodoroPhase): string`

- [ ] **Step 1: Create `src/widgets/pomodoroLogic.ts`**

```ts
export type PomodoroPhase = "focus" | "shortBreak" | "longBreak";

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
}

export interface PomodoroPersisted {
  settings: PomodoroSettings;
  phase: PomodoroPhase;
  completedFocusSessions: number;
}

export const POMODORO_STORAGE_KEY = "kavibay:pomodoro-v1";

export const DEFAULT_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
};

/** Clamp raw input to a whole number of minutes, minimum 1. */
export function clampMinutes(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.round(n));
}

/** Duration in ms for the given phase using current settings. */
export function durationMs(phase: PomodoroPhase, settings: PomodoroSettings): number {
  const minutes =
    phase === "focus"
      ? settings.focusMinutes
      : phase === "shortBreak"
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes;
  return clampMinutes(minutes) * 60_000;
}

/**
 * After a phase hits zero: next phase + updated focus-session count.
 * 4th completed Focus → longBreak and reset count to 0.
 */
export function advanceAfterComplete(
  phase: PomodoroPhase,
  completedFocusSessions: number,
): { phase: PomodoroPhase; completedFocusSessions: number } {
  if (phase === "focus") {
    const next = completedFocusSessions + 1;
    if (next >= 4) {
      return { phase: "longBreak", completedFocusSessions: 0 };
    }
    return { phase: "shortBreak", completedFocusSessions: next };
  }
  return { phase: "focus", completedFocusSessions };
}

/** Format remaining ms as MM:SS (floored, never negative). */
export function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function phaseLabel(phase: PomodoroPhase): string {
  if (phase === "focus") return "Focus";
  if (phase === "shortBreak") return "Break";
  return "Long Break";
}

function normalizePersisted(raw: Partial<PomodoroPersisted> | null): PomodoroPersisted {
  const settings = raw?.settings ?? DEFAULT_SETTINGS;
  return {
    settings: {
      focusMinutes: clampMinutes(settings.focusMinutes ?? DEFAULT_SETTINGS.focusMinutes),
      shortBreakMinutes: clampMinutes(
        settings.shortBreakMinutes ?? DEFAULT_SETTINGS.shortBreakMinutes,
      ),
      longBreakMinutes: clampMinutes(
        settings.longBreakMinutes ?? DEFAULT_SETTINGS.longBreakMinutes,
      ),
    },
    phase:
      raw?.phase === "shortBreak" || raw?.phase === "longBreak" || raw?.phase === "focus"
        ? raw.phase
        : "focus",
    completedFocusSessions: Math.min(
      4,
      Math.max(0, Math.round(Number(raw?.completedFocusSessions) || 0)),
    ),
  };
}

/** Load persisted pomodoro state; falls back to defaults. */
export function loadPersisted(): PomodoroPersisted {
  try {
    const raw = JSON.parse(localStorage.getItem(POMODORO_STORAGE_KEY) ?? "null");
    return normalizePersisted(raw);
  } catch {
    return normalizePersisted(null);
  }
}

/** Persist settings, phase, and session count (not the live countdown). */
export function savePersisted(state: PomodoroPersisted): void {
  const normalized = normalizePersisted(state);
  localStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(normalized));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`
Expected: exit 0 (or only pre-existing errors unrelated to this file)

- [ ] **Step 3: Skip commit** (no `.git` in workspace)

---

### Task 2: End-of-session beep

**Files:**
- Create: `src/widgets/pomodoroSound.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `export function playSessionEndBeep(): void`

- [ ] **Step 1: Create `src/widgets/pomodoroSound.ts`**

```ts
/** Short soft beep via Web Audio (no asset file). Safe no-op if AudioContext unavailable. */
export function playSessionEndBeep(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);

    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.start(t);
    osc.stop(t + 0.35);
    osc.onended = () => void ctx.close();
  } catch {
    // Ignore autoplay / AudioContext failures in overlay context.
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`
Expected: exit 0 for this file

- [ ] **Step 3: Skip commit**

---

### Task 3: PomodoroWidget UI + timer

**Files:**
- Create: `src/widgets/PomodoroWidget.vue`

**Interfaces:**
- Consumes: all exports from Task 1 and `playSessionEndBeep` from Task 2; `WidgetProps` from `./types`
- Produces: default-export Vue SFC used by registry

- [ ] **Step 1: Create `src/widgets/PomodoroWidget.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { WidgetProps } from "./types";
import {
  type PomodoroPhase,
  type PomodoroSettings,
  DEFAULT_SETTINGS,
  advanceAfterComplete,
  durationMs,
  formatMmSs,
  loadPersisted,
  phaseLabel,
  savePersisted,
  clampMinutes,
} from "./pomodoroLogic";
import { playSessionEndBeep } from "./pomodoroSound";

// Client-only widget (same contract pattern as ClockWidget).
defineProps<WidgetProps>();

const settings = ref<PomodoroSettings>({ ...DEFAULT_SETTINGS });
const phase = ref<PomodoroPhase>("focus");
const completedFocusSessions = ref(0);
const remainingMs = ref(durationMs("focus", DEFAULT_SETTINGS));
const running = ref(false);
const showSettings = ref(false);

// Draft values for the settings form (applied on Save).
const draftFocus = ref(25);
const draftShort = ref(5);
const draftLong = ref(15);

let deadlineAt: number | null = null;
let tickTimer: ReturnType<typeof setInterval> | undefined;

const displayTime = computed(() => formatMmSs(remainingMs.value));
const label = computed(() => phaseLabel(phase.value));
const statusText = computed(() => {
  if (running.value) return "Running…";
  if (remainingMs.value < durationMs(phase.value, settings.value)) return "Paused";
  return "Ready";
});

const progress = computed(() => {
  const total = durationMs(phase.value, settings.value);
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, remainingMs.value / total));
});

const accent = computed(() => {
  if (phase.value === "focus") return "#e07a5f";
  if (phase.value === "shortBreak") return "#5fad8c";
  return "#6b8cae";
});

/** SVG ring: circumference for r=54. */
const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;
const ringOffset = computed(() => RING_C * (1 - progress.value));

function persist() {
  savePersisted({
    settings: settings.value,
    phase: phase.value,
    completedFocusSessions: completedFocusSessions.value,
  });
}

function clearTick() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = undefined;
  }
}

function onTick() {
  if (deadlineAt == null) return;
  remainingMs.value = Math.max(0, deadlineAt - Date.now());
  if (remainingMs.value > 0) return;

  clearTick();
  deadlineAt = null;
  running.value = false;

  const next = advanceAfterComplete(phase.value, completedFocusSessions.value);
  phase.value = next.phase;
  completedFocusSessions.value = next.completedFocusSessions;
  remainingMs.value = durationMs(phase.value, settings.value);
  persist();
  playSessionEndBeep();
}

function start() {
  if (running.value) return;
  if (remainingMs.value <= 0) {
    remainingMs.value = durationMs(phase.value, settings.value);
  }
  deadlineAt = Date.now() + remainingMs.value;
  running.value = true;
  clearTick();
  tickTimer = setInterval(onTick, 250);
}

function stop() {
  if (!running.value) return;
  if (deadlineAt != null) {
    remainingMs.value = Math.max(0, deadlineAt - Date.now());
  }
  deadlineAt = null;
  running.value = false;
  clearTick();
}

function reset() {
  stop();
  phase.value = "focus";
  remainingMs.value = durationMs("focus", settings.value);
  persist();
}

function toggleRun() {
  if (running.value) stop();
  else start();
}

function openSettings() {
  draftFocus.value = settings.value.focusMinutes;
  draftShort.value = settings.value.shortBreakMinutes;
  draftLong.value = settings.value.longBreakMinutes;
  showSettings.value = true;
}

function saveSettings() {
  settings.value = {
    focusMinutes: clampMinutes(draftFocus.value),
    shortBreakMinutes: clampMinutes(draftShort.value),
    longBreakMinutes: clampMinutes(draftLong.value),
  };
  showSettings.value = false;
  // Apply new duration only when not mid-run (spec: next Start/Reset).
  if (!running.value) {
    remainingMs.value = durationMs(phase.value, settings.value);
  }
  persist();
}

onMounted(() => {
  const saved = loadPersisted();
  settings.value = saved.settings;
  phase.value = saved.phase;
  completedFocusSessions.value = saved.completedFocusSessions;
  remainingMs.value = durationMs(phase.value, settings.value);
});

onUnmounted(() => {
  clearTick();
});

watch([phase, completedFocusSessions, settings], () => persist(), { deep: true });
</script>

<template>
  <div class="pomodoro" :style="{ '--accent': accent }">
    <button
      type="button"
      class="pomodoro-gear"
      title="Settings"
      aria-label="Settings"
      @pointerdown.stop
      @click.stop="showSettings ? (showSettings = false) : openSettings()"
    >
      ⚙
    </button>

    <div v-if="showSettings" class="pomodoro-settings" @pointerdown.stop>
      <label>
        Focus
        <input v-model.number="draftFocus" type="number" min="1" />
      </label>
      <label>
        Short break
        <input v-model.number="draftShort" type="number" min="1" />
      </label>
      <label>
        Long break
        <input v-model.number="draftLong" type="number" min="1" />
      </label>
      <button type="button" class="pomodoro-btn pomodoro-btn--accent" @click="saveSettings">
        Save
      </button>
    </div>

    <template v-else>
      <div class="pomodoro-ring-wrap">
        <svg class="pomodoro-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="pomodoro-ring-track" cx="60" cy="60" :r="RING_R" />
          <circle
            class="pomodoro-ring-progress"
            cx="60"
            cy="60"
            :r="RING_R"
            :stroke-dasharray="RING_C"
            :stroke-dashoffset="ringOffset"
          />
          <!-- Tick marks -->
          <g class="pomodoro-ticks">
            <line
              v-for="i in 60"
              :key="i"
              :x1="60"
              :y1="i % 5 === 0 ? 12 : 14"
              :x2="60"
              :y2="i % 5 === 0 ? 18 : 16"
              :transform="`rotate(${(i - 1) * 6} 60 60)`"
            />
          </g>
        </svg>
        <div class="pomodoro-center">
          <p class="pomodoro-phase">{{ label }}</p>
          <p class="pomodoro-time">{{ displayTime }}</p>
          <p class="pomodoro-status">{{ statusText }}</p>
        </div>
      </div>

      <div class="pomodoro-dots" aria-label="Focus sessions">
        <span
          v-for="i in 4"
          :key="i"
          class="pomodoro-dot"
          :class="{ 'pomodoro-dot--on': i <= completedFocusSessions }"
        />
      </div>

      <div class="pomodoro-actions" @pointerdown.stop>
        <button
          type="button"
          class="pomodoro-btn pomodoro-btn--accent"
          @click="toggleRun"
        >
          {{ running ? "Stop" : "Start" }}
        </button>
        <button type="button" class="pomodoro-btn pomodoro-btn--ghost" @click="reset">
          Reset
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pomodoro {
  position: relative;
  width: 200px;
  color: rgba(255, 255, 255, 0.92);
}

.pomodoro-gear {
  position: absolute;
  top: -2px;
  right: -2px;
  z-index: 1;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  font-size: 16px;
  cursor: pointer;
}

.pomodoro-gear:hover {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.06);
}

.pomodoro-ring-wrap {
  position: relative;
  width: 180px;
  height: 180px;
  margin: 8px auto 0;
}

.pomodoro-ring {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.pomodoro-ring-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 8;
}

.pomodoro-ring-progress {
  fill: none;
  stroke: var(--accent, #e07a5f);
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s linear;
}

.pomodoro-ticks {
  transform: rotate(90deg);
  transform-origin: 60px 60px;
}

.pomodoro-ticks line {
  stroke: rgba(255, 255, 255, 0.22);
  stroke-width: 1;
}

.pomodoro-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none;
}

.pomodoro-phase {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.pomodoro-time {
  margin: 4px 0 0;
  font-size: 32px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  line-height: 1.1;
}

.pomodoro-status {
  margin: 6px 0 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.pomodoro-dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin: 12px 0 14px;
}

.pomodoro-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
}

.pomodoro-dot--on {
  background: var(--accent, #e07a5f);
}

.pomodoro-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pomodoro-btn {
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.pomodoro-btn--accent {
  background: var(--accent, #e07a5f);
  color: #fff;
}

.pomodoro-btn--ghost {
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
}

.pomodoro-btn--ghost:hover {
  color: rgba(255, 255, 255, 0.9);
}

.pomodoro-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 28px;
}

.pomodoro-settings label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
}

.pomodoro-settings input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 255, 255, 0.92);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
</style>
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Skip commit**

---

### Task 4: Register widget

**Files:**
- Modify: `src/widgets/registry.ts`

**Interfaces:**
- Consumes: `PomodoroWidget` default export from Task 3
- Produces: registry entry `id: "pomodoro"`

- [ ] **Step 1: Update `src/widgets/registry.ts`**

Add import and registry entry. Full file after edit:

```ts
import type { WidgetDefinition } from "./types";
import ClockWidget from "./ClockWidget.vue";
import SystemInfoWidget from "./SystemInfoWidget.vue";
import WeatherWidget from "./WeatherWidget.vue";
import PomodoroWidget from "./PomodoroWidget.vue";

/**
 * Zentrale Widget-Registry (V1, statisch). Später ersetzbar durch Einträge, die aus
 * Plugin-Manifest-Dateien geladen werden — WidgetHost.vue und die Widgets selbst
 * bleiben dabei unverändert (siehe PLAN.md §3).
 */
export const widgetRegistry: WidgetDefinition[] = [
  {
    id: "clock",
    title: "Clock",
    // Offset Mittelpunkt-zu-Mittelpunkt relativ zur Palette (~640px breit): rechts oben.
    position: { x: 480, y: -70 },
    component: ClockWidget,
  },
  {
    id: "weather",
    title: "Weather",
    position: { x: -480, y: -70 },
    component: WeatherWidget,
    backendCommand: "widget_weather",
    refreshInterval: 60000,
  },
  {
    id: "system-info",
    title: "System Info",
    position: { x: -480, y: 130 },
    component: SystemInfoWidget,
    backendCommand: "widget_system_info",
    refreshInterval: 5000,
  },
  {
    id: "pomodoro",
    title: "Pomodoro",
    // Rechts unter der Clock (Mittelpunkt-Offsets).
    position: { x: 480, y: 200 },
    component: PomodoroWidget,
  },
];
```

- [ ] **Step 2: Typecheck + build**

Run: `npx vue-tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Manual verification**

Run app (`npm run tauri dev` or existing dev flow). Confirm:

1. Pomodoro card visible near Clock
2. Start / Stop / Reset work
3. Gear → change minutes → Save → Reset uses new Focus duration
4. With 1-minute settings, complete 4 Focus sessions → Long Break; beep on each session end; timer stops until Start
5. Reload app: settings/phase/session count restored; countdown shows full phase duration (Ready)

- [ ] **Step 4: Skip commit**

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Adjustable Focus / Short / Long | Task 3 settings panel + Task 1 clamp |
| Classic 4 → long break | Task 1 `advanceAfterComplete` |
| Start / Stop / Reset / Gear | Task 3 |
| End: phase change + beep + stop | Task 3 `onTick` + Task 2 |
| Circular ring, ticks, labels, dots, pill | Task 3 template/styles |
| Dark WidgetCard, title Pomodoro | Task 4 (host wraps card) |
| localStorage `kavibay:pomodoro-v1` | Task 1 load/save |
| No countdown persist | Task 3 `onMounted` resets remaining from duration |
| No backend / no Host changes | Tasks 1–4 |
| Approach 1 later | Out of scope (noted in spec) |
