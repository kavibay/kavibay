# Guided Onboarding Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 3-step first-launch coach (palette command → open gallery → add widget) with outline bubbles, dashed hand-drawn arrows, status-bar `Onboarding N/3`, hybrid Skip / Skip tour, and replay.

**Architecture:** Pure onboarding state in `core/app/onboarding/`; a fixed `OnboardingCoach.vue` in the WidgetHost overlay slot; progress label in the palette status bar; advance hooks on palette execute, gallery mount, and non-gallery add. First open no longer auto-spawns Gallery.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript, colocated `*.assert.ts` via `npx tsx`, localStorage persistence.

**Spec:** `docs/superpowers/specs/2026-07-31-guided-onboarding-design.md`

## Global Constraints

- Hybrid advance: real action auto-advances; bubble has **Skip** and **Skip tour**.
- First open: open cockpit only — **do not** call `onAddType("gallery")`.
- Do not auto-start for installs that already have `kavibay:first-open-done` without an onboarding key (replay only).
- Visual: outline-only dashed bubble + dashed wobbly SVG arrow; no dim spotlight.
- Status bar shows `Onboarding N/3` while `status === "active"`.
- Host stays generic; only known exception is treating `typeId === "gallery"` as step-2 target / step-3 exclusion.
- `sdk/` must not import `core/`.
- Do not commit unless the user explicitly asks; commit steps below are optional checkpoints.
- Verify with: relevant `npx tsx …assert.ts`, `npm run build` after FE tasks.

## File map

| File | Responsibility |
|------|----------------|
| `core/app/onboarding/onboardingLogic.ts` | Pure load/save/init/advance/skip/complete/replay + auto-start gate |
| `core/app/onboarding/onboardingLogic.assert.ts` | State-machine asserts |
| `core/app/onboarding/onboardingCopy.ts` | Step titles/bodies for bubbles |
| `core/app/onboarding/onboardingArrow.ts` | Pure SVG path from bubble→target rects |
| `core/app/onboarding/onboardingArrow.assert.ts` | Arrow geometry asserts |
| `core/app/onboarding/useOnboarding.ts` | Reactive state + notify helpers for host/palette |
| `core/app/onboarding/OnboardingCoach.vue` | Bubble + SVG arrow overlay |
| `core/app/App.vue` | Mount coach in `#overlay` |
| `core/app/host/WidgetHost.vue` | First-open change; provide cockpitOpen; notify on add |
| `core/app/palette/CommandPalette.vue` | Targets, status label, execute/replay hooks |
| `core/app/palette/commands.ts` | `replay-onboarding` command |
| `extensions/gallery/GalleryWidget.vue` | `data-onboarding-target="widget-gallery"` |
| `core/app/settings/BehaviorPanel.vue` | Replay button |

---

### Task 1: Onboarding state machine (pure logic)

**Files:**
- Create: `core/app/onboarding/onboardingLogic.ts`
- Create: `core/app/onboarding/onboardingLogic.assert.ts`

**Interfaces:**
- Produces:
  - `ONBOARDING_STORAGE_KEY = "kavibay:onboarding-v1"`
  - `type OnboardingStep = 1 | 2 | 3`
  - `type OnboardingState = { status: "active" | "completed"; step: OnboardingStep }`
  - `defaultActiveState(): OnboardingState` → `{ status: "active", step: 1 }`
  - `parseOnboardingState(raw: string | null): OnboardingState | null`
  - `serializeOnboardingState(state: OnboardingState): string`
  - `shouldAutoStartOnboarding(opts: { firstOpenConsumed: boolean; storedRaw: string | null }): boolean` — true only when `firstOpenConsumed && storedRaw == null`
  - `advanceStep(state: OnboardingState): OnboardingState` — 1→2, 2→3, 3→`{ status: "completed", step: 3 }`
  - `skipTour(state: OnboardingState): OnboardingState` → `{ status: "completed", step: state.step }`
  - `replayOnboarding(): OnboardingState` → `{ status: "active", step: 1 }`
  - `isCoachVisible(state: OnboardingState, cockpitOpen: boolean): boolean` — `status === "active" && cockpitOpen`

- [ ] **Step 1: Write the failing asserts**

