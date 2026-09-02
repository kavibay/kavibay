# Light / Dark Color Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual Light / Dark appearance so the overlay uses dark glass (current look) or light frosted glass with dark text, controlled from Appearance settings and the existing Toggle Dark Mode palette command.

**Architecture:** Persist `colorMode: "dark" | "light"` in `kavibay:appearance-v1`. Apply `data-color-mode` on `document.documentElement`. Define RGB base tokens plus semantic aliases in `styles.css`. Replace hardcoded dark-glass rgba triples across shells and widgets with those CSS variables (alphas stay).

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 overlay, existing `appearanceLogic` / `useAppearance` pattern. No new npm dependencies.

## Global Constraints

- Manual Light / Dark only — no OS / system preference
- Persist key: `kavibay:appearance-v1` → add `colorMode: "dark" | "light"`
- Default: `"dark"` (existing users unchanged)
- Live-apply (no Save button)
- Light look: pale frosted glass + dark text (mirror of today’s white-on-dark overlays)
- Glass opacity / blur / radius / shadow / corner shape stay mode-agnostic
- Accent colors (status greens/reds, etc.) stay unless unreadable on light
- Keep palette command id `toggle-dark-mode`
- Pure helpers: assert via `npx tsx src/settings/appearanceLogic.assert.ts`
- Typecheck: `npx vue-tsc --noEmit`
- Skip git commits unless the user explicitly asks
- Spec: `docs/superpowers/specs/2026-07-20-light-dark-mode-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/settings/appearanceLogic.ts` | `ColorMode` type, normalize, apply `data-color-mode` |
| `src/settings/appearanceLogic.assert.ts` | Pure normalize / toggle helper checks |
| `src/settings/useAppearance.ts` | Reactive `colorMode`, `setColorMode`, `toggleColorMode` |
| `src/styles.css` | Dark + light token blocks; body uses `--text` |
| `src/settings/AppearancePanel.vue` | Light / Dark control + consume tokens |
| `src/palette/CommandPalette.vue` | Handle `toggle-dark-mode`; consume tokens |
| `src/core/host/WidgetCard.vue` | Shell surfaces consume tokens |
| `src/settings/SettingsModal.vue` | Modal shell consume tokens |
| Settings / widget Vue SFCs | Mechanical rgba → token migration |

### Token contract (implement exactly)

On `html` (fallback = dark) and under `[data-color-mode="dark"]` / `[data-color-mode="light"]`:

| Token | Dark | Light |
|-------|------|-------|
| `--surface-bg-rgb` | `28, 28, 32` | `245, 245, 247` |
| `--fg-rgb` | `255, 255, 255` | `22, 22, 26` |
| `--inset-rgb` | `0, 0, 0` | `0, 0, 0` |
| `--shadow-rgb` | `0, 0, 0` | `0, 0, 0` |
| `--text` | `rgba(var(--fg-rgb), 0.92)` | same formula |
| `--text-muted` | `rgba(var(--fg-rgb), 0.55)` | same |
| `--text-faint` | `rgba(var(--fg-rgb), 0.4)` | same |
| `--border` | `rgba(var(--fg-rgb), 0.1)` | same |
| `--border-strong` | `rgba(var(--fg-rgb), 0.28)` | same |
| `--fill` | `rgba(var(--fg-rgb), 0.08)` | same |
| `--fill-hover` | `rgba(var(--fg-rgb), 0.14)` | same |
| `--inset-bg` | `rgba(var(--inset-rgb), 0.25)` | `rgba(var(--inset-rgb), 0.08)` |
| `--scrollbar` | `rgba(var(--fg-rgb), 0.22)` | same |
| `--native-color-scheme` | `dark` | `light` |

**Mechanical migration rules** (keep alphas; swap RGB only):

1. `rgba(28, 28, 32, …)` → `rgba(var(--surface-bg-rgb), …)`
2. `rgba(255, 255, 255, …)` → `rgba(var(--fg-rgb), …)`
3. Panel wells / recessed `rgba(0, 0, 0, …)` used as backgrounds → `rgba(var(--inset-rgb), …)`
4. Drop-shadow `rgba(0, 0, 0, calc(… * var(--surface-shadow)))` → `rgba(var(--shadow-rgb), calc(…))`
5. Do **not** rewrite intentional image/overlay scrims that must stay black for photo readability (e.g. `linear-gradient(transparent, rgba(0,0,0,0.65))` on image thumbnails) unless text on those scrims breaks — leave photo scrims as literal black
6. Do **not** rewrite non-neutral accents (`rgba(255, 128, 128, …)`, blues used for selection, etc.)

