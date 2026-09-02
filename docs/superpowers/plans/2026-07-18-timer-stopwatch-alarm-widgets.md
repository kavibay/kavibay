# Timer, Stopwatch, Alarm Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three independent client-side overlay widgets — Timer, Stopwatch, Alarm — with clean digital UI and ringing+Dismiss completion.

**Architecture:** One Vue widget + pure logic module + per-instance composable per type (Pomodoro pattern). Reuse `playSessionEndBeep`. Parent session wires `registry.ts` + `WidgetHost.vue` after the three widget stacks land so parallel agents do not conflict.

**Tech Stack:** Vue 3 + TypeScript, Tauri overlay frontend, `localStorage`, Web Audio beep

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-timer-stopwatch-alarm-widgets-design.md`
- Client-only; no Rust / `backendCommand` / OS notifications
- Clean digital UI (no progress ring)
- Mounted-only (unmount pauses; no retro-fire)
- Beep + ringing until Dismiss (Timer complete, Alarm fire)
- Match existing patterns: inject `widgetInstanceId`, comment new methods, tabular nums, dark card buttons like Pomodoro pills
- Do **not** edit `registry.ts` or `WidgetHost.vue` in Tasks 1–3 (Task 4 / parent only)
- Do **not** modify Pomodoro behavior beyond importing `playSessionEndBeep`
- Commit only if the user/parent asks; otherwise leave changes unstaged

---

### Task 1: Timer widget stack

**Files (create only):**
- `src/widgets/timerLogic.ts`
- `src/widgets/useTimerState.ts`
- `src/widgets/TimerWidget.vue`

**Own these paths exclusively. Do not touch Stopwatch/Alarm files or registry/host.**

- [ ] **Step 1: Pure logic** — types, defaults, load/save `kavibay:timer:<instanceId>`, format remaining (`MM:SS` / `H:MM:SS`), parse custom duration, clamp min 1s, fixed presets `[1,5,10,15,25]` minutes
- [ ] **Step 2: Composable** — cache by `instanceId`; deadline + ~250ms tick; start/pause/reset; selectPreset/setCustom; on zero → beep + `ringing`; `dismiss()` → Ready with last duration; export `disposeTimerState`, `seedTimerStateFrom`, `clearTimerState`, optional `suspendTimerState`
- [ ] **Step 3: UI** — large time, preset chips, custom control, Start/Pause/Reset, ringing + Dismiss; inject `widgetInstanceId`; `defineProps<WidgetProps>()`
- [ ] **Step 4: Verify** — `npx --yes tsx` smoke assertions on format/parse/clamp; self-check UI states mentally

---

### Task 2: Stopwatch widget stack

**Files (create only):**
- `src/widgets/stopwatchLogic.ts`
- `src/widgets/useStopwatchState.ts`
- `src/widgets/StopwatchWidget.vue`

**Own these paths exclusively. Do not touch Timer/Alarm files or registry/host.**

- [ ] **Step 1: Pure logic** — format elapsed (`MM:SS.cs`, hours when needed); lap entry type `{ id, atMs, splitMs }` helpers
- [ ] **Step 2: Composable** — cache by `instanceId`; running accumulation; start/pause/lap/reset; ~50–100ms tick while running; no localStorage; export dispose/seed (seed = reset target to zero) for host symmetry
- [ ] **Step 3: UI** — large time, Start/Pause, Lap (enabled only while running), Reset, newest-first lap list
- [ ] **Step 4: Verify** — tsx smoke on format helpers

---

### Task 3: Alarm widget stack

**Files (create only):**
- `src/widgets/alarmLogic.ts`
- `src/widgets/useAlarmState.ts`
- `src/widgets/AlarmWidget.vue`

**Own these paths exclusively. Do not touch Timer/Stopwatch files or registry/host.**

- [ ] **Step 1: Pure logic** — `AlarmItem { id, hours, minutes, enabled, label }`; load/save `kavibay:alarm:<instanceId>`; format `HH:MM`; helpers for add default, shouldFire(now, alarm, lastFiredKey)
- [ ] **Step 2: Composable** — cache by instance; 1s tick while mounted; fire once per alarm per local calendar minute; beep + per-alarm ringing; dismiss; CRUD + toggle; export dispose/seed/clear/suspend
- [ ] **Step 3: UI** — list rows (time, label, enable), Add, inline edit, ringing row + Dismiss
- [ ] **Step 4: Verify** — tsx smoke on shouldFire / persistence normalize

---

### Task 4: Register + host wiring (parent / sequential)

**Files:**
- Modify: `src/widgets/registry.ts`
- Modify: `src/widgets/WidgetHost.vue`

- [ ] Import components + register `timer`, `stopwatch`, `alarm` with non-overlapping default offsets on the right stack
- [ ] Wire Duplicate seed + Remove dispose/clear (+ soft-hide suspend if composables export it)
- [ ] Manual smoke: add all three from launcher; exercise happy paths from spec Verification

---

## Parallel execution note

Tasks 1–3 are independent and should run as **three separate subagents in parallel**. Task 4 runs after all three complete.
