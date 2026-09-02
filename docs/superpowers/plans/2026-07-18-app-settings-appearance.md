# App Settings Modal + Appearance Fonts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a main Settings modal from the command palette; Appearance section lets the user live-switch between three global fonts that apply to the palette and all widgets.

**Architecture:** Lightweight glass modal (sidebar + content) mounted in `App.vue`. Font state lives in `appearanceLogic.ts` + `useAppearance()` (localStorage `kavibay:appearance-v1`). Palette command `open-settings` opens the modal without hiding the window. CSS variable `--font-family` on `documentElement` drives inheritance.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 overlay, Google Fonts (CDN link in `index.html`). No new npm dependencies.

## Global Constraints

- Client-side UI only — `open-settings` must not rely on Rust `execute_action` for the modal
- Persist key: `kavibay:appearance-v1` → `{ "fontId": "jakarta" | "manrope" | "jetbrains" }`
- Default font: `jakarta` (Plus Jakarta Sans)
- Live-apply on select (no Save button)
- Fonts: Plus Jakarta Sans, Manrope, JetBrains Mono
- Esc closes Settings before hiding the Kavibay window
- Modal/backdrop: `data-interactive`; pause click-through while open
- No test runner — verify with `npx vue-tsc --noEmit` and manual UI checks
- Skip git commits unless the user explicitly asks
- Spec: `docs/superpowers/specs/2026-07-18-app-settings-appearance-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/settings/appearanceLogic.ts` | Font catalog, normalize, load/save, apply to DOM |
| `src/settings/useAppearance.ts` | Shared reactive `fontId` + `setFont` |
| `src/settings/useSettingsModal.ts` | Shared `open` flag + show/hide |
| `src/settings/AppearancePanel.vue` | Three font cards |
| `src/settings/SettingsModal.vue` | Backdrop, sidebar nav, content area |
| `src/palette/commands.ts` | Add `open-settings` |
| `src/palette/CommandPalette.vue` | Branch for `open-settings` |
| `src/App.vue` | Mount modal, boot appearance, Esc precedence |
| `src/styles.css` | `font-family: var(--font-family, …)` |
| `index.html` | Google Fonts `<link>` |

---

### Task 1: Appearance logic + composable + global CSS

**Files:**
- Create: `src/settings/appearanceLogic.ts`
- Create: `src/settings/useAppearance.ts`
- Modify: `src/styles.css`
- Modify: `index.html`

**Interfaces:**
- Produces:
  - `FontId = "jakarta" | "manrope" | "jetbrains"`
  - `AppearanceState { fontId: FontId }`
  - `FONT_OPTIONS: { id, name, stack, sample }[]`
  - `APPEARANCE_STORAGE_KEY`, `DEFAULT_APPEARANCE`
  - `normalizeAppearance(raw): AppearanceState`
  - `loadAppearance()`, `saveAppearance(state)`
  - `fontStack(id): string`
  - `applyFontToDocument(id: FontId): void`
  - `useAppearance(): { fontId: Ref<FontId>; setFont(id: FontId): void }`

- [ ] **Step 1: Create `src/settings/appearanceLogic.ts`**

