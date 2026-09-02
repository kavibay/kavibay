# Widget Grid Snap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Behavior setting to switch widget layout between free-hand (default) and live 15px invisible grid snap for move and resize.

**Architecture:** Persist `widgetLayoutMode: "freehand" | "grid"` in `kavibay:appearance-v1`. Pure snap helpers convert center-anchored geometry to a top-left box, snap to `GRID_GAP`, and convert back. `WidgetHost` applies snap only during active move/resize when mode is `grid`; toggling the setting does not relocate widgets.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript, existing `appearanceLogic` / `useAppearance` / `BehaviorPanel` patterns, colocated `*.assert.ts` (no vitest).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-widget-grid-snap-design.md`
- Modes: `"freehand"` | `"grid"`; default `"freehand"`
- Grid gap: `5` px constant; invisible; not exposed in UI
- Snap during gesture only — never on setting change
- Snap both move (position) and resize (size + position)
- Screen-pixel grid via top-left box (not center-only)
- Settings UI: Behavior panel (segmented options like Open on)
- Persist key: `kavibay:appearance-v1`
- Live-apply, no Save button
- Pure helpers: `npx tsx core/app/host/gridSnap.assert.ts` and `npx tsx core/app/settings/appearanceLogic.assert.ts`
- Typecheck/build: `npm run build`
- Skip git commits unless the user explicitly asks
- No visible overlay, no configurable gap, no sibling magnets

## File Structure

| File | Responsibility |
|------|----------------|
| `core/app/host/gridSnap.ts` | `GRID_GAP`, `snapValue`, `snapPosition`, `snapBox` |
| `core/app/host/gridSnap.assert.ts` | Pure snap math asserts |
| `core/app/settings/appearanceLogic.ts` | `WidgetLayoutMode` type, options, normalize, `AppearanceState` field |
| `core/app/settings/appearanceLogic.assert.ts` | Normalize / default asserts for the new field |
| `core/app/settings/useAppearance.ts` | `widgetLayoutMode` ref + `setWidgetLayoutMode` |
| `core/app/settings/BehaviorPanel.vue` | Free-hand / Snap to grid control |
| `core/app/host/WidgetHost.vue` | Call snap in move + resize paths when mode is `grid` |

---

### Task 1: Pure grid snap helpers

**Files:**
- Create: `core/app/host/gridSnap.ts`
- Create: `core/app/host/gridSnap.assert.ts`

**Interfaces:**
- Produces:
  - `export const GRID_GAP = 5`
  - `export interface SnapBox { x: number; y: number; width: number; height: number }`
  - `export function snapValue(n: number, gap?: number): number` — nearest multiple of `gap` (default `GRID_GAP`); use `Math.round(n / gap) * gap`; if `gap <= 0`, return `n` unchanged
  - `export function snapBox(box: SnapBox, gap?: number): SnapBox` — snap `x`, `y`, `width`, `height` independently
  - `export function snapPosition(center: { x: number; y: number }, size: { width: number; height: number }, gap?: number): { x: number; y: number }` — snap top-left of the box, **keep size**, return new center (for move)

- [ ] **Step 1: Write failing asserts**

Create `core/app/host/gridSnap.assert.ts`:

```ts
/**
 * Quick assert for invisible grid snap math.
 * Run: npx tsx core/app/host/gridSnap.assert.ts
 */
import { GRID_GAP, snapBox, snapPosition, snapValue } from "./gridSnap";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(GRID_GAP === 5, "gap is 5");

assert(snapValue(0) === 0, "0 stays 0");
assert(snapValue(5) === 5, "already on grid");
assert(snapValue(7) === 5, "7 → 5");
assert(snapValue(8) === 10, "8 → 10 (midpoint up)");
assert(snapValue(-3) === -5, "negative rounds to nearest");
assert(snapValue(12, 10) === 10, "custom gap");

{
  const b = snapBox({ x: 12, y: 7, width: 203, height: 98 });
  assert(b.x === 10 && b.y === 5, "box origin");
  assert(b.width === 205 && b.height === 100, "box size");
}

{
  // Center (103, 54) + size 200×100 → top-left (3, 4) → snap (5, 5) → center (105, 55)
  const c = snapPosition({ x: 103, y: 54 }, { width: 200, height: 100 });
  assert(c.x === 105 && c.y === 55, "move snaps top-left, keeps size");
}

console.log("gridSnap.assert.ts: ok");
```

- [ ] **Step 2: Run asserts — expect FAIL**

Run: `npx tsx core/app/host/gridSnap.assert.ts`  
Expected: FAIL (module not found / cannot resolve `./gridSnap`)

- [ ] **Step 3: Implement `gridSnap.ts`**

Create `core/app/host/gridSnap.ts`:

```ts
/** Invisible layout grid gap in CSS pixels (Behavior → Snap to grid). */
export const GRID_GAP = 5;

