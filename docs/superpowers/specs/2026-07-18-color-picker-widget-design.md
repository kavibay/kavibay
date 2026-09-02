# Color Picker Widget — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** Rust pick-session with live sample events (approach 1)

## Goal

Add a screen eyedropper widget to the Kavibay overlay: start Pick, sample the desktop pixel under the cursor while moving, show a large live swatch plus CSS color values, confirm with click, copy Hex by default (RGB/HSL also copyable).

## Requirements

### Behavior

- Registry widget `color-picker`, title “Color Picker”, inside existing `WidgetCard`
- Idle: large swatch of last fixed color (initial `#000000`), Hex / RGB / HSL values
- Primary **Copy** always copies Hex; click on RGB or HSL row copies that format
- **Pick** starts a backend pick session; live swatch + values update from sample events
- **Left click** fixes the current sample and ends the session
- **Escape** or widget **Cancel** aborts; keep previously fixed color
- No magnifier, no history, no alpha, no settings in V1

### Formats (CSS-relevant)

| Format | Example | Notes |
|--------|---------|--------|
| Hex (default) | `#1A2B3C` | Uppercase hex, no alpha |
| RGB | `rgb(26, 43, 60)` | Integer channels 0–255 |
| HSL | `hsl(210, 40%, 17%)` | H integer degrees; S/L rounded percent |

### Visual

- Large color swatch as the main preview (live while picking, fixed otherwise)
- Hex row visually primary; RGB/HSL secondary
- Brief “Copied” feedback (~1s) on Copy or on the clicked format row
- Match existing dark glass `WidgetCard` chrome; no custom chrome

### Out of scope

- Magnifier / zoom loupe
- Color history
- Alpha / `rgba` / `oklch`
- Settings UI
- Multi-monitor special UI (sampling uses global cursor; no extra chrome)

## Architecture

### Approach

While Pick is active, a short-lived Rust background thread polls the global cursor, samples one desktop pixel (excluding or briefly hiding the Kavibay window so the overlay does not taint the sample), and emits RGB to the frontend. Click-through stays enabled so the desktop remains usable; confirm/cancel are detected in Rust (left-button rising edge, Escape), not via Webview mouse capture over the full screen.

### Backend (Rust)

| Piece | Role |
|-------|------|
| `color_picker_start` | Begin pick session (idempotent: stop previous, then start) |
| `color_picker_stop` | End session without fixing (cancel) |
| Pick thread | ~30–60 Hz: cursor → sample → emit; detect LMB rising edge / Escape |
| `color-picker:sample` | Event `{ r, g, b }` for live UI |
| `color-picker:picked` | Event `{ r, g, b }` on confirm; session ends |
| `color-picker:cancelled` | Event when aborted; session ends |

Sampling strategy (Windows-first, matches current Kavibay target): read the pixel at the physical cursor position from the desktop DC / equivalent, ensuring the Kavibay layered window is not the sampled surface (hide briefly or exclude HWND). Prefer a stable 1×1 sample over full screenshots.

Left-click: use rising-edge detection (`GetAsyncKeyState` or equivalent) so holding the button from before Pick does not immediately confirm.

### Frontend

| File | Role |
|------|------|
| `src/widgets/ColorPickerWidget.vue` | UI: swatch, formats, Copy / Pick / Cancel; listen to events |
| `src/widgets/colorPickerLogic.ts` | Pure helpers: RGB↔Hex/HSL, CSS string builders, copy helper |
| `src/widgets/registry.ts` | Register `color-picker` (no `backendCommand` / `refreshInterval`) |
| `src-tauri/src/commands.rs` (and/or `color_picker.rs`) | Start/stop + session state |
| `src-tauri/src/lib.rs` | Register commands; wire emit |

Widget contract: standard `WidgetProps` unused for polling; Pick uses `invoke` + Tauri events only while active. On unmount, call `color_picker_stop` if still picking.

Browser-only Vite tab (no Tauri): Pick disabled or no-op with inline “Pick unavailable”; format/copy UI still works with the fixed color.

### State (frontend)

- `fixed: { r, g, b }` — last confirmed color
- `live: { r, g, b } | null` — current sample while picking
- `picking: boolean`
- Display color = `live ?? fixed`
- Ephemeral `copiedKey: 'hex' | 'rgb' | 'hsl' | null` for feedback

### Click-through interaction

- Do **not** pause click-through for the whole screen during Pick
- Existing interactive rects for the widget card remain so the user can press Cancel / Copy
- Confirm/cancel input handled in Rust globally for LMB / Escape
- **LMB confirm is ignored while the cursor is over any interactive Kavibay rect** (widget card, palette, etc.), so Cancel / Copy / Pick clicks do not accidentally fix a color. Confirm only when the click lands on the desktop / other apps. Widget **Cancel** calls `color_picker_stop` (emits `color-picker:cancelled`).

## Error handling

- Sample failure on a tick: keep last good live sample; do not spam UI
- Start failure: show inline “Pick unavailable”, leave `picking = false`
- Double start: stop then restart
- Stop when already idle: no-op

## Testing

### Unit

- RGB → `#RRGGBB`
- RGB → HSL and `hsl(...)` string
- `rgb(...)` string formatting

### Manual

- Pick color from desktop wallpaper, browser chrome, and another app window
- Escape cancels; previous fixed color retained
- Click confirms; Copy pastes Hex; RGB/HSL row clicks paste those strings
- Other widgets still click-through correctly after Pick ends
- Cancel button ends session without changing fixed color

## Success criteria

1. User can Pick a screen color with live swatch feedback and confirm by click
2. Hex is one-click via Copy; RGB and HSL are copyable from their rows
3. Escape / Cancel abort cleanly; overlay click-through remains healthy after Pick