Create `onboardingLogic.assert.ts`:

```ts
/**
 * Run: npx tsx core/app/onboarding/onboardingLogic.assert.ts
 */
import assert from "node:assert/strict";
import {
  advanceStep,
  defaultActiveState,
  isCoachVisible,
  parseOnboardingState,
  replayOnboarding,
  serializeOnboardingState,
  shouldAutoStartOnboarding,
  skipTour,
} from "./onboardingLogic";

assert.deepEqual(defaultActiveState(), { status: "active", step: 1 });

assert.equal(parseOnboardingState(null), null);
assert.equal(parseOnboardingState("{"), null);
assert.deepEqual(
  parseOnboardingState(serializeOnboardingState({ status: "active", step: 2 })),
  { status: "active", step: 2 },
);
assert.equal(parseOnboardingState(JSON.stringify({ status: "active", step: 9 })), null);

assert.equal(
  shouldAutoStartOnboarding({ firstOpenConsumed: true, storedRaw: null }),
  true,
);
assert.equal(
  shouldAutoStartOnboarding({ firstOpenConsumed: false, storedRaw: null }),
  false,
);
assert.equal(
  shouldAutoStartOnboarding({
    firstOpenConsumed: true,
    storedRaw: JSON.stringify({ status: "completed", step: 3 }),
  }),
  false,
);

assert.deepEqual(advanceStep({ status: "active", step: 1 }), {
  status: "active",
  step: 2,
});
assert.deepEqual(advanceStep({ status: "active", step: 2 }), {
  status: "active",
  step: 3,
});
assert.deepEqual(advanceStep({ status: "active", step: 3 }), {
  status: "completed",
  step: 3,
});
assert.deepEqual(advanceStep({ status: "completed", step: 3 }), {
  status: "completed",
  step: 3,
});

assert.deepEqual(skipTour({ status: "active", step: 2 }), {
  status: "completed",
  step: 2,
});
assert.deepEqual(replayOnboarding(), { status: "active", step: 1 });

assert.equal(isCoachVisible({ status: "active", step: 1 }, true), true);
assert.equal(isCoachVisible({ status: "active", step: 1 }, false), false);
assert.equal(isCoachVisible({ status: "completed", step: 3 }, true), false);

console.log("onboardingLogic.assert.ts: ok");
```

- [ ] **Step 2: Run asserts — expect FAIL (module missing)**

Run: `npx tsx core/app/onboarding/onboardingLogic.assert.ts`  
Expected: FAIL — cannot find module `./onboardingLogic`.

- [ ] **Step 3: Implement `onboardingLogic.ts`**

```ts
/** localStorage key for guided onboarding progress. */
export const ONBOARDING_STORAGE_KEY = "kavibay:onboarding-v1";

export type OnboardingStep = 1 | 2 | 3;

export type OnboardingState = {
  status: "active" | "completed";
  /** Meaningful while status === "active"; kept on completed for debugging. */
  step: OnboardingStep;
};

/** Fresh tour at step 1. */
export function defaultActiveState(): OnboardingState {
  return { status: "active", step: 1 };
}

/** Parse stored JSON; null if missing/invalid. */
export function parseOnboardingState(raw: string | null): OnboardingState | null {
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    if (parsed.status !== "active" && parsed.status !== "completed") return null;
    if (parsed.step !== 1 && parsed.step !== 2 && parsed.step !== 3) return null;
    return { status: parsed.status, step: parsed.step };
  } catch {
    return null;
  }
}

/** Serialize for localStorage. */
export function serializeOnboardingState(state: OnboardingState): string {
  return JSON.stringify(state);
}

/**
 * Auto-start only on true first open when no onboarding key exists yet.
 * Veterans with first-open-done already set are not forced into the tour.
 */
export function shouldAutoStartOnboarding(opts: {
  firstOpenConsumed: boolean;
  storedRaw: string | null;
}): boolean {
  return opts.firstOpenConsumed && opts.storedRaw == null;
}

/** Advance one step, or complete after step 3. Idempotent when already completed. */
export function advanceStep(state: OnboardingState): OnboardingState {
  if (state.status !== "active") return state;
  if (state.step === 1) return { status: "active", step: 2 };
  if (state.step === 2) return { status: "active", step: 3 };
  return { status: "completed", step: 3 };
}

/** Dismiss the whole tour. */
export function skipTour(state: OnboardingState): OnboardingState {
  return { status: "completed", step: state.step };
}

/** Reset for Replay Onboarding. */
export function replayOnboarding(): OnboardingState {
  return defaultActiveState();
}

/** Coach paints only while the tour is active and the cockpit session is open. */
export function isCoachVisible(
  state: OnboardingState,
  cockpitOpen: boolean,
): boolean {
  return state.status === "active" && cockpitOpen;
}
```

