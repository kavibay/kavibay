# External Widget Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Move / Sticky / Menu icons outside every widget card, restrict drag to the Move handle, and let sticky widgets survive hide-on-outside-click dismiss.

**Architecture:** Shared chrome in `WidgetCard` (hover-only toolbar above the card). `WidgetHost` owns drag-from-handle and sticky-aware outside dismiss. `sticky?: boolean` persists on `WidgetInstance` in `kavibay:layout-v3`. Pure helper `dismissNonStickyInstances` soft-hides non-sticky instances and reports whether any sticky remain.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 overlay (no new dependencies).

## Global Constraints

- Toolbar lives outside the card container; all 15 registry widgets inherit via `WidgetCard` / `WidgetHost`
- Drag starts only from the Move icon (no whole-card grab)
- Sticky = survives hide-on-outside-click; Esc still hides the whole window
- Storage key remains `kavibay:layout-v3` (no version bump); missing `sticky` ⇒ false
- Duplicate copies `sticky` from the source
- Context-menu Hide / Remove still work on sticky widgets
- Palette is not sticky; when sticky widgets keep the window open, palette stays visible
- No test runner — verify with Node assert scripts, `npx vue-tsc --noEmit`, and manual UI checks
- Spec: `docs/superpowers/specs/2026-07-19-external-widget-menu-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/core/host/types.ts` | Add `sticky?: boolean` on `WidgetInstance` |
| `src/core/host/layoutLogic.ts` | Persist/normalize/duplicate `sticky`; export `dismissNonStickyInstances` |
| `src/core/host/WidgetCard.vue` | External 3-icon toolbar; remove in-card `⋯`; emit move/sticky/menu |
| `src/core/host/WidgetInstanceView.vue` | Pass `sticky`; forward `toggle-sticky` / `move-pointerdown` |
| `src/core/host/WidgetHost.vue` | Drag from Move only; toggle sticky; own outside-dismiss catcher |
| `src/App.vue` | Remove dismiss-catcher (moved into host); keep Esc hide |

---

### Task 1: `sticky` on layout model + dismiss helper

**Files:**
- Modify: `src/core/host/types.ts`
- Modify: `src/core/host/layoutLogic.ts`
- Test: inline Node assert script (no test file)

**Interfaces:**
- Consumes: existing `WidgetInstance`, `normalizeInstance`, `duplicateInstance`
- Produces:
  - `WidgetInstance.sticky?: boolean`
  - `normalizeInstance` persists `sticky: true` when set
  - `duplicateInstance` copies `sticky` when true
  - `dismissNonStickyInstances(instances): boolean` — soft-hides non-sticky visible instances; returns whether any sticky (and not hidden) instance remains

- [ ] **Step 1: Extend `WidgetInstance` in `src/core/host/types.ts`**

After `hidden?: boolean;` add:

```ts
  /** When true, survives hide-on-outside-click dismiss. */
  sticky?: boolean;
```

- [ ] **Step 2: Persist + duplicate `sticky` in `src/core/host/layoutLogic.ts`**

In `normalizeInstance`, after the `hidden` line:

```ts
  if (i.sticky === true) next.sticky = true;
```

In `duplicateInstance`, after the `hideTitle` spread:

```ts
    ...(source.sticky === true ? { sticky: true } : {}),
```

- [ ] **Step 3: Add `dismissNonStickyInstances` in `src/core/host/layoutLogic.ts`**

```ts
/**
 * Soft-hide every non-sticky instance that is currently visible.
 * Returns true when at least one sticky, non-hidden instance remains.
 */
export function dismissNonStickyInstances(instances: WidgetInstance[]): boolean {
  for (const instance of instances) {
    if (instance.sticky === true) continue;
    if (instance.hidden === true) continue;
    instance.hidden = true;
  }
  return instances.some((i) => i.sticky === true && i.hidden !== true);
}
```

Note: callers that need extension `onSuspend` hooks must run those themselves before/while setting `hidden` (Task 4). This helper only mutates `hidden` / reports sticky survivors. Prefer keeping the helper pure for layout fields and having `WidgetHost` loop with hooks — if so, implement the host loop in Task 4 and keep this helper as:

```ts
/** True when any sticky instance is still visible (not hidden). */
export function hasVisibleStickyInstance(instances: WidgetInstance[]): boolean {
  return instances.some((i) => i.sticky === true && i.hidden !== true);
}

/** Instance ids that should soft-hide on outside dismiss (visible and not sticky). */
export function nonStickyVisibleIds(instances: WidgetInstance[]): string[] {
  return instances
    .filter((i) => i.sticky !== true && i.hidden !== true)
    .map((i) => i.instanceId);
}
```

Use the two-helper form (cleaner for `onSuspend`).

- [ ] **Step 4: Verify with Node assert script**