export interface SnapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Snap a scalar to the nearest multiple of `gap` (default `GRID_GAP`). */
export function snapValue(n: number, gap: number = GRID_GAP): number {
  if (!(gap > 0) || !Number.isFinite(n)) return n;
  return Math.round(n / gap) * gap;
}

/** Snap top-left + size to the grid. */
export function snapBox(box: SnapBox, gap: number = GRID_GAP): SnapBox {
  return {
    x: snapValue(box.x, gap),
    y: snapValue(box.y, gap),
    width: snapValue(box.width, gap),
    height: snapValue(box.height, gap),
  };
}

/**
 * Snap a center-anchored box's top-left to the grid without changing size.
 * Used during move so widgets translate onto the grid without resizing.
 */
export function snapPosition(
  center: { x: number; y: number },
  size: { width: number; height: number },
  gap: number = GRID_GAP,
): { x: number; y: number } {
  const left = snapValue(center.x - size.width / 2, gap);
  const top = snapValue(center.y - size.height / 2, gap);
  return {
    x: left + size.width / 2,
    y: top + size.height / 2,
  };
}
```

- [ ] **Step 4: Run asserts — expect PASS**

Run: `npx tsx core/app/host/gridSnap.assert.ts`  
Expected: `gridSnap.assert.ts: ok`

---

### Task 2: Persist `widgetLayoutMode` + Behavior UI

**Files:**
- Modify: `core/app/settings/appearanceLogic.ts`
- Modify: `core/app/settings/appearanceLogic.assert.ts`
- Modify: `core/app/settings/useAppearance.ts`
- Modify: `core/app/settings/BehaviorPanel.vue`

**Interfaces:**
- Consumes: none from Task 1 (setting is independent)
- Produces:
  - `export type WidgetLayoutMode = "freehand" | "grid"`
  - `export const DEFAULT_WIDGET_LAYOUT_MODE: WidgetLayoutMode = "freehand"`
  - `export const WIDGET_LAYOUT_MODE_OPTIONS: { id: WidgetLayoutMode; name: string; hint: string }[]`
  - `normalizeWidgetLayoutMode(raw: unknown): WidgetLayoutMode`
  - `AppearanceState.widgetLayoutMode: WidgetLayoutMode`
  - `useAppearance()` → `widgetLayoutMode`, `setWidgetLayoutMode(mode: WidgetLayoutMode)`

- [ ] **Step 1: Extend asserts for the new field**

Append to `core/app/settings/appearanceLogic.assert.ts` (keep existing asserts; add imports):

```ts
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  normalizeColorMode,
  normalizeWidgetLayoutMode,
  toggleColorModeValue,
} from "./appearanceLogic";

// ... existing asserts ...

assert(normalizeWidgetLayoutMode("freehand") === "freehand", "accept freehand");
assert(normalizeWidgetLayoutMode("grid") === "grid", "accept grid");
assert(normalizeWidgetLayoutMode("nope") === "freehand", "unknown → freehand");
assert(normalizeWidgetLayoutMode(undefined) === "freehand", "missing → freehand");
assert(DEFAULT_APPEARANCE.widgetLayoutMode === "freehand", "default freehand");
assert(
  normalizeAppearance({}).widgetLayoutMode === "freehand",
  "empty object → freehand",
);
assert(
  normalizeAppearance({ widgetLayoutMode: "grid" }).widgetLayoutMode === "grid",
  "preserve grid",
);
```

- [ ] **Step 2: Run asserts — expect FAIL**

Run: `npx tsx core/app/settings/appearanceLogic.assert.ts`  
Expected: FAIL (`normalizeWidgetLayoutMode` / `widgetLayoutMode` missing)

- [ ] **Step 3: Add type + normalize + state field in `appearanceLogic.ts`**

Near other exported types (after `OpenMonitor`):

```ts
/** How widgets move/resize on the desk. */
export type WidgetLayoutMode = "freehand" | "grid";

export const DEFAULT_WIDGET_LAYOUT_MODE: WidgetLayoutMode = "freehand";