---

### Task 1: Color mode logic + asserts

**Files:**
- Modify: `src/settings/appearanceLogic.ts`
- Create: `src/settings/appearanceLogic.assert.ts`

**Interfaces:**
- Produces:
  - `export type ColorMode = "dark" | "light"`
  - `export const DEFAULT_COLOR_MODE: ColorMode = "dark"`
  - `export const COLOR_MODE_OPTIONS: { id: ColorMode; name: string; hint: string }[]`
  - `normalizeColorMode(raw: unknown): ColorMode`
  - `toggleColorModeValue(mode: ColorMode): ColorMode` — `"dark"` ↔ `"light"`
  - `applyColorModeToDocument(mode: ColorMode): void` — sets `dataset.colorMode`
  - `AppearanceState` gains `colorMode: ColorMode`
  - `DEFAULT_APPEARANCE` includes `colorMode: DEFAULT_COLOR_MODE`
  - `normalizeAppearance` includes `colorMode: normalizeColorMode(o.colorMode)` (missing → dark)

- [ ] **Step 1: Write failing asserts**

Create `src/settings/appearanceLogic.assert.ts`:

```ts
/**
 * Quick checks for appearance color-mode helpers
 * (run: npx tsx src/settings/appearanceLogic.assert.ts).
 */
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  normalizeColorMode,
  toggleColorModeValue,
} from "./appearanceLogic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(normalizeColorMode("light") === "light", "accept light");
assert(normalizeColorMode("dark") === "dark", "accept dark");
assert(normalizeColorMode("nope") === "dark", "unknown → dark");
assert(normalizeColorMode(undefined) === "dark", "missing → dark");

assert(toggleColorModeValue("dark") === "light", "toggle dark→light");
assert(toggleColorModeValue("light") === "dark", "toggle light→dark");

assert(DEFAULT_APPEARANCE.colorMode === "dark", "default dark");
assert(normalizeAppearance({}).colorMode === "dark", "empty object → dark");
assert(normalizeAppearance({ colorMode: "light" }).colorMode === "light", "preserve light");
assert(normalizeAppearance({ colorMode: "weird" }).colorMode === "dark", "bad colorMode → dark");

console.log("appearanceLogic.assert.ts: all passed");
```

- [ ] **Step 2: Run asserts — expect FAIL**

Run: `npx tsx src/settings/appearanceLogic.assert.ts`

Expected: FAIL (missing exports / `colorMode` on state)

- [ ] **Step 3: Implement color mode in `appearanceLogic.ts`**

Add near the top (with other types):

```ts
export type ColorMode = "dark" | "light";

export const DEFAULT_COLOR_MODE: ColorMode = "dark";

export const COLOR_MODE_OPTIONS: { id: ColorMode; name: string; hint: string }[] = [
  { id: "dark", name: "Dark", hint: "Dark frosted glass" },
  { id: "light", name: "Light", hint: "Light frosted glass" },
];
```

Extend `AppearanceState`:

```ts
export interface AppearanceState {
  fontId: FontId;
  colorMode: ColorMode;
  hideOnOutsideClick: boolean;
  openMonitor: OpenMonitor;
  surfaceOpacity: number;
  surfaceBlur: number;
  surfaceShadow: number;
  surfaceRadius: number;
  cornerShape: CornerShape;
}
```

Extend `DEFAULT_APPEARANCE` with `colorMode: DEFAULT_COLOR_MODE`.

Add helpers:

```ts
/** Normalize color mode; unknown / missing → dark. */
export function normalizeColorMode(raw: unknown): ColorMode {
  return raw === "light" ? "light" : "dark";
}

/** Flip dark ↔ light. */
export function toggleColorModeValue(mode: ColorMode): ColorMode {
  return mode === "dark" ? "light" : "dark";
}

/** Apply color mode to document root (`data-color-mode`). */
export function applyColorModeToDocument(mode: ColorMode): void {
  document.documentElement.dataset.colorMode = normalizeColorMode(mode);
}
```

In `normalizeAppearance`, after reading `o`, include:

```ts
colorMode: normalizeColorMode(o.colorMode),
```

(and keep all existing field normalization).

- [ ] **Step 4: Run asserts — expect PASS**

