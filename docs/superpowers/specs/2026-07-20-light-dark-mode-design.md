# Light / Dark Color Mode — Design

**Date:** 2026-07-20  
**Status:** Approved for implementation planning  
**Approach:** Semantic CSS tokens driven by persisted `colorMode` on `documentElement`

## Goal

Add a manual Light / Dark appearance mode. Dark keeps today’s look. Light uses frosted pale/white glass panels with dark text. Both modes must work across the command palette, Settings, and all first-party widgets.

## Requirements

### Preference

- Manual only (no OS / system follow)
- Values: `"dark" | "light"`
- Default: `"dark"` (existing users unchanged)
- Persist in existing `localStorage` key `kavibay:appearance-v1` as a new field `colorMode`
- Invalid / missing → `"dark"`

### Controls

- **Appearance settings:** Light / Dark segmented control (live-apply, no Save button), same pattern as corner shape / fonts
- **Palette command** `toggle-dark-mode`: flip between light and dark, persist, clear/close palette UI; keep Kavibay window visible (same open behavior family as `open-settings`)

### Visual

- **Dark:** current dark glass (`rgba(28, 28, 32, …)` panels, light text) — preserve as the dark token set
- **Light:** light frosted glass — pale/near-white translucent panels, dark text, dark borders/fills at low alpha (mirror of today’s white-on-dark overlays)
- Shared Appearance glass knobs (opacity, blur, radius, shadow strength, corner shape) remain mode-agnostic

## Architecture

### Approach

**Semantic CSS tokens + `data-color-mode` on `<html>`.** Rejected: large light-only override sheets (brittle); shell-only theming (widget interiors stay unreadable).

### Data flow

```text
AppearancePanel / toggle-dark-mode
  → useAppearance().setColorMode(mode) | toggleColorMode()
       → appearanceLogic save (kavibay:appearance-v1)
       → document.documentElement.dataset.colorMode = "dark" | "light"
            → styles.css token blocks
                 → shells + widgets consume var(--text), var(--surface-bg-rgb), …
```

Boot path:

```text
App mount → useAppearance() load + applyColorModeToDocument
```

### Token model

Define tokens under `[data-color-mode="dark"]` and `[data-color-mode="light"]` in `styles.css`. Minimum set:

| Token | Role |
|-------|------|
| `--surface-bg-rgb` | RGB triple for glass panel backgrounds (combined with `--surface-opacity`) |
| `--text` | Primary foreground |
| `--text-muted` | Secondary / labels |
| `--text-faint` | Placeholders / disabled |
| `--border` | Default hairline borders |
| `--border-strong` | Emphasized borders / focus rings |
| `--fill` | Subtle overlays (hover rows, chips) |
| `--fill-hover` | Stronger hover / active fills |
| `--inset-bg` | Recessed inputs / wells |
| `--shadow-rgb` | Drop-shadow RGB (multiplied by `--surface-shadow`) |
| `--scrollbar` | Scrollbar thumb color |

Exact light RGB values are chosen during implementation to read as frosted glass over the desktop, not opaque white cards.

### Migration

1. Add `colorMode` to `AppearanceState` + normalize / load / save / apply helpers
2. Wire `useAppearance` (`setColorMode`, `toggleColorMode`) and boot apply
3. Add token definitions in `styles.css`; set `body { color: var(--text) }`
4. Appearance panel control + palette handler for `toggle-dark-mode`
5. Migrate shared shells first: `WidgetCard`, `CommandPalette`, `SettingsModal`, shared menus
6. Sweep widget and settings scoped styles from hardcoded dark-glass rgba to tokens

Accent colors (status greens/reds, weather icons, etc.) stay as-is unless they become unreadable on light; then adjust only those cases.

### Files (expected)

| File | Role |
|------|------|
| `src/settings/appearanceLogic.ts` | `ColorMode` type, normalize, apply to DOM |
| `src/settings/useAppearance.ts` | Reactive `colorMode`, setters, persist |
| `src/settings/AppearancePanel.vue` | Light / Dark control |
| `src/styles.css` | Dark + light token blocks |
| `src/palette/CommandPalette.vue` | Handle `toggle-dark-mode` |
| `src/core/host/WidgetCard.vue` | Consume surface/text tokens |
| Widget / settings Vue SFCs | Replace hardcoded rgba with tokens |

## Out of scope

- System / auto theme preference
- Per-widget or per-surface theme overrides
- Separate glass opacity/blur defaults per mode
- Redesign of accent / brand colors beyond readability fixes
- Renaming or removing the palette command id `toggle-dark-mode`

## Error handling

- Corrupt appearance JSON → defaults (including `colorMode: "dark"`)
- Unknown `colorMode` string → `"dark"`
- Missing `data-color-mode` before boot apply → dark token block should also be the CSS fallback on `:root` / `html` so first paint stays dark

## Testing notes

- Switching in Appearance updates `data-color-mode` and persists after reload
- Toggle Dark Mode flips the same persisted value
- Palette, Settings modal, and a sample of widgets (Clock, Notes, Todo, App Launcher) are readable in light mode
- Dark mode still matches pre-change look for default users
- Glass opacity slider still affects panel translucency in both modes

## Success criteria

1. User can set Light or Dark in Settings → Appearance; choice survives restart
2. Palette **Toggle Dark Mode** flips the same setting
3. Palette, Settings, and widgets look correct in both modes (light = frosted pale glass + dark text)
4. Default remains dark for existing installs