Run (PowerShell):

```powershell
node --input-type=module -e @"
import assert from 'node:assert/strict';
import { normalizeInstance, duplicateInstance, hasVisibleStickyInstance, nonStickyVisibleIds } from './src/core/host/layoutLogic.ts';

const sticky = normalizeInstance({
  instanceId: 'a', typeId: 'clock', offset: { x: 1, y: 2 }, sticky: true, hidden: false as unknown as undefined,
});
assert.equal(sticky.sticky, true);

const plain = normalizeInstance({
  instanceId: 'b', typeId: 'clock', offset: { x: 0, y: 0 }, sticky: false,
});
assert.equal(plain.sticky, undefined);

const dup = duplicateInstance({
  instanceId: 'a', typeId: 'clock', offset: { x: 1, y: 2 }, sticky: true, title: 'X',
});
assert.equal(dup.sticky, true);
assert.notEqual(dup.instanceId, 'a');

const list = [
  { instanceId: '1', typeId: 'clock', offset: { x: 0, y: 0 }, sticky: true },
  { instanceId: '2', typeId: 'timer', offset: { x: 1, y: 1 } },
  { instanceId: '3', typeId: 'notes', offset: { x: 2, y: 2 }, hidden: true },
];
assert.deepEqual(nonStickyVisibleIds(list), ['2']);
assert.equal(hasVisibleStickyInstance(list), true);
list[0].hidden = true;
assert.equal(hasVisibleStickyInstance(list), false);
console.log('ok');
"@
```

Expected: `ok`

If Vite/TS import fails under bare Node, run the same asserts against a tiny duplicated copy of the helpers in the `-e` script, then keep the real exports in `layoutLogic.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/core/host/types.ts src/core/host/layoutLogic.ts
git commit -m "feat: persist widget sticky flag and dismiss helpers"
```

---

### Task 2: External toolbar in `WidgetCard`

**Files:**
- Modify: `src/core/host/WidgetCard.vue`

**Interfaces:**
- Consumes: existing menu/settings overlay logic
- Produces:
  - Props: `sticky?: boolean`
  - Emits: `toggle-sticky`, `move-pointerdown` (`PointerEvent`)
  - In-card `.widget-menu-trigger` removed
  - External `.widget-chrome` row with Move / Sticky / Menu

- [ ] **Step 1: Add props/emits**

Extend props:

```ts
    /** When true, sticky icon shows active state. */
    sticky?: boolean;
```

Default via `withDefaults`: `sticky: false`.

Extend emits:

```ts
  "toggle-sticky": [];
  "move-pointerdown": [event: PointerEvent];
```

- [ ] **Step 2: Replace in-card `⋯` with external toolbar in the template**

Wrap the card so the toolbar sits outside `.widget-card`:

```vue
<template>
  <div
    class="widget-shell"
    :class="{ 'widget-shell--chrome-open': menuOpen || settingsOpen || renaming }"
  >
    <div
      class="widget-chrome"
      data-interactive
      @pointerdown.stop
    >
      <button
        type="button"
        class="widget-chrome-btn"
        title="Move"
        aria-label="Move widget"
        @pointerdown.stop="onMovePointerDown"
      >
        <!-- move glyph: four-way arrows or grip -->
        ✥
      </button>
      <button
        type="button"
        class="widget-chrome-btn"
        :class="{ 'widget-chrome-btn--active': sticky }"
        title="Sticky"
        aria-label="Toggle sticky"
        :aria-pressed="sticky"
        @click.stop="emit('toggle-sticky')"
      >
        <!-- pin / sticky glyph -->
        📌
      </button>
      <button
        ref="triggerEl"
        type="button"
        class="widget-chrome-btn"
        title="Widget menu"
        aria-label="Widget menu"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click.stop="toggleMenu"
      >
        ⋯
      </button>
    </div>

    <div
      ref="rootEl"
      class="widget-card"
      :class="{
        'widget-card--menu-open': menuOpen || settingsOpen || renaming,
        'widget-card--flush': flush,
        'widget-card--compact': compact,
        'widget-card--flash': flashing,
      }"
    >
      <!-- existing menu / settings / title / body — unchanged, but menu trigger button removed -->
      ...
    </div>
  </div>
</template>
```

Implement:

```ts
/** Forward pointerdown so the host can start a drag from this handle only. */
function onMovePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  emit("move-pointerdown", event);
}
```

Keep `menuEl` / `settingsEl` / `onDocPointerDown` logic; `triggerEl` now points at the Menu chrome button. Include `.widget-chrome` in the “outside click” exclusion when deciding whether to close the menu (clicks on Move/Sticky should close menu; clicks on Menu toggle via `toggleMenu`).

Update `onDocPointerDown` so menu closes when clicking Move/Sticky (they are outside `triggerEl` and `menuEl` — current logic already closes; good).

