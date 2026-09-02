# App Settings Modal + Appearance Fonts — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Lightweight glass modal opened from the command palette; Appearance section with three live-applied global fonts

## Goal

Add a main app Settings surface opened from the searchbar/command palette. First section is Appearance: the user can switch between three curated typefaces. The chosen font applies immediately to the command palette and every widget.

## Requirements

### Opening & closing

- New palette command `open-settings` with title `Settings` and keywords including `settings`, `appearance`, `fonts`
- On select: do **not** hide the Kavibay window; close/clear the palette UI and open the Settings modal
- Modal is a separate centered glass panel (palette closes — option A)
- Close via: ✕ button, click outside (backdrop), Escape
- Escape closes Settings first; only hides the Kavibay window when Settings is already closed
- Modal and backdrop are `data-interactive`; click-through is paused while Settings is open

### Layout

- Approx. 720×480 centered modal, glass styling consistent with palette / widget cards
- Left sidebar (~200px): classic settings nav
  - First (and only V1) item: **Appearance** (active state)
- Right content: section title + controls for the active nav item

### Appearance — fonts

Exactly three selectable font styles (live-apply, no Save button):

| ID | Display name | Stack |
|----|--------------|-------|
| `jakarta` | Plus Jakarta Sans | `"Plus Jakarta Sans", system-ui, sans-serif` |
| `manrope` | Manrope | `"Manrope", system-ui, sans-serif` |
| `jetbrains` | JetBrains Mono | `"JetBrains Mono", ui-monospace, monospace` |

- Default: `jakarta`
- UI: three selectable cards with name + short sample text (e.g. `14:32 · Focus session`)
- Active card visually highlighted
- Persist under `localStorage` key `kavibay:appearance-v1` as `{ "fontId": "jakarta" | "manrope" | "jetbrains" }`
- Invalid / missing storage → fall back to `jakarta`

### Global application

- Load Google Fonts once (Plus Jakarta Sans, Manrope, JetBrains Mono)
- On change and on boot: set CSS variable `--font-family` on `document.documentElement` (and optional `data-font` attribute for debugging)
- `styles.css` body (and any root text) uses `font-family: var(--font-family, <system fallback>)`
- Widgets and palette inherit; no per-widget font wiring required

### Out of scope

- Additional settings sections (theme, shortcuts, etc.) beyond Appearance nav stub
- Dark/light theme toggle (palette stub `toggle-dark-mode` unchanged)
- Per-widget font overrides
- Custom user-uploaded fonts
- Settings search / keyboard nav within the modal beyond Esc / click

## Architecture

### Approach

**Lightweight modal + Appearance composable** mirroring Clock settings patterns (pure logic module + composable + localStorage). Rejected: full settings router/store (overkill for one section); embedding Settings inside the palette (conflicts with open behavior A).

### Data flow

```text
CommandPalette (open-settings)
  → open SettingsModal (window stays visible)
       ├─ left: nav [ Appearance ]
       └─ right: AppearancePanel
            → useAppearance().setFont(id)
                 → appearanceLogic save
                 → documentElement --font-family
                      → styles.css / all widgets inherit
```

Boot path:

```text
App mount → useAppearance() load + apply
```

### Files

| File | Role |
|------|------|
| `src/palette/commands.ts` | Add `open-settings` command |
| `src/palette/CommandPalette.vue` | Branch: on `open-settings`, open modal instead of hide + invoke |
| `src/settings/appearanceLogic.ts` | Font catalog, normalize, load/save |
| `src/settings/useAppearance.ts` | Shared reactive state + DOM apply |
| `src/settings/SettingsModal.vue` | Shell: backdrop, sidebar nav, content slot/switch |
| `src/settings/AppearancePanel.vue` | Three font cards, live selection |
| `src/App.vue` | Mount SettingsModal; Esc precedence; boot appearance |
| `src/styles.css` | `--font-family` on body; font import or link |
| `src/main.ts` | Optional early appearance apply before mount |

### Error handling

- Corrupt localStorage JSON → ignore and use default
- Unknown `fontId` → default `jakarta`
- Font CDN failure → stacks still fall back to system-ui / monospace

### Testing notes

- Selecting each font updates `--font-family` and persists after reload
- Palette command opens modal without hiding the window
- Esc closes modal before hiding the app
- Widget text (Clock, Pomodoro, etc.) reflects the active font without per-widget changes

## Success criteria

1. User can open Settings from the command palette
2. Appearance shows three fonts; selection applies live to all widgets and the palette
3. Choice survives app restart via `kavibay:appearance-v1`
4. Closing Settings does not require quitting the overlay; Esc hierarchy is correct
