# Timer, Stopwatch, Alarm Widgets — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Three fully independent client-side widgets (approach 1)

## Goal

Add three separate everyday utility widgets to the Kavibay overlay — **Timer**, **Stopwatch**, and **Alarm** — with a clean digital look inside the existing dark glass `WidgetCard`. Mounted-only lifecycle (same as Pomodoro): activity pauses when the overlay or widget is unmounted.

## Requirements

### Shared

- Client-only Vue widgets; no `backendCommand`, no Rust changes, no OS notifications
- Clean digital UI: large tabular time, compact controls, **no** Pomodoro-style progress ring
- Completion feedback: short Web Audio beep (`playSessionEndBeep` from `pomodoroSound.ts`) plus in-widget **ringing** state until the user presses **Dismiss**
- Soft-hide / overlay hide unmounts the widget → timers stop; no catch-up or retro-fire when shown again
- Per-instance state via `instanceId` + `localStorage`; Duplicate/Remove seed and dispose like Clock/Pomodoro/Notes
- Keep existing Pomodoro widget unchanged

### Timer

- Preset chips (1 / 5 / 10 / 15 / 25 minutes) + custom duration (minutes or `mm:ss`)
- Controls: Start / Pause, Reset
- Display remaining as `MM:SS`, or `H:MM:SS` when ≥ 1 hour
- On zero: beep + ringing until Dismiss; Dismiss returns to Ready with last chosen duration
- Persist: last chosen duration (presets are fixed)

### Stopwatch

- Controls: Start / Pause, Lap (only while running), Reset
- Display elapsed as `MM:SS.cs` under 1 hour; include hours when needed
- Lap list under the time (newest on top); Reset clears elapsed and laps
- No persistence across restart (always `00:00.00`)
- No settings panel for V1

### Alarm

- Multiple alarms per instance: time of day, enable toggle, optional label
- Add creates a new row (default `08:00` or next round hour)
- Inline edit for time and label
- While mounted, 1s tick: when an enabled alarm’s local `HH:MM` matches and it has not already fired that calendar minute → beep + that row rings + Dismiss
- Dismiss clears ringing; alarm stays enabled for the next day
- Persist: full alarm list (id, time, enabled, label). Do not persist mid-ringing across restart
- No settings panel for V1

### Out of scope

- Background ticking while overlay closed
- Snooze, weekday repeats, sound options
- OS notifications / system tray
- Ring / Pomodoro visual language
- Merging with or replacing Pomodoro
- One multi-mode “Clock Tools” widget

## Architecture

### Pattern

Same as Clock / Pomodoro: client-only components receiving standard `WidgetProps` (unused for data loading). Deadline / tick logic lives in per-instance composables. No changes to `WidgetCard` chrome.

### Registry

Three new `WidgetDefinition` entries in `src/widgets/registry.ts`:

| id | title | backendCommand |
|----|--------|----------------|
| `timer` | Timer | none |
| `stopwatch` | Stopwatch | none |
| `alarm` | Alarm | none |

Default offsets: right stack near Clock / Pomodoro / Calculator (exact values chosen at implement time to avoid overlap).

### Files

| Area | Files |
|------|--------|
| Timer | `TimerWidget.vue`, `timerLogic.ts`, `useTimerState.ts` |
| Stopwatch | `StopwatchWidget.vue`, `stopwatchLogic.ts`, `useStopwatchState.ts` |
| Alarm | `AlarmWidget.vue`, `alarmLogic.ts`, `useAlarmState.ts` |
| Shared sound | Reuse `pomodoroSound.ts` (`playSessionEndBeep`) |
| Host | `WidgetHost.vue` — seed/dispose on Duplicate/Remove (and suspend on soft-hide if needed) |
| Registry | `registry.ts` — register all three |

### Timer engine

- **Timer:** deadline timestamp + `setInterval` (~250ms) while running (anti-drift, same idea as Pomodoro)
- **Stopwatch:** accumulate elapsed from start/pause anchors; ~50–100ms tick while running for centiseconds
- **Alarm:** compare local clock on ~1s tick while mounted; fire once per alarm per local calendar minute

### Persistence keys

- `kavibay:timer:<instanceId>` — last duration (ms or minutes+seconds)
- Stopwatch — none required
- `kavibay:alarm:<instanceId>` — `{ alarms: AlarmItem[] }`

### Host wiring

Mirror Pomodoro:

- `seed*From(fromId, toId)` on Duplicate
- `dispose*` + `clear*` on Remove
- Optional `suspend*` on soft-hide if running state should stop before unmount (unmount already stops ticks)

### UI vocabulary

- Primary actions: solid pills (Start / Dismiss)
- Secondary: ghost (Pause → shown as Start when paused, Reset, Lap)
- Ringing: stronger accent on time/row + visible Dismiss until acknowledged

## Edge cases

- Invalid / zero custom timer duration → clamp to minimum 1 second
- Timer Dismiss after ringing → Ready with last chosen duration selected, not left at 0
- Stopwatch Lap while paused → disabled / no-op
- Alarm while unmounted → does not fire; opening later does not retro-fire for a past minute
- Duplicate → independent storage keys and in-memory caches
- Remove → drop cache + `localStorage` key

## Verification

Manual:

1. Add Timer, Stopwatch, Alarm from launcher; each appears as its own card
2. Timer: presets, custom duration, pause/resume, complete → beep + Dismiss
3. Stopwatch: run, lap, pause, reset clears laps
4. Alarm: add/edit/toggle several; at matching minute while mounted → beep + Dismiss; stays enabled
5. Soft-hide or close overlay mid-run → activity stops; no missed-alarm catch-up
6. Duplicate / Remove behave like Pomodoro for per-instance state
7. No Rust/backend errors; Pomodoro unchanged

## Success criteria

- Three registry types, independently hideable/duplicable
- Scope B features as listed above
- Clean digital look inside `WidgetCard`
- Mounted-only; ringing + Dismiss on Timer complete and Alarm fire
