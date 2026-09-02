# Pomodoro Timer Widget — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Ring inside existing `WidgetCard` (approach 2); optional later upgrade to custom chrome (approach 1)

## Goal

Add a client-side Pomodoro timer widget to the Kavibay overlay that looks close to the reference screenshot (circular coral progress ring, large `MM:SS`, phase label, Start/Stop pill) while staying inside the existing dark glass `WidgetCard` chrome used by Clock / Weather / System Info.

## Requirements

### Behavior

- Adjustable durations: Focus, Short break, Long break (minutes)
- Classic cycle: after 4 completed Focus sessions → Long break; then session counter resets to 0
- Controls: Start / Stop, Reset, Settings (gear)
- Session end: switch to next phase, play a short beep, set `running = false` (manual start for next phase)
- No system notifications, no project list, no fullscreen expand

### Visual

- Circular progress ring (coral for Focus; muted teal/green for Short break; cooler blue for Long break)
- Inner tick marks; large tabular `MM:SS`; phase label; status text (`Running…` / `Paused` / `Ready`)
- Four session dots under the ring
- Coral (or phase-colored) pill Start/Stop button; small Reset control
- Gear opens inline settings for the three minute values
- Lives inside existing dark `WidgetCard` titled “Pomodoro”

### Out of scope (for now)

- Skipping `WidgetCard` / custom light chrome (approach 1) — revisit after approach 2
- Backend commands, OS notifications, project tracking, sound asset files

## Architecture

### Files

| File | Role |
|------|------|
| `src/widgets/PomodoroWidget.vue` | UI + timer state (client-side, like `ClockWidget`) |
| `src/widgets/registry.ts` | Register `pomodoro` (no `backendCommand`) |
| `src/widgets/pomodoroSound.ts` (optional) | Short Web Audio beep, no asset file |

No changes to `WidgetHost.vue` or `WidgetCard.vue` for approach 2.

### Widget contract

- Receives standard `WidgetProps` (unused for data loading; proves client-only path like Clock)
- Does not call `invoke()`

### State

- `phase`: `focus` \| `shortBreak` \| `longBreak`
- `remainingMs`, `running`
- `completedFocusSessions`: 0–4
- Settings: `focusMinutes`, `shortBreakMinutes`, `longBreakMinutes`

### Timer

- Prefer deadline timestamp + tick (`setInterval` ~250ms or `requestAnimationFrame`) to limit drift
- On reach 0: advance phase, beep, `running = false`
- Phase advance rules:
  - Focus complete → `completedFocusSessions += 1`. If `completedFocusSessions === 4` → enter `longBreak` and set `completedFocusSessions = 0`; else → enter `shortBreak`
  - Short break or Long break complete → enter `focus`
- Session dots show how many Focus sessions were completed in the current cycle (0–4). After the 4th Focus triggers Long break and resets the counter, dots are empty during Long break and the next cycle.

### Persistence

- Key: `kavibay:pomodoro-v1` in `localStorage`
- Persist: minute settings, `completedFocusSessions`, current `phase`
- Do **not** persist live countdown across app restart (always Ready with duration for current phase)

### Settings UX

- Gear toggles inline panel with three minute inputs
- Saving closes panel
- Changes apply on next Start/Reset, not mid-run

### Edge cases

- Empty / zero / invalid minutes → clamp to minimum 1
- Reset → Focus phase, `remainingMs` = focus duration, `running = false`; session dots unchanged
- Drag of widget still handled by `WidgetHost` (pointer on card)

## Layout / Registry

- Default offset relative to palette: e.g. right of palette below Clock (`x: 680, y: 140`) — exact values tunable after visual check
- Title: `Pomodoro`

## Verification

Manual:

1. Start → countdown runs; Stop pauses; Start resumes
2. Reset returns to Focus duration, stopped
3. Change settings; next Start uses new values
4. Complete 4 Focus sessions (can temporarily use 1-minute settings) → Long break
5. Session end plays beep and stops until Start
6. Widget draggable; no backend errors in console

## Later option (approach 1)

If the dark card feels wrong vs. the screenshot: add optional `chrome: "none"` (or similar) on `WidgetDefinition` so `WidgetHost` can skip `WidgetCard` and the widget owns a light custom shell. Same timer logic; only presentation wrapper changes.