export const WIDGET_LAYOUT_MODE_OPTIONS: {
  id: WidgetLayoutMode;
  name: string;
  hint: string;
}[] = [
  {
    id: "freehand",
    name: "Free-hand",
    hint: "Pixel-exact position and size while dragging",
  },
  {
    id: "grid",
    name: "Snap to grid",
    hint: "Snap position and size to an invisible 5px grid while dragging",
  },
];
```

Add to `AppearanceState`:

```ts
/** Free-hand vs snap-to-grid while moving/resizing widgets. */
widgetLayoutMode: WidgetLayoutMode;
```

Add to `DEFAULT_APPEARANCE`:

```ts
widgetLayoutMode: DEFAULT_WIDGET_LAYOUT_MODE,
```

Add normalize helper:

```ts
/** Normalize layout mode; unknown / missing → freehand. */
export function normalizeWidgetLayoutMode(raw: unknown): WidgetLayoutMode {
  return raw === "grid" ? "grid" : "freehand";
}
```

In `normalizeAppearance` return object, add:

```ts
widgetLayoutMode:
  o.widgetLayoutMode === undefined
    ? DEFAULT_WIDGET_LAYOUT_MODE
    : normalizeWidgetLayoutMode(o.widgetLayoutMode),
```

- [ ] **Step 4: Wire `useAppearance.ts`**

Import `type WidgetLayoutMode` and `normalizeWidgetLayoutMode`.

Add ref:

```ts
const widgetLayoutMode: Ref<WidgetLayoutMode> = ref(initial.widgetLayoutMode);
```

Include in `persist()` state object:

```ts
widgetLayoutMode: widgetLayoutMode.value,
```

Add setter inside `useAppearance()`:

```ts
/** Live-apply + persist free-hand vs snap-to-grid. */
function setWidgetLayoutMode(mode: WidgetLayoutMode) {
  widgetLayoutMode.value = normalizeWidgetLayoutMode(mode);
  persist();
}
```

Export `widgetLayoutMode` and `setWidgetLayoutMode` from the return object.

- [ ] **Step 5: Behavior panel UI**

In `BehaviorPanel.vue` script:

```ts
import {
  OPEN_MONITOR_OPTIONS,
  WIDGET_LAYOUT_MODE_OPTIONS,
  type OpenMonitor,
  type WidgetLayoutMode,
} from "./appearanceLogic";

const {
  hideOnOutsideClick,
  openMonitor,
  widgetLayoutMode,
  setHideOnOutsideClick,
  setOpenMonitor,
  setWidgetLayoutMode,
} = useAppearance();

/** Select free-hand vs snap-to-grid layout mode. */
function onWidgetLayoutMode(mode: WidgetLayoutMode) {
  setWidgetLayoutMode(mode);
}
```

In template, add a section **above** the “Open on” block (reuse existing `.behavior-section` / `.behavior-option` styles):

```vue
    <div class="behavior-section">
      <span class="behavior-section-title">Widget layout</span>
      <p class="behavior-section-hint">
        How widgets move and resize on the desk. Switching mode does not move
        existing widgets until you drag them again.
      </p>
      <div class="behavior-options" role="listbox" aria-label="Widget layout">
        <button
          v-for="opt in WIDGET_LAYOUT_MODE_OPTIONS"
          :key="opt.id"
          type="button"
          class="behavior-option"
          role="option"
          :aria-selected="widgetLayoutMode === opt.id"
          :class="{ 'behavior-option--active': widgetLayoutMode === opt.id }"
          @click="onWidgetLayoutMode(opt.id)"
        >
          <span class="behavior-option-name">{{ opt.name }}</span>
          <span class="behavior-option-hint">{{ opt.hint }}</span>
        </button>
      </div>
    </div>
```

- [ ] **Step 6: Run asserts — expect PASS**

Run: `npx tsx core/app/settings/appearanceLogic.assert.ts`  
Expected: `appearanceLogic.assert.ts: all passed`

---

### Task 3: Snap during move in `WidgetHost`

**Files:**
- Modify: `core/app/host/WidgetHost.vue`

**Interfaces:**
- Consumes: `snapPosition` from `./gridSnap`; `widgetLayoutMode` from `useAppearance()`
- Produces: move path snaps screen center when mode is `grid`

- [ ] **Step 1: Import snap + read mode**

Near existing imports / `useAppearance()`:

```ts
import { snapBox, snapPosition } from "./gridSnap";