Run: `npx tsx src/settings/appearanceLogic.assert.ts`

Expected: `appearanceLogic.assert.ts: all passed`

---

### Task 2: CSS tokens

**Files:**
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `data-color-mode` on `<html>` from Task 1/3
- Produces: token contract listed above

- [ ] **Step 1: Replace `html` / `body` color setup in `src/styles.css`**

```css
/* Globale Styles für das transparente Vollbild-Overlay-Fenster.
   html/body/#app MÜSSEN transparent sein — sonst zeichnet WebView2 einen weißen/
   milchigen Hintergrund und die Fenstertransparenz aus tauri.conf.json geht optisch
   verloren (siehe PLAN.md §7). */

/* Dark tokens as html fallback so first paint stays dark before JS apply. */
html {
  --surface-opacity: 0.72;
  --surface-radius: 16px;
  --surface-corner-shape: round;
  --surface-bg-rgb: 28, 28, 32;
  --fg-rgb: 255, 255, 255;
  --inset-rgb: 0, 0, 0;
  --shadow-rgb: 0, 0, 0;
  --text: rgba(var(--fg-rgb), 0.92);
  --text-muted: rgba(var(--fg-rgb), 0.55);
  --text-faint: rgba(var(--fg-rgb), 0.4);
  --border: rgba(var(--fg-rgb), 0.1);
  --border-strong: rgba(var(--fg-rgb), 0.28);
  --fill: rgba(var(--fg-rgb), 0.08);
  --fill-hover: rgba(var(--fg-rgb), 0.14);
  --inset-bg: rgba(var(--inset-rgb), 0.25);
  --scrollbar: rgba(var(--fg-rgb), 0.22);
  --native-color-scheme: dark;
}

html[data-color-mode="dark"] {
  --surface-bg-rgb: 28, 28, 32;
  --fg-rgb: 255, 255, 255;
  --inset-rgb: 0, 0, 0;
  --shadow-rgb: 0, 0, 0;
  --text: rgba(var(--fg-rgb), 0.92);
  --text-muted: rgba(var(--fg-rgb), 0.55);
  --text-faint: rgba(var(--fg-rgb), 0.4);
  --border: rgba(var(--fg-rgb), 0.1);
  --border-strong: rgba(var(--fg-rgb), 0.28);
  --fill: rgba(var(--fg-rgb), 0.08);
  --fill-hover: rgba(var(--fg-rgb), 0.14);
  --inset-bg: rgba(var(--inset-rgb), 0.25);
  --scrollbar: rgba(var(--fg-rgb), 0.22);
  --native-color-scheme: dark;
}

html[data-color-mode="light"] {
  --surface-bg-rgb: 245, 245, 247;
  --fg-rgb: 22, 22, 26;
  --inset-rgb: 0, 0, 0;
  --shadow-rgb: 0, 0, 0;
  --text: rgba(var(--fg-rgb), 0.92);
  --text-muted: rgba(var(--fg-rgb), 0.55);
  --text-faint: rgba(var(--fg-rgb), 0.4);
  --border: rgba(var(--fg-rgb), 0.1);
  --border-strong: rgba(var(--fg-rgb), 0.28);
  --fill: rgba(var(--fg-rgb), 0.08);
  --fill-hover: rgba(var(--fg-rgb), 0.14);
  --inset-bg: rgba(var(--inset-rgb), 0.08);
  --scrollbar: rgba(var(--fg-rgb), 0.22);
  --native-color-scheme: light;
}

html,
body,
#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: transparent;
}

body {
  overflow: hidden;
  font-family: var(
    --font-family,
    -apple-system,
    "Segoe UI",
    Inter,
    Avenir,
    Helvetica,
    Arial,
    sans-serif
  );
  color: var(--text);
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}
```

- [ ] **Step 2: Sanity-check tokens in DevTools (optional during implement)**

In the running app, set `document.documentElement.dataset.colorMode = "light"` and confirm `--fg-rgb` becomes `22, 22, 26`. Revert to `"dark"` afterward until Task 3 wires persistence.

---

### Task 3: Wire `useAppearance`

**Files:**
- Modify: `src/settings/useAppearance.ts`

**Interfaces:**
- Consumes: `ColorMode`, `normalizeColorMode`, `toggleColorModeValue`, `applyColorModeToDocument` from Task 1
- Produces:
  - `colorMode: Ref<ColorMode>`
  - `setColorMode(mode: ColorMode): void`
  - `toggleColorMode(): void`