- [ ] **Step 4: Run asserts — expect PASS**

Run: `npx tsx core/app/onboarding/onboardingLogic.assert.ts`  
Expected: `onboardingLogic.assert.ts: ok`

- [ ] **Step 5: Commit (optional — only if user asked)**

```bash
git add core/app/onboarding/onboardingLogic.ts core/app/onboarding/onboardingLogic.assert.ts
git commit -m "feat(onboarding): add pure state machine for guided tour"
```

---

### Task 2: Copy + arrow geometry helpers

**Files:**
- Create: `core/app/onboarding/onboardingCopy.ts`
- Create: `core/app/onboarding/onboardingArrow.ts`
- Create: `core/app/onboarding/onboardingArrow.assert.ts`

**Interfaces:**
- Consumes: `OnboardingStep` from `onboardingLogic.ts`
- Produces:
  - `type OnboardingCopy = { title: string; body: string }`
  - `onboardingCopyForStep(step: OnboardingStep): OnboardingCopy`
  - `type Point = { x: number; y: number }`
  - `type Rect = { left: number; top: number; width: number; height: number }`
  - `arrowPath(from: Point, to: Point): { d: string; tip: string }` — cubic with slight wobble + chevron tip path
  - `bubbleAnchorForTarget(target: Rect, preferred: "above-left" | "left-of"): Point` — place bubble outside target

- [ ] **Step 1: Write arrow asserts**

```ts
/**
 * Run: npx tsx core/app/onboarding/onboardingArrow.assert.ts
 */
import assert from "node:assert/strict";
import { arrowPath, bubbleAnchorForTarget } from "./onboardingArrow";

const path = arrowPath({ x: 10, y: 10 }, { x: 200, y: 80 });
assert.ok(path.d.includes("C"), "cubic curve");
assert.ok(path.tip.length > 0, "tip path present");

const target = { left: 400, top: 300, width: 200, height: 40 };
const aboveLeft = bubbleAnchorForTarget(target, "above-left");
assert.ok(aboveLeft.x < target.left + target.width / 2, "bubble left of center");
assert.ok(aboveLeft.y < target.top, "bubble above target");

console.log("onboardingArrow.assert.ts: ok");
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx tsx core/app/onboarding/onboardingArrow.assert.ts`  
Expected: FAIL — module missing.

- [ ] **Step 3: Implement copy + arrow**

`onboardingCopy.ts`:

```ts
import type { OnboardingStep } from "./onboardingLogic";

export type OnboardingCopy = { title: string; body: string };

const COPY: Record<OnboardingStep, OnboardingCopy> = {
  1: {
    title: "Run a command",
    body: "Type something like notepad and press Enter to open Notes from the palette.",
  },
  2: {
    title: "Open the Widget Gallery",
    body: "Type widget gallery and press Enter — or choose Gallery from the Widgets menu.",
  },
  3: {
    title: "Add a widget",
    body: "Pick any tile in the gallery and click Add — your desk fills up from here.",
  },
};

/** Bubble copy for the active step. */
export function onboardingCopyForStep(step: OnboardingStep): OnboardingCopy {
  return COPY[step];
}
```

`onboardingArrow.ts` — implement a slight cubic wobble (control points offset perpendicular to the chord) and a small open chevron at `to`. `bubbleAnchorForTarget("above-left")` returns roughly `{ x: target.left - 8, y: target.top - 72 }` (caller positions the bubble’s bottom-right / tip region near this point). Keep numbers as named constants at the top of the file.

- [ ] **Step 4: Run asserts — expect PASS**