const { hideOnOutsideClick, widgetLayoutMode } = useAppearance();
```

(`snapBox` is used in Task 4; import both now to avoid a second import edit.)

- [ ] **Step 2: Apply snap after clamp in `onPointerMove`**

Replace the start of `onPointerMove` so clamped center is optionally snapped **before** writing palette/instance state. Keep all four move branches (palette group / palette alone / widget group / widget alone) unchanged except they consume the (possibly snapped) `cx`/`cy`:

```ts
function onPointerMove(event: PointerEvent) {
  if (!drag) return;

  const { width, height } = drag;
  let cx = clamp(event.clientX - drag.grabX, width / 2, window.innerWidth - width / 2);
  let cy = clamp(event.clientY - drag.grabY, height / 2, window.innerHeight - height / 2);

  if (widgetLayoutMode.value === "grid") {
    const snapped = snapPosition({ x: cx, y: cy }, { width, height });
    cx = snapped.x;
    cy = snapped.y;
  }

  // ... existing palette / widget branches unchanged ...
}
```

Do **not** persist on move (still drop-only). Do **not** snap when mode is `freehand`.

- [ ] **Step 3: Manual smoke (move)**

Run app (`npm run tauri dev` if available). In Settings → Behavior:

1. Leave **Free-hand** — drag a widget; position stays pixel-exact  
2. Switch to **Snap to grid** — widgets must **not** jump until dragged  
3. Drag a widget — position settles on 5px grid (top-left aligned)  
4. Ctrl/Cmd group-move still translates the layout  

---

### Task 4: Snap during resize in `WidgetHost`

**Files:**
- Modify: `core/app/host/WidgetHost.vue` (`onResizeInstance`)

**Interfaces:**
- Consumes: `snapBox` from `./gridSnap`; `widgetLayoutMode`; existing `resizeStartOffset` / `applyResizeDelta` payload
- Produces: resize path snaps size + center when mode is `grid`

- [ ] **Step 1: Snap geometry inside `onResizeInstance`**

After resolving `resizeStartOffset` and before writing instance fields, when mode is `grid`, convert the would-be center+size to a box, `snapBox`, then write snapped size/offset. Keep hugHeight / contentScale behavior.

Replace the size/offset assignment block with:

```ts
  let nextWidth = payload.width;
  let nextHeight = payload.height;
  let nextOffset = {
    x: resizeStartOffset.x + payload.deltaOffset.x,
    y: resizeStartOffset.y + payload.deltaOffset.y,
  };

  if (widgetLayoutMode.value === "grid") {
    const center = {
      x: palettePos.x + nextOffset.x,
      y: palettePos.y + nextOffset.y,
    };
    const box = snapBox({
      x: center.x - nextWidth / 2,
      y: center.y - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
    });
    // Avoid zero/negative sizes from aggressive snap; floor at 1px then host CSS still clamps.
    nextWidth = Math.max(1, box.width);
    nextHeight = Math.max(1, box.height);
    nextOffset = {
      x: box.x + nextWidth / 2 - palettePos.x,
      y: box.y + nextHeight / 2 - palettePos.y,
    };
  }

  instance.width = nextWidth;
  const def = defFor(instance.typeId);
  if (def?.hugHeight) {
    delete instance.height;
  } else {
    instance.height = nextHeight;
  }
  if (typeof payload.contentScale === "number") {
    instance.contentScale = payload.contentScale;
  }
  instance.offset = nextOffset;
  persist();
```

Notes:

- ResizeEdges already runs `clampSize` before emit; snap may nudge size — `Math.max(1, …)` is a safety floor only.
- hugHeight: still delete `height` after snap (width + offset snap remain).
- Palette resize (`onResizePalette`) stays free-hand for this plan (widget-focused).

- [ ] **Step 2: Manual smoke (resize)**

With **Snap to grid** on: resize a normal widget — width/height land on multiples of 5 and edges stay grid-aligned. With **Free-hand**: pixel-exact again. Switching mode mid-desk does not jump sizes until the next resize.

---

### Task 5: Verification

**Files:** none new

- [ ] **Step 1: Run pure asserts**

```bash
npx tsx core/app/host/gridSnap.assert.ts
npx tsx core/app/settings/appearanceLogic.assert.ts
```

Expected: both print ok / all passed

- [ ] **Step 2: Typecheck + build**

```bash
npm run build
```

Expected: exit 0

- [ ] **Step 3: Final manual checklist**

- [ ] Behavior shows Free-hand (default) and Snap to grid  
- [ ] Free-hand move + resize pixel-exact  
- [ ] Grid move snaps position; grid resize snaps size + position  
- [ ] Toggling mode does not relocate widgets until next gesture  
- [ ] Ctrl/Cmd group-move still works in both modes  
- [ ] Setting survives reload (`kavibay:appearance-v1`)

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `freehand` / `grid` modes, default freehand | Task 2 |
| 5px invisible gap constant | Task 1 |
| Snap move + resize | Tasks 3–4 |
| Snap only during gesture | Tasks 3–4 (no snap on setter) |
| Behavior panel UI | Task 2 |
| Persist in appearance-v1 | Task 2 |
| Top-left box math (not center-only) | Task 1 (`snapPosition` / `snapBox`) |
| Pure asserts + build | Tasks 1, 2, 5 |
| Out of scope (overlay, gap UI, magnets, snap-on-toggle) | Not implemented |

No placeholders. Types/names consistent: `WidgetLayoutMode`, `widgetLayoutMode`, `setWidgetLayoutMode`, `GRID_GAP`, `snapValue` / `snapBox` / `snapPosition`.