- [ ] **Step 1: Import new helpers and extend module state**

Update imports from `./appearanceLogic` to include `ColorMode`, `applyColorModeToDocument`, `normalizeColorMode`, `toggleColorModeValue`.

After other refs:

```ts
const colorMode: Ref<ColorMode> = ref(initial.colorMode);
```

After other boot applies:

```ts
applyColorModeToDocument(colorMode.value);
```

Include `colorMode: colorMode.value` in `persist()`’s `AppearanceState` object.

- [ ] **Step 2: Add setters inside `useAppearance()`**

```ts
  /** Live-apply + persist light/dark color mode. */
  function setColorMode(mode: ColorMode) {
    const next = normalizeColorMode(mode);
    colorMode.value = next;
    applyColorModeToDocument(next);
    persist();
  }

  /** Flip light ↔ dark and persist. */
  function toggleColorMode() {
    setColorMode(toggleColorModeValue(colorMode.value));
  }
```

Return `colorMode`, `setColorMode`, `toggleColorMode` from the composable.

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`

Expected: PASS (or only pre-existing unrelated errors — do not introduce new ones in these files)

---

### Task 4: Appearance panel control

**Files:**
- Modify: `src/settings/AppearancePanel.vue`

**Interfaces:**
- Consumes: `COLOR_MODE_OPTIONS`, `ColorMode`, `colorMode`, `setColorMode` from Tasks 1–3

- [ ] **Step 1: Wire script**

Import `COLOR_MODE_OPTIONS` and `type ColorMode` from `./appearanceLogic`.

Destructure `colorMode`, `setColorMode` from `useAppearance()`.

Add:

```ts
/** Select color mode and live-apply. */
function onColorMode(mode: ColorMode) {
  setColorMode(mode);
}
```

- [ ] **Step 2: Add Color mode UI above the Font section**

Insert immediately after the title (before the font subtitle), or as a new section between title and fonts:

```vue
    <h3 class="appearance-section">Color mode</h3>
    <p class="appearance-sub">Switch between dark and light frosted glass.</p>
    <div class="appearance-corners" role="listbox" aria-label="Color mode">
      <button
        v-for="opt in COLOR_MODE_OPTIONS"
        :key="opt.id"
        type="button"
        class="corner-card"
        role="option"
        :aria-selected="colorMode === opt.id"
        :class="{ 'corner-card--active': colorMode === opt.id }"
        @click="onColorMode(opt.id)"
      >
        <span class="corner-card-name">{{ opt.name }}</span>
        <span class="corner-card-hint">{{ opt.hint }}</span>
      </button>
    </div>
```

Reuse existing `.appearance-corners` / `.corner-card` styles (same pattern as corner shape).

- [ ] **Step 3: Migrate this panel’s scoped rgba to tokens**

Apply the mechanical migration rules to all `rgba(255,…)`, `rgba(28,…)`, and recessed `rgba(0,0,0,…)` in `AppearancePanel.vue` styles. Keep the blue active accent (`rgba(120, 180, 255, …)` / `rgba(80, 140, 255, …)`) as-is.

- [ ] **Step 4: Manual check**

Open Settings → Appearance. Click Light → `document.documentElement.dataset.colorMode === "light"`. Click Dark → `"dark"`. Reload app → choice persists.

---

### Task 5: Palette Toggle Dark Mode

**Files:**
- Modify: `src/palette/CommandPalette.vue` (handler near `open-settings` ~line 299)

**Interfaces:**
- Consumes: `useAppearance().toggleColorMode`
- Produces: working `toggle-dark-mode` without hiding the window

- [ ] **Step 1: Import / obtain `toggleColorMode`**

Where other settings helpers are imported (same area as `showSettings` / `useAppearance` if already present; otherwise import `useAppearance` and destructure `toggleColorMode`).

- [ ] **Step 2: Branch before `execute_action`**

Next to the `open-settings` branch:

```ts
  if (row.commandId === "toggle-dark-mode") {
    toggleColorMode();
    query.value = "";
    selectedIndex.value = 0;
    return;
  }