Run: `npx tsx core/app/onboarding/onboardingArrow.assert.ts`  
Expected: `onboardingArrow.assert.ts: ok`

- [ ] **Step 5: Commit (optional)**

```bash
git add core/app/onboarding/onboardingCopy.ts core/app/onboarding/onboardingArrow.ts core/app/onboarding/onboardingArrow.assert.ts
git commit -m "feat(onboarding): add step copy and dashed arrow geometry"
```

---

### Task 3: `useOnboarding` composable + localStorage I/O

**Files:**
- Create: `core/app/onboarding/useOnboarding.ts`

**Interfaces:**
- Consumes: all Task 1 helpers + `ONBOARDING_STORAGE_KEY`
- Produces singleton-style composable (module-level `ref` so host and palette share state):
  - `useOnboarding()` → `{
      state: Ref<OnboardingState | null>,
      activeStep: ComputedRef<OnboardingStep | null>,
      statusLabel: ComputedRef<string | null>,  // "Onboarding 1/3" or null
      persist(),
      startIfNeeded(firstOpenConsumed: boolean),
      notifyPaletteAction(),
      notifyGalleryVisible(),
      notifyWidgetAdded(typeId: string),
      skipStep(),
      skipTourAction(),
      replay(),
    }`
  - `loadStoredRaw(): string | null` / `writeState(state)` wrap localStorage try/catch

Behavior:
- `startIfNeeded(true)` when `shouldAutoStartOnboarding` → set `defaultActiveState()` and persist.
- `notifyPaletteAction()` — if `status===active && step===1` → `advanceStep` + persist.
- `notifyGalleryVisible()` — if active step 2 → advance (also call when entering step 2 if gallery already mounted — host responsibility).
- `notifyWidgetAdded(typeId)` — if active step 3 and `typeId !== "gallery"` → `advanceStep` (completes).
- `skipStep()` → `advanceStep`; `skipTourAction()` → `skipTour`; `replay()` → `replayOnboarding()`.
- `statusLabel` = `state.status==="active" ? \`Onboarding ${state.step}/3\` : null`

- [ ] **Step 1: Implement composable**

Keep it thin — no DOM. Callers pass events in.

- [ ] **Step 2: Smoke via a tiny assert importing advance paths through a mock storage map** (optional inline in `onboardingLogic.assert` already covers pure paths; composable can stay unasserted if it only wraps Task 1 — prefer not duplicating). No new assert file required if composable is a thin wrapper.

- [ ] **Step 3: Commit (optional)**

```bash
git add core/app/onboarding/useOnboarding.ts
git commit -m "feat(onboarding): add shared useOnboarding composable"
```

---

### Task 4: First-open — drop Gallery auto-spawn, start tour

**Files:**
- Modify: `core/app/host/WidgetHost.vue` (around the `consumeFirstOpen` block ~1265–1270)
- Modify: `core/app/host/layoutLogic.firstOpen.assert.ts` only if comments/docs claim gallery spawn (do not change `consumeFirstOpen` semantics)

**Interfaces:**
- Consumes: `useOnboarding().startIfNeeded`
- Produces: first open opens cockpit only; onboarding key written when auto-start applies

- [ ] **Step 1: Change first-open block**

Replace:

```ts
  if (consumeFirstOpen()) {
    onPaletteHotkey(true);
    onAddType("gallery");
  }
```

With:

```ts
  if (consumeFirstOpen()) {
    onPaletteHotkey(true);
    // Guided tour replaces auto-spawned Gallery (see onboarding design 2026-07-31).
    useOnboarding().startIfNeeded(true);
  }
```

Import `useOnboarding` at top of script.

Also **provide** cockpit openness for the coach:

```ts
provide("kavibayCockpitOpen", cockpitOpen);
```

(`cockpitOpen` is already a `ref` in WidgetHost.)

- [ ] **Step 2: In `onAddType`, after a successful create, notify onboarding**

Near the end of `onAddType` (after persist), add:

```ts
  useOnboarding().notifyWidgetAdded(typeId);
  if (typeId === "gallery") useOnboarding().notifyGalleryVisible();
```

- [ ] **Step 3: When step becomes 2, if gallery already mounted, auto-advance**