```ts
export type FontId = "jakarta" | "manrope" | "jetbrains";

export interface AppearanceState {
  fontId: FontId;
}

export interface FontOption {
  id: FontId;
  name: string;
  stack: string;
  sample: string;
}

export const APPEARANCE_STORAGE_KEY = "kavibay:appearance-v1";

export const DEFAULT_APPEARANCE: AppearanceState = {
  fontId: "jakarta",
};

/** Curated fonts offered in Appearance settings. */
export const FONT_OPTIONS: FontOption[] = [
  {
    id: "jakarta",
    name: "Plus Jakarta Sans",
    stack: '"Plus Jakarta Sans", system-ui, sans-serif',
    sample: "14:32 · Focus session",
  },
  {
    id: "manrope",
    name: "Manrope",
    stack: '"Manrope", system-ui, sans-serif',
    sample: "14:32 · Focus session",
  },
  {
    id: "jetbrains",
    name: "JetBrains Mono",
    stack: '"JetBrains Mono", ui-monospace, monospace',
    sample: "14:32 · Focus session",
  },
];

const ALLOWED = new Set<FontId>(FONT_OPTIONS.map((f) => f.id));

/** Normalize raw persisted appearance; unknown font → jakarta. */
export function normalizeAppearance(raw: unknown): AppearanceState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fontId =
    typeof o.fontId === "string" && ALLOWED.has(o.fontId as FontId)
      ? (o.fontId as FontId)
      : DEFAULT_APPEARANCE.fontId;
  return { fontId };
}

/** CSS font-family stack for a font id. */
export function fontStack(id: FontId): string {
  return FONT_OPTIONS.find((f) => f.id === id)?.stack ?? FONT_OPTIONS[0].stack;
}

/** Load appearance from localStorage. */
export function loadAppearance(): AppearanceState {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    return normalizeAppearance(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** Persist normalized appearance. */
export function saveAppearance(state: AppearanceState): void {
  localStorage.setItem(
    APPEARANCE_STORAGE_KEY,
    JSON.stringify(normalizeAppearance(state)),
  );
}

/** Apply font id to document root (CSS variable + data attribute). */
export function applyFontToDocument(id: FontId): void {
  const root = document.documentElement;
  root.style.setProperty("--font-family", fontStack(id));
  root.dataset.font = id;
}
```

- [ ] **Step 2: Create `src/settings/useAppearance.ts`**

```ts
import { type Ref, ref } from "vue";
import {
  type FontId,
  applyFontToDocument,
  loadAppearance,
  saveAppearance,
} from "./appearanceLogic";

const fontId: Ref<FontId> = ref(loadAppearance().fontId);

/** Apply current font once (boot / first import). */
applyFontToDocument(fontId.value);

/** App-wide appearance (font) shared by Settings UI and boot path. */
export function useAppearance() {
  /** Live-apply + persist a font choice. */
  function setFont(id: FontId) {
    fontId.value = id;
    applyFontToDocument(id);
    saveAppearance({ fontId: id });
  }

  return { fontId, setFont };
}
```

- [ ] **Step 3: Update `src/styles.css` body font**

Replace the `body` `font-family` block with:

```css
body {
  /* Kein Scrollbalken auf dem Vollbild-Overlay, egal wie Kinder positioniert sind. */
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
  color: rgba(255, 255, 255, 0.92);
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 4: Add Google Fonts to `index.html` `<head>`**

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
```

- [ ] **Step 5: Ensure boot apply — import in `src/main.ts`**

In `src/main.ts`, add (before or after other imports):

```ts
import "./settings/useAppearance";
```

This runs the module-level `applyFontToDocument` before mount.

- [ ] **Step 6: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS (no new errors from these files)

- [ ] **Step 7: Manual check**

In browser/Tauri console:

```js
localStorage.setItem("kavibay:appearance-v1", JSON.stringify({ fontId: "jetbrains" }));
location.reload();
```

Expected: `document.documentElement.style.getPropertyValue("--font-family")` contains `JetBrains Mono`.

---

### Task 2: Settings modal shell + Appearance panel

**Files:**
- Create: `src/settings/useSettingsModal.ts`
- Create: `src/settings/AppearancePanel.vue`
- Create: `src/settings/SettingsModal.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `useAppearance()`, `FONT_OPTIONS`, `FontId`
- Produces:
  - `useSettingsModal(): { open: Ref<boolean>; show(): void; hide(): void }`
  - `SettingsModal.vue` — open/close, Esc capture, click-through pause
  - `AppearancePanel.vue` — three font cards calling `setFont`

- [ ] **Step 1: Create `src/settings/useSettingsModal.ts`**

```ts
import { ref, type Ref } from "vue";

const open: Ref<boolean> = ref(false);

/** Shared open state for the app Settings modal. */
export function useSettingsModal() {
  function show() {
    open.value = true;
  }

  function hide() {
    open.value = false;
  }

  return { open, show, hide };
}
```

- [ ] **Step 2: Create `src/settings/AppearancePanel.vue`**

```vue
<script setup lang="ts">
import { FONT_OPTIONS, type FontId } from "./appearanceLogic";
import { useAppearance } from "./useAppearance";