```

Do **not** call `getCurrentWindow().hide()`. Do **not** fall through to `execute_action`.

- [ ] **Step 3: Manual check**

Open palette → run Toggle Dark Mode → mode flips + persists. Palette query clears; Kavibay window stays visible. Toggle again restores previous mode.

---

### Task 6: Migrate shared shells

**Files:**
- Modify: `src/core/host/WidgetCard.vue` (styles)
- Modify: `src/palette/CommandPalette.vue` (styles)
- Modify: `src/settings/SettingsModal.vue` (styles)

**Interfaces:**
- Consumes: token contract from Task 2

- [ ] **Step 1: Migrate `WidgetCard.vue` styles**

Apply mechanical rules. Critical examples:

```css
.widget-card {
  background: rgba(var(--surface-bg-rgb), var(--surface-opacity, 0.72));
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  box-shadow: 0 8px 24px rgba(var(--shadow-rgb), calc(0.35 * var(--surface-shadow, 1)));
  color: rgba(var(--fg-rgb), 0.92);
}
```

Replace all other `rgba(255, 255, 255, …)`, `rgba(28, 28, 32, …)`, shadow blacks, and recessed inset blacks in this file the same way. Leave non-neutral accents alone.

- [ ] **Step 2: Migrate `CommandPalette.vue` styles**

Same rules. Palette panel background must use `--surface-bg-rgb` + `--surface-opacity`.

- [ ] **Step 3: Migrate `SettingsModal.vue` styles**

Same rules for modal chrome, sidebar, nav items.

- [ ] **Step 4: Manual check**

With a Clock (or any) widget + palette + Settings open: switch Light/Dark. Shells must flip to frosted pale + dark text in light mode; dark mode must match prior look.

---

### Task 7: Migrate settings panels + menus

**Files:**
- Modify (settings):  
  `src/settings/BehaviorPanel.vue`,  
  `src/settings/ExtensionsPanel.vue`,  
  `src/settings/GoogleCalendarPanel.vue`,  
  `src/settings/CloudflareAiPanel.vue`,  
  `src/settings/TadoPanel.vue`
- Modify (menus / auth panels that use glass chrome):  
  `src/extensions/app-launcher/AppLauncherMenu.vue`,  
  `src/extensions/calendar/CalendarMenu.vue`,  
  `src/extensions/todo/TodoMenu.vue`,  
  `src/extensions/ask-llm/AskLlmMenu.vue`,  
  `src/extensions/notes/NotesMenu.vue`,  
  `src/extensions/clipboard/ClipboardMenu.vue`,  
  `src/extensions/calendar/CalendarAuthPanel.vue`,  
  `src/extensions/tado/TadoAuthPanel.vue`,  
  `src/extensions/ask-llm/AskLlmModelPicker.vue`,  
  `src/core/host/StickyIcon.vue` (if it uses hardcoded rgba)

**Interfaces:**
- Consumes: token contract from Task 2

- [ ] **Step 1: Apply mechanical migration to each file listed**

For each file: replace per Global Constraints migration rules. Prefer search within `<style` blocks.

- [ ] **Step 2: Grep gate for this set**

Run (PowerShell):

```powershell
rg "rgba\(255, 255, 255|rgba\(28, 28, 32" src/settings src/extensions/*/ *Menu.vue src/extensions/*/ *AuthPanel.vue src/extensions/ask-llm/AskLlmModelPicker.vue
```

Expected: no remaining neutral white/surface triples in those files (accents may still match other rgba patterns).

- [ ] **Step 3: Spot-check**

Open Settings sections (Behavior, Extensions, integrations) in Light mode — text and controls readable.

---

### Task 8: Migrate widgets (batch A — core)

**Files:**
- Modify:  
  `src/extensions/clock/ClockWidget.vue`,  
  `src/extensions/clock/ClockSettings.vue`,  
  `src/extensions/notes/NotesWidget.vue`,  
  `src/extensions/todo/TodoWidget.vue`,  
  `src/extensions/clipboard/ClipboardWidget.vue`,  
  `src/extensions/calculator/CalculatorWidget.vue`,  
  `src/extensions/weather/WeatherWidget.vue`,  
  `src/extensions/weather/WeatherSettings.vue`,  
  `src/extensions/pomodoro/PomodoroWidget.vue`,  
  `src/extensions/pomodoro/PomodoroSettings.vue`,  
  `src/extensions/timer/TimerWidget.vue`,  
  `src/extensions/stopwatch/StopwatchWidget.vue`,  
  `src/extensions/alarm/AlarmWidget.vue`,  
  `src/extensions/now-playing/NowPlayingWidget.vue`

- [ ] **Step 1: Apply mechanical migration to each file**

Leave photo/video scrim gradients literal black when present.

- [ ] **Step 2: Grep gate**

```powershell
rg "rgba\(255, 255, 255|rgba\(28, 28, 32" src/extensions/clock src/extensions/notes src/extensions/todo src/extensions/clipboard src/extensions/calculator src/extensions/weather src/extensions/pomodoro src/extensions/timer src/extensions/stopwatch src/extensions/alarm src/extensions/now-playing
```

Expected: no remaining neutral white/surface triples (non-neutral accents OK).

- [ ] **Step 3: Spot-check in Light + Dark**

Verify Clock, Notes, Todo, Clipboard, Weather read correctly in both modes.

---

### Task 9: Migrate widgets (batch B — remaining)

**Files:**
- Modify:  
  `src/extensions/app-launcher/AppLauncherWidget.vue`,  
  `src/extensions/calendar/CalendarWidget.vue`,  
  `src/extensions/calendar/CalendarSettings.vue`,  
  `src/extensions/ask-llm/AskLlmWidget.vue`,  
  `src/extensions/ask-llm/AskLlmSettings.vue`,  
  `src/extensions/ask-llm/AskLlmVendorLogo.vue`,  
  `src/extensions/image/ImageWidget.vue`,  
  `src/extensions/snapshots/SnapshotsWidget.vue`,  
  `src/extensions/stocks/StocksWidget.vue`,  
  `src/extensions/stocks/StocksSettings.vue`,  
  `src/extensions/system-info/SystemInfoWidget.vue`,  
  `src/extensions/system-info/SystemInfoSettings.vue`,  
  `src/extensions/tado/TadoWidget.vue`,  
  `src/extensions/tado/TadoSettings.vue`,  
  `src/extensions/emoji-picker/EmojiPickerWidget.vue`,  
  `src/extensions/color-picker/ColorPickerWidget.vue`,  
  `src/extensions/redacted/RedactedWidget.vue` (if present with rgba),  
  `src/extensions/redacted/RedactedSettings.vue`,  
  `src/extensions/snake/SnakeWidget.vue` (if present with rgba)

- [ ] **Step 1: Apply mechanical migration to each file**

Special cases:
- `ImageWidget` / `SnapshotsWidget`: keep image overlay scrims as literal `rgba(0,0,0,…)`
- `CalendarWidget`: replace hardcoded `color-scheme: dark` with `color-scheme: var(--native-color-scheme)`
- `redactedLogic.ts` inline style `borderColor = "rgba(255,…)"` → use a CSS class on the card (or read `getComputedStyle(document.documentElement).getPropertyValue('--border').trim()`); prefer a class over JS color strings

- [ ] **Step 2: Repo-wide grep gate**

```powershell
rg "rgba\(28, 28, 32" src
rg "rgba\(255, 255, 255" src --glob "*.vue" --glob "*.css"
```

Expected:
- Zero `rgba(28, 28, 32` in `src`
- Remaining `rgba(255, 255, 255` only for non-theme accents (or none). If any neutral white remains in Vue/CSS, migrate them.

- [ ] **Step 3: Spot-check heavy widgets**

App Launcher, Calendar, Ask LLM, Image, Stocks in Light + Dark.

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Asserts + typecheck**

```powershell
npx tsx src/settings/appearanceLogic.assert.ts
npx vue-tsc --noEmit
```

Expected: asserts print `all passed`; `vue-tsc` clean for this work.

- [ ] **Step 2: Persistence + toggle checklist**

1. Fresh state → dark
2. Appearance → Light → reload → still light
3. Palette Toggle Dark Mode → dark → reload → dark
4. Glass opacity slider still changes translucency in both modes
5. Default dark look visually matches pre-change for dark mode

- [ ] **Step 3: Done**

Report any leftover accent readability issues (do not block on non-neutral accents unless text is illegible).

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Manual `colorMode` dark/light, default dark | 1, 3 |
| Persist in `kavibay:appearance-v1` | 1, 3 |
| Appearance Light/Dark control | 4 |
| Palette `toggle-dark-mode` | 5 |
| `data-color-mode` + CSS tokens | 2, 3 |
| Light frosted + dark text | 2, 6–9 |
| Migrate shells + widgets | 6–9 |
| Mode-agnostic glass knobs | preserved (no per-mode defaults) |
| Accents unchanged unless needed | migration rules |
| First-paint dark fallback | Task 2 `html { … }` tokens |
| Success criteria 1–4 | Task 10 |