In `useOnboarding` or a small `watch` in the coach/host: after advancing to step 2, if any mounted instance has `typeId === "gallery"`, call `notifyGalleryVisible()` again. Implement this watch inside `OnboardingCoach` or `useOnboarding` accepting an injected `galleryMounted: ComputedRef<boolean>` from host later in Task 5 — for this task, at least call `notifyGalleryVisible()` from `onAddType("gallery")` / focus reveal paths.

Also hook `onRevealWidget` / `onFocusWidget` when `typeId === "gallery"`:

```ts
  if (getExtension(instance.typeId)?.id === "gallery" || instance.typeId === "gallery") {
    useOnboarding().notifyGalleryVisible();
  }
```

Use `instance.typeId === "gallery"` only (no need for getExtension).

- [ ] **Step 4: Typecheck**

Run: `npm run build`  
Expected: green (or only pre-existing warnings).

- [ ] **Step 5: Commit (optional)**

```bash
git add core/app/host/WidgetHost.vue
git commit -m "feat(onboarding): start tour on first open instead of auto Gallery"
```

---

### Task 5: `OnboardingCoach.vue` + mount in App overlay

**Files:**
- Create: `core/app/onboarding/OnboardingCoach.vue`
- Modify: `core/app/App.vue`

**Interfaces:**
- Consumes: `useOnboarding`, `onboardingCopyForStep`, `arrowPath`, `isCoachVisible`, inject `kavibayCockpitOpen`
- Produces: fixed overlay with outline bubble + dashed SVG arrow; Skip / Skip tour buttons

- [ ] **Step 1: Implement coach component**

Sketch:

```vue
<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, type Ref, watch } from "vue";
import { arrowPath } from "./onboardingArrow";
import { onboardingCopyForStep } from "./onboardingCopy";
import { isCoachVisible } from "./onboardingLogic";
import { useOnboarding } from "./useOnboarding";

const cockpitOpen = inject<Ref<boolean>>("kavibayCockpitOpen", ref(false));
const { state, skipStep, skipTourAction } = useOnboarding();

const visible = computed(
  () => state.value != null && isCoachVisible(state.value, cockpitOpen.value),
);
const copy = computed(() =>
  state.value?.status === "active"
    ? onboardingCopyForStep(state.value.step)
    : null,
);

const bubbleStyle = ref<Record<string, string>>({});
const pathD = ref("");
const tipD = ref("");

function resolveTarget(): Element | null {
  const step = state.value?.step;
  if (step === 1 || step === 2) {
    return document.querySelector('[data-onboarding-target="palette-search"]');
  }
  return (
    document.querySelector('[data-onboarding-target="widget-gallery"]') ??
    document.querySelector('[data-onboarding-target="widgets-button"]')
  );
}

function layout() {
  // Measure target + place bubble outside palette; set bubbleStyle + pathD/tipD via arrowPath.
}

watch([visible, () => state.value?.step, cockpitOpen], async () => {
  await nextTick();
  layout();
});

onMounted(() => {
  window.addEventListener("resize", layout);
  layout();
});
onUnmounted(() => window.removeEventListener("resize", layout));
</script>

<template>
  <div
    v-if="visible && copy"
    class="onboarding-coach"
    aria-live="polite"
  >
    <svg class="onboarding-arrow" aria-hidden="true">
      <path :d="pathD" class="onboarding-arrow-stroke" />
      <path :d="tipD" class="onboarding-arrow-stroke" />
    </svg>
    <div
      class="onboarding-bubble"
      data-interactive
      :style="bubbleStyle"
    >
      <p class="onboarding-bubble-title">{{ copy.title }}</p>
      <p class="onboarding-bubble-body">{{ copy.body }}</p>
      <div class="onboarding-bubble-actions">
        <button type="button" class="onboarding-link" @click="skipStep">Skip</button>
        <button type="button" class="onboarding-link" @click="skipTourAction">Skip tour</button>
      </div>
    </div>
  </div>
</template>
```