- [ ] **Step 3: CSS for external chrome**

Add styles (scoped). Key rules:

```css
.widget-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.widget-chrome {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.widget-shell:hover .widget-chrome,
.widget-shell--chrome-open .widget-chrome {
  opacity: 1;
  pointer-events: auto;
}

.widget-chrome-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: rgba(28, 28, 32, var(--surface-opacity, 0.85));
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  line-height: 1;
  font-size: 14px;
}

.widget-chrome-btn[aria-label="Move widget"] {
  cursor: grab;
  touch-action: none;
}

.widget-chrome-btn[aria-label="Move widget"]:active {
  cursor: grabbing;
}

.widget-chrome-btn--active {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
```

Remove obsolete `.widget-menu-trigger` rules (or leave unused — prefer delete).

Flush cards: `.widget-card--flush { overflow: hidden; }` stays on the **card**, not the shell, so the chrome is never clipped.

Replace emoji glyphs with simple inline SVG if the repo already prefers SVG elsewhere in host chrome; otherwise temporary unicode is fine for V1 — match existing `⋯` style.

- [ ] **Step 4: Typecheck**

```powershell
npx vue-tsc --noEmit
```

Expected: errors only about missing parent emit wiring (Task 3) are OK if `WidgetCard` itself typechecks; fix any errors inside `WidgetCard.vue`.

- [ ] **Step 5: Commit**

```bash
git add src/core/host/WidgetCard.vue
git commit -m "feat: external move/sticky/menu chrome on WidgetCard"
```

---

### Task 3: Wire sticky + move through `WidgetInstanceView`

**Files:**
- Modify: `src/core/host/WidgetInstanceView.vue`

**Interfaces:**
- Consumes: `instance.sticky`, card emits
- Produces: forwards `toggle-sticky`, `move-pointerdown` to host

- [ ] **Step 1: Extend emits and template**

```ts
defineEmits<{
  rename: [title: string | undefined];
  "update:hideTitle": [hideTitle: boolean];
  duplicate: [];
  hide: [];
  remove: [];
  "toggle-sticky": [];
  "move-pointerdown": [event: PointerEvent];
}>();
```

On `WidgetCard`:

```vue
  <WidgetCard
    ...
    :sticky="Boolean(instance.sticky)"
    @toggle-sticky="$emit('toggle-sticky')"
    @move-pointerdown="$emit('move-pointerdown', $event)"
    ...
  >
```

- [ ] **Step 2: Commit**

```bash
git add src/core/host/WidgetInstanceView.vue
git commit -m "feat: forward widget chrome sticky and move events"
```

---

### Task 4: Host drag-from-handle + sticky toggle + outside dismiss

**Files:**
- Modify: `src/core/host/WidgetHost.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: `nonStickyVisibleIds`, `hasVisibleStickyInstance` from `layoutLogic`
- Produces:
  - `onToggleSticky(instanceId)`
  - `onWidgetMovePointerDown(event, instanceId)` — drag measure/capture uses `.widget-anchor`
  - Outside dismiss catcher lives in host; soft-hides non-sticky via existing `onHide`; hides window only when no sticky left
  - Whole-card `@pointerdown` drag removed from `.widget-anchor`

- [ ] **Step 1: Import helpers + appearance**

In `WidgetHost.vue` script:

```ts
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppearance } from "../../settings/useAppearance";
import {
  createInstance,
  duplicateInstance,
  hasVisibleStickyInstance,
  loadLayout,
  nonStickyVisibleIds,
  saveLayout,
} from "./layoutLogic";

const { hideOnOutsideClick } = useAppearance();
```

- [ ] **Step 2: Sticky toggle + move drag entry**

```ts
/** Toggle sticky flag and persist. */
function onToggleSticky(instanceId: string) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  if (instance.sticky) {
    delete instance.sticky;
  } else {
    instance.sticky = true;
  }
  persist();
  scheduleRegionSync();
}

/**
 * Start a widget drag from the Move chrome handle.
 * Measure/clamp against the widget-anchor; capture on that anchor.
 */