const { fontId, setFont } = useAppearance();

/** Select a font and live-apply it globally. */
function onSelect(id: FontId) {
  setFont(id);
}
</script>

<template>
  <div class="appearance">
    <h2 class="appearance-title">Appearance</h2>
    <p class="appearance-sub">Choose a typeface for the palette and all widgets.</p>
    <div class="appearance-fonts" role="listbox" aria-label="Font style">
      <button
        v-for="font in FONT_OPTIONS"
        :key="font.id"
        type="button"
        class="font-card"
        role="option"
        :aria-selected="fontId === font.id"
        :class="{ 'font-card--active': fontId === font.id }"
        :style="{ fontFamily: font.stack }"
        @click="onSelect(font.id)"
      >
        <span class="font-card-name">{{ font.name }}</span>
        <span class="font-card-sample">{{ font.sample }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.appearance {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.appearance-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.appearance-sub {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
}

.appearance-fonts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.font-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  text-align: left;
}

.font-card:hover {
  background: rgba(255, 255, 255, 0.08);
}

.font-card--active {
  border-color: rgba(120, 180, 255, 0.55);
  background: rgba(80, 140, 255, 0.12);
}

.font-card-name {
  font-size: 14px;
  font-weight: 600;
}

.font-card-sample {
  font-size: 20px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
}
</style>
```

- [ ] **Step 3: Create `src/settings/SettingsModal.vue`**

```vue
<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, watch } from "vue";
import {
  setClickThroughPaused,
  syncInteractiveRegions,
} from "../system/clickThrough";
import AppearancePanel from "./AppearancePanel.vue";
import { useSettingsModal } from "./useSettingsModal";

const { open, hide } = useSettingsModal();

type SectionId = "appearance";
const activeSection: SectionId = "appearance";

/** Close when pointer hits the backdrop (not the panel). */
function onBackdropPointerDown(event: PointerEvent) {
  if (event.target === event.currentTarget) hide();
}

/** Esc closes settings before App.vue hides the window. */
function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !open.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  hide();
}

watch(open, async (isOpen) => {
  setClickThroughPaused(isOpen);
  await nextTick();
  syncInteractiveRegions();
});

onMounted(() => {
  document.addEventListener("keydown", onDocumentKeydown, true);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onDocumentKeydown, true);
  if (open.value) setClickThroughPaused(false);
});
</script>

<template>
  <div
    v-if="open"
    class="settings-backdrop"
    data-interactive
    @pointerdown="onBackdropPointerDown"
  >
    <div
      class="settings-modal"
      data-interactive
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      @pointerdown.stop
    >
      <aside class="settings-nav">
        <div class="settings-nav-label">Settings</div>
        <button
          type="button"
          class="settings-nav-item"
          :class="{ 'settings-nav-item--active': activeSection === 'appearance' }"
        >
          Appearance
        </button>
      </aside>
      <section class="settings-content">
        <button
          type="button"
          class="settings-close"
          aria-label="Close settings"
          @click="hide"
        >
          ×
        </button>
        <AppearancePanel v-if="activeSection === 'appearance'" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.35);
}

.settings-modal {
  display: flex;
  width: min(720px, calc(100vw - 48px));
  height: min(480px, calc(100vh - 48px));
  border-radius: 16px;
  background: rgba(28, 28, 32, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(18px);
  overflow: hidden;
  pointer-events: auto;
}

.settings-nav {
  width: 200px;
  flex-shrink: 0;
  padding: 16px 10px;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.18);
}

.settings-nav-label {
  padding: 4px 10px 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
}

.settings-nav-item {
  display: block;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.settings-nav-item--active,
.settings-nav-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.95);
}

.settings-content {
  position: relative;
  flex: 1;
  padding: 24px 28px;
  min-width: 0;
}

.settings-close {
  position: absolute;
  top: 12px;
  right: 14px;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.settings-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}