Styles (scoped):
- `.onboarding-coach` — `position: fixed; inset: 0; z-index: 400; pointer-events: none;`
- `.onboarding-bubble` — `pointer-events: auto; background: transparent; border: 1.5px dashed rgba(var(--fg-rgb), 0.55); border-radius: 10px; padding: 10px 12px; max-width: 220px; color: rgba(var(--fg-rgb), 0.92);`
- `.onboarding-arrow` — full-size SVG, `pointer-events: none`
- `.onboarding-arrow-stroke` — `fill: none; stroke: rgba(var(--fg-rgb), 0.7); stroke-width: 1.8; stroke-dasharray: 3 4; stroke-linecap: round;`
- Link buttons: quiet text, no heavy chrome

Position the bubble for steps 1–2 roughly above-left of the search input (outside the palette card). For step 3, left of the gallery card when present.

- [ ] **Step 2: Mount in App.vue overlay**

```vue
<template #overlay>
  <SettingsModal />
  <OnboardingCoach />
</template>
```

Import `OnboardingCoach`.

- [ ] **Step 3: `npm run build`** — expect green.

- [ ] **Step 4: Commit (optional)**

```bash
git add core/app/onboarding/OnboardingCoach.vue core/app/App.vue
git commit -m "feat(onboarding): add outline coach overlay with Skip controls"
```

---

### Task 6: Palette targets, status label, execute + replay hooks

**Files:**
- Modify: `core/app/palette/commands.ts`
- Modify: `core/app/palette/CommandPalette.vue`

**Interfaces:**
- Consumes: `useOnboarding().notifyPaletteAction`, `replay`, `statusLabel`
- Produces: search input + Widgets button data attributes; status-bar label; replay command

- [ ] **Step 1: Add command**

In `commands.ts`, append:

```ts
  {
    id: "replay-onboarding",
    title: "Replay Onboarding",
    subtitle: "Show the 3-step getting-started tour again",
    keywords: ["onboarding", "tour", "tutorial", "guide", "replay"],
  },
```

- [ ] **Step 2: Mark targets on the search input and Widgets button**

On the main `<input class="palette-input" …>` add `data-onboarding-target="palette-search"`.  
On the Widgets `<button class="palette-bar-btn--widgets" …>` add `data-onboarding-target="widgets-button"`.

- [ ] **Step 3: Status bar label**

In `.palette-statusbar-left`, after the Widgets button (or at end of left cluster), add:

```vue
<span
  v-if="onboardingLabel"
  class="palette-onboarding-label"
  aria-live="polite"
>{{ onboardingLabel }}</span>
```

```ts
const { statusLabel: onboardingLabelRef, notifyPaletteAction, replay } = useOnboarding();
const onboardingLabel = onboardingLabelRef; // or computed(() => onboardingLabelRef.value)
```

Style: small muted text matching bar (`font-size: 11px; color: rgba(var(--fg-rgb), 0.45);`).

- [ ] **Step 4: Hook execute path**

At the **start** of successful branches in the palette select/execute function (after an action is accepted — app launch success, command handled, widget toggled/focused), call `notifyPaletteAction()` once. Practical approach: call it once at the top of the handler after you’ve committed to handling a row (not on no-op), or at the end of each successful branch. Prefer a single helper:

```ts
function afterPaletteAction() {
  notifyPaletteAction();
}
```

Call from: successful `launch_path`, `open-settings`, `open-gallery`, `toggle-dark-mode`, `new-note`, prefix searches, `execute_action`, and widget type row focus/add paths.

For `replay-onboarding`:

```ts
  if (row.commandId === "replay-onboarding") {
    rememberCommand();
    replay();
    void openCockpitIfNeeded(); // emit palette:show / inject open if available
    query.value = "";
    selectedIndex.value = 0;
    return;
  }
```

If cockpit is already open, `replay()` alone is enough; also `emit("palette:show")` or call existing open path so the coach shows.

- [ ] **Step 5: Gallery command already opens gallery — `notifyGalleryVisible` comes from host Task 4 when gallery mounts. Still call `notifyPaletteAction()` on `open-gallery` so step 1 can complete if they jump straight to gallery from step 1** (step 1 completes; then host gallery notify completes step 2 on same action — ensure order: palette action first advances 1→2, then gallery visible advances 2→3). That would skip teaching step 2 visually in one keystroke — **acceptable**: they opened the gallery, which is step 2’s goal. Order in `openGallery()`:

```ts
  rememberCommand();
  notifyPaletteAction(); // may 1→2
  await runTypeRow(...); // host notifies gallery → may 2→3
```

- [ ] **Step 6: `npm run build`** — expect green.

- [ ] **Step 7: Commit (optional)**

```bash
git add core/app/palette/commands.ts core/app/palette/CommandPalette.vue
git commit -m "feat(onboarding): wire palette targets, progress label, and replay command"
```

---

### Task 7: Gallery target attribute + Settings replay

**Files:**
- Modify: `extensions/gallery/GalleryWidget.vue`
- Modify: `core/app/settings/BehaviorPanel.vue`

**Interfaces:**
- Consumes: `useOnboarding().replay`
- Produces: gallery root anchor; Behavior settings button

- [ ] **Step 1: Gallery root**

On the root `.gallery-root` div:

```vue
<div class="gallery-root" data-onboarding-target="widget-gallery">
```

- [ ] **Step 2: Behavior panel button**

Below the Developer Extensions checkbox block, add:

```vue
<div class="behavior-section">
  <span class="behavior-section-title">Onboarding</span>
  <p class="behavior-section-hint">
    Replay the 3-step getting-started tour (palette → gallery → add a widget).
  </p>
  <button type="button" class="behavior-button" @click="onReplayOnboarding">
    Replay onboarding
  </button>
</div>
```

```ts
import { useOnboarding } from "../core/onboarding/useOnboarding";
import { emit } from "@tauri-apps/api/event"; // only if already used; else inject show path

const { replay } = useOnboarding();

function onReplayOnboarding() {
  replay();
  void emit("palette:show"); // opens cockpit; coach becomes visible
}
```

Reuse existing button styles from BehaviorPanel if a `.behavior-button` / option button pattern exists; otherwise mirror `.behavior-option` as a single action button (border, muted text).

- [ ] **Step 3: `npm run build`** — expect green.

- [ ] **Step 4: Commit (optional)**

```bash
git add extensions/gallery/GalleryWidget.vue core/app/settings/BehaviorPanel.vue
git commit -m "feat(onboarding): gallery target attr and Settings replay control"
```

---

### Task 8: Verify + manual smoke

**Files:** none new

- [ ] **Step 1: Run all new asserts**

```bash
npx tsx core/app/onboarding/onboardingLogic.assert.ts
npx tsx core/app/onboarding/onboardingArrow.assert.ts
npm run build
```

Expected: all ok / green.

- [ ] **Step 2: Manual smoke (Windows `npm run tauri dev`)**

Checklist:
1. Clear `kavibay:onboarding-v1` and `kavibay:first-open-done` from app localStorage (or wipe WebView localStorage) → first launch shows palette + step 1 bubble/arrow, **no** Gallery.
2. Status bar shows `Onboarding 1/3`.
3. Type `notepad` / New Note → step advances to 2.
4. Type `widget gallery` → Gallery opens, step 3.
5. Add any widget from gallery → tour completes; label gone.
6. Replay from palette command and from Settings → step 1 returns.
7. Skip and Skip tour work; cockpit close mid-tour hides coach; reopen restores current step.

- [ ] **Step 3: Mark spec implemented** (when smoke passes)

In `docs/superpowers/specs/2026-07-31-guided-onboarding-design.md`, set `Status: Implemented` and add a one-line completion note.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Hybrid Skip / Skip tour / auto-advance | 1, 5, 6 |
| First launch + replay | 4, 6, 7 |
| No auto Gallery on first open | 4 |
| Outline bubble + dashed arrow | 2, 5 |
| Status `Onboarding N/3` | 3, 6 |
| Step copy | 2 |
| Targets `data-onboarding-target` | 6, 7 |
| Gallery mount / non-gallery add hooks | 4 |
| Existing installs not forced | 1 (`shouldAutoStartOnboarding`) |
| Mid-tour cockpit hide | 1 (`isCoachVisible`) + 5 |
| Settings + command replay | 6, 7 |
| Assert tests | 1, 2, 8 |

No placeholders remaining. Types (`OnboardingState`, `OnboardingStep`) are consistent across tasks.