function onWidgetMovePointerDown(event: PointerEvent, instanceId: string) {
  if (event.button !== 0) return;
  const anchor = (event.target as HTMLElement | null)?.closest(
    ".widget-anchor",
  ) as HTMLElement | null;
  if (!anchor) return;

  const center = centerOf({ kind: "widget", instanceId });
  const { width, height } = anchor.getBoundingClientRect();
  drag = {
    target: { kind: "widget", instanceId },
    grabX: event.clientX - center.x,
    grabY: event.clientY - center.y,
    width,
    height,
    captureEl: anchor,
  };
  anchor.setPointerCapture(event.pointerId);
  setClickThroughPaused(true);
  event.preventDefault();
  event.stopPropagation();
}
```

Keep palette drag on `.palette-handle` via existing `onPointerDown`.

- [ ] **Step 3: Outside dismiss in host**

```ts
/** Soft-hide non-sticky widgets; hide window only when no sticky survivors. */
function onDismissOutside() {
  const ids = nonStickyVisibleIds(instances);
  for (const id of ids) {
    onHide(id);
  }
  if (!hasVisibleStickyInstance(instances)) {
    void getCurrentWindow().hide();
  } else {
    scheduleRegionSync();
  }
}
```

In template, add catcher (z-index under widgets) and wire instance events:

```vue
<div class="widget-host">
  <div
    v-if="hideOnOutsideClick"
    class="dismiss-catcher"
    data-interactive
    aria-hidden="true"
    @pointerdown="onDismissOutside"
  />
  <!-- palette unchanged -->
  <div
    v-for="instance in instances.filter((i) => !i.hidden)"
    :key="instance.instanceId"
    class="widget-anchor"
    :class="{
      'widget-anchor--focused': focusedInstanceId === instance.instanceId,
    }"
    :style="widgetStyle(instance)"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <WidgetInstanceView
      ...
      @toggle-sticky="onToggleSticky(instance.instanceId)"
      @move-pointerdown="onWidgetMovePointerDown($event, instance.instanceId)"
      @hide="onHide(instance.instanceId)"
      ...
    />
  </div>
  <slot name="overlay" />
</div>
```

Critical: **remove** `@pointerdown` on `.widget-anchor` that called `onPointerDown` for widgets. Palette handle keeps its own `@pointerdown`.

- [ ] **Step 4: CSS — no grab on widget body; dismiss catcher**

In `WidgetHost.vue` styles:

```css
.dismiss-catcher {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: auto;
}

.widget-anchor {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  pointer-events: auto;
  cursor: default; /* was grab */
  touch-action: none;
  user-select: none;
}

.widget-anchor:active {
  cursor: default; /* was grabbing — drag handle owns grab cursor */
}
```

Remove `widget-anchor--no-grab` class binding (and related CSS) if nothing else needs it; Notes `grabCursor: false` becomes unnecessary for drag but can remain in manifests harmlessly.

- [ ] **Step 5: Simplify `App.vue`**

Remove `hideOnOutsideClick` dismiss catcher and related watch/import if unused. Keep Esc → `window.hide()`.

`App.vue` template becomes:

```vue
<template>
  <div class="app-shell">
    <WidgetHost>
      <template #center>
        <CommandPalette />
      </template>
      <template #overlay>
        <SettingsModal />
      </template>
    </WidgetHost>
  </div>
</template>
```

Remove `.dismiss-catcher` styles from `App.vue`. Keep `useRegionSync` / settings Esc behavior.

If Settings open should still block outside dismiss: gate inside host:

```ts
import { useSettingsModal } from "../../settings/useSettingsModal";
const { open: settingsOpen } = useSettingsModal();

function onDismissOutside() {
  if (settingsOpen.value) return;
  ...
}
```

- [ ] **Step 6: Typecheck**

```powershell
npx vue-tsc --noEmit
```

Expected: PASS (exit 0)

- [ ] **Step 7: Manual UI checklist**

1. Hover any widget → three icons above the card (not inside).
2. Drag from Move → widget moves; pointerdown on card body → no drag.
3. Toggle Sticky → icon active; reload → still sticky.
4. Enable hide-on-outside-click in Settings → outside click soft-hides non-sticky; sticky stay; window stays if any sticky.
5. Outside click with no sticky → window hides.
6. Esc → window hides even with sticky widgets.
7. Menu icon → same context menu as before; Hide/Remove work on sticky.
8. Spot-check flush widgets (Now Playing, Image, Tado) — chrome not clipped.

- [ ] **Step 8: Commit**

```bash
git add src/core/host/WidgetHost.vue src/App.vue
git commit -m "feat: drag from move handle and sticky outside dismiss"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| External Move / Sticky / Menu above card | Task 2 |
| Hover-only chrome (+ open menu/settings) | Task 2 |
| Remove in-card `⋯` | Task 2 |
| Drag only from Move | Task 4 |
| `sticky` on instance + persist | Task 1 |
| Duplicate copies sticky | Task 1 |
| Outside dismiss soft-hides non-sticky; window if none sticky | Task 4 |
| Esc still hides window | Task 4 / App.vue |
| Hide/Remove still work | unchanged menu + Task 2 trigger |
| All widgets via shared chrome | Tasks 2–4 |
| Flush not clipping chrome | Task 2 (overflow on card only) |
| Click-through / `data-interactive` | Task 2 chrome + Task 4 catcher |

## Placeholder scan

No TBD / “implement later” steps. Glyphs may be unicode or SVG; both acceptable for V1.