</style>
```

- [ ] **Step 4: Mount modal in `src/App.vue`**

```vue
<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CommandPalette from "./palette/CommandPalette.vue";
import WidgetHost from "./widgets/WidgetHost.vue";
import SettingsModal from "./settings/SettingsModal.vue";
import { useSettingsModal } from "./settings/useSettingsModal";
import { useRegionSync } from "./system/clickThrough";

useRegionSync();

const { open: settingsOpen } = useSettingsModal();

/** Hide window on Esc only when Settings is closed (modal handles Esc first). */
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && !settingsOpen.value) {
    void getCurrentWindow().hide();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="app-shell">
    <WidgetHost>
      <template #center>
        <CommandPalette />
      </template>
    </WidgetHost>
    <SettingsModal />
  </div>
</template>
```

Keep the existing `.app-shell` styles. Ensure `SettingsModal` is a sibling of `WidgetHost` so `position: fixed` is not clipped; the backdrop sets `pointer-events: auto` while the shell stays `pointer-events: none`.

- [ ] **Step 5: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS

- [ ] **Step 6: Manual check**

Temporarily in console after load:

```js
// if needed, expose via temporary button — or wait for Task 3
```

After Task 3 wiring: open Settings → three cards → click Manrope → Clock/Pomodoro text updates immediately → Esc closes modal → Esc again hides window.

---

### Task 3: Palette command `open-settings`

**Files:**
- Modify: `src/palette/commands.ts`
- Modify: `src/palette/CommandPalette.vue`

**Interfaces:**
- Consumes: `useSettingsModal().show()`
- Produces: palette entry that opens Settings without `hide()` / without requiring Rust side effects

- [ ] **Step 1: Add command to `src/palette/commands.ts`**

Insert at the **top** of the `commands` array (so it ranks well for empty/short queries when keywords match):

```ts
  {
    id: "open-settings",
    title: "Settings",
    subtitle: "Appearance and preferences",
    keywords: ["settings", "preferences", "appearance", "fonts", "typeface"],
  },
```

- [ ] **Step 2: Branch in `CommandPalette.vue` `runCommandAt`**

Add import:

```ts
import { useSettingsModal } from "../settings/useSettingsModal";
```

Inside `<script setup>`:

```ts
const { show: showSettings } = useSettingsModal();
```

Replace `runCommandAt` with:

```ts
async function runCommandAt(index: number) {
  const command = results.value[index];
  if (!command) return;

  // App settings is UI-only: open modal, keep the Kavibay window visible.
  if (command.id === "open-settings") {
    query.value = "";
    selectedIndex.value = 0;
    addMenuOpen.value = false;
    showSettings();
    return;
  }

  await invoke("execute_action", { actionId: command.id });
  await getCurrentWindow().hide();
}
```

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: PASS

- [ ] **Step 4: Manual end-to-end check**

1. `npm run tauri dev` (or existing dev flow)
2. Ctrl+Space → type `settings` → Enter  
   Expected: Settings modal opens; window stays visible; palette query cleared
3. Click each font card  
   Expected: active highlight moves; widget + palette typography changes live
4. Reload app  
   Expected: last font still applied (`data-font` on `<html>`)
5. Esc → modal closes; Esc again → window hides
6. Re-open Settings → click backdrop → modal closes
7. Click-through: with Settings open, clicking outside interactive rects should not “fall through” awkwardly; with modal closed, click-through still works

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Palette command opens Settings | Task 3 |
| Palette closes / modal opens; window stays up | Task 3 |
| Left nav Appearance | Task 2 |
| Three fonts Jakarta / Manrope / JetBrains | Task 1 + 2 |
| Live-apply | Task 1 + 2 |
| Persist `kavibay:appearance-v1` | Task 1 |
| Global CSS variable inheritance | Task 1 |
| Google Fonts load | Task 1 |
| Esc / backdrop / ✕ close | Task 2 |
| Esc before window hide | Task 2 |
| `data-interactive` + click-through pause | Task 2 |
| Boot restore | Task 1 (`main.ts` import) |

## Self-review notes

- No placeholders; signatures consistent (`FontId`, `setFont`, `show`/`hide`)
- No test runner in repo — verification matches other Kavibay plans
- Commits skipped unless user asks (no git repo in workspace at plan time)
