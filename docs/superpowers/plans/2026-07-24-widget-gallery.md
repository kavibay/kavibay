# Widget Gallery + defaultSize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add required `ui.defaultSize` to first-party extensions and a host-owned 1×3 video gallery (notes / pomodoro / moodist) for onboarding and permanent widget picking.

**Architecture:** Extend the MIT SDK manifest types and loader validation. Resolve initial instance size in a pure helper used by `WidgetHost.onAddType`. Discover `extensions/*/intro.mp4` via Vite glob; pure membership helper joins registry ∩ videos. Gallery is a Settings-like shared modal (`useWidgetGallery`) + panel overlay — not a desk widget.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript, Vite `import.meta.glob`, existing palette/host provides, colocated `*.assert.ts` (no vitest).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-24-widget-gallery-design.md`
- `defaultSize: { w, h }` = CSS pixels (not grid cells)
- Gallery = host UI only (not `extensions/gallery/`)
- No live demo / `demoData` / `mode` flag
- Video convention: `extensions/<id>/intro.mp4`
- Layout v1: CSS `grid-template-columns: repeat(3, 1fr)` — one row
- Playback: autoplay muted loop `playsinline`; hover lift + Add button; sound always off
- Missing video → omit from gallery (no placeholders)
- `hugHeight`: apply only `w` on create; skip `h`
- Playground: use `defaultSize` instead of hardcoded `220×220`; keep playground resize behavior
- Runtime packages: `defaultSize` optional; gallery ignores them
- Assets already present (untracked): `extensions/{notes,pomodoro,moodist}/intro.mp4` — commit them with the gallery task
- Pure asserts: `npx tsx <path>`
- Typecheck: `npm run build`
- Skip git commits unless the user explicitly asks
- Do not discard unrelated WIP in `WidgetHost.vue` / `layoutLogic.ts` / desks — only add gallery/`defaultSize` changes

## File Structure

| File | Responsibility |
|------|----------------|
| `sdk/extension/types.ts` | `WidgetSize`, `defaultSize` on manifest + registered |
| `core/app/extensions/loadExtensions.ts` | Validate + merge `defaultSize` |
| `core/app/extensions/initialSize.ts` | Pure `initialSizeForExtension` |
| `core/app/extensions/initialSize.assert.ts` | Size resolution asserts |
| `core/app/host/WidgetHost.vue` | Apply size on add; mount gallery; first-open |
| `core/app/runtime/runtimeTypes.ts` | Optional `defaultSize?` on `HostExtensionRef` |
| `core/app/runtime/useRuntimeExtensions.ts` | Pass through / omit for runtime |
| `extensions/*/manifest.json` | Backfill `ui.defaultSize` (all 27) |
| `core/app/gallery/galleryLogic.ts` | Membership join + folder→id |
| `core/app/gallery/galleryLogic.assert.ts` | Membership asserts |
| `core/app/gallery/introVideos.ts` | Vite glob of `intro.mp4` |
| `core/app/gallery/useWidgetGallery.ts` | Shared open/close ref |
| `core/app/gallery/WidgetGalleryPanel.vue` | Overlay + 1×3 tiles |
| `core/app/palette/commands.ts` | `open-gallery` command |
| `core/app/palette/CommandPalette.vue` | Handle command + (+) Gallery button |
| `core/app/palette/paletteResults.assert.ts` | Mock `defaultSize` |
| `docs/extensions.md` | Document fields |
| `.cursor/skills/kavibay-widget/reference.md` | Checklist |

---

### Task 1: Contract types + loader validation

**Files:**
- Modify: `sdk/extension/types.ts`
- Modify: `core/app/extensions/loadExtensions.ts`
- Modify: `core/app/runtime/runtimeTypes.ts`
- Modify: `core/app/runtime/useRuntimeExtensions.ts`
- Modify: `core/app/palette/paletteResults.assert.ts` (and any other `RegisteredExtension` test mocks that break)

**Interfaces:**
- Produces:
  - `export interface WidgetSize { w: number; h: number }`
  - `ExtensionManifest.ui.defaultSize: WidgetSize` (required in type)
  - `RegisteredExtension.defaultSize: WidgetSize` (required)
  - `HostExtensionRef.defaultSize?: WidgetSize` (optional — builtins always set)

- [ ] **Step 1: Add types**

In `sdk/extension/types.ts`, after `WidgetPosition`:

```ts
/** Preferred card size in CSS pixels (host sets width/height on create). */
export interface WidgetSize {
  w: number;
  h: number;
}
```

Add to `ExtensionManifest.ui`:

```ts
defaultSize: WidgetSize;
```

Add to `RegisteredExtension`:

```ts
defaultSize: WidgetSize;
```

- [ ] **Step 2: Validate in `assertManifest`**

After `defaultOffset` checks in `loadExtensions.ts`:

```ts
const ds = m.ui.defaultSize;
if (
  !ds ||
  typeof ds !== "object" ||
  typeof ds.w !== "number" ||
  typeof ds.h !== "number" ||
  !(ds.w > 0) ||
  !(ds.h > 0)
) {
  throw new Error(
    `Extension "${folder}": manifest.ui.defaultSize must be {w,h} positive numbers`,
  );
}
```

In `toRegistered`, add:

```ts
defaultSize: { w: manifest.ui.defaultSize.w, h: manifest.ui.defaultSize.h },
```

- [ ] **Step 3: Runtime adapter**

`HostExtensionRef`: add `defaultSize?: { w: number; h: number }`.

`builtinToHostRef`: copy `defaultSize: { ...ext.defaultSize }`.

`scannedToHostRef`: omit `defaultSize` (runtime has none).

- [ ] **Step 4: Fix test mocks**

In `paletteResults.assert.ts` `ext()` helper, add:

```ts
defaultSize: { w: 220, h: 220 },
```

Fix any other `RegisteredExtension` object literals the typecheck flags the same way.

- [ ] **Step 5: Temporarily add `defaultSize` to one manifest so the loader can boot**

Add to `extensions/notes/manifest.json` → `ui`:

```json
"defaultSize": { "w": 280, "h": 200 }
```

(Other manifests fail until Task 3 — that is expected if you run the app early; Task 3 lands in the same implementation batch before `npm run build`.)

- [ ] **Step 6: Verify types compile for touched units**

Run: `npx vue-tsc --noEmit`  
Expected: errors only for manifests missing `defaultSize` **if** tsc typechecks JSON — usually it does not. If the app glob-loads at runtime, missing fields throw in `assertManifest` until Task 3.

---

### Task 2: Initial size helper + wire `onAddType`

**Files:**
- Create: `core/app/extensions/initialSize.ts`
- Create: `core/app/extensions/initialSize.assert.ts`
- Modify: `core/app/host/WidgetHost.vue` (`onAddType`)

**Interfaces:**
- Consumes: `RegisteredExtension` / `HostExtensionRef`-like `{ defaultSize?: WidgetSize; hugHeight: boolean; playground: boolean }`
- Produces:
  - `export function initialSizeForExtension(def: { defaultSize?: { w: number; h: number }; hugHeight?: boolean }): { width?: number; height?: number }`
    - If no `defaultSize` → `{}`
    - If `hugHeight` → `{ width: defaultSize.w }` only
    - Else → `{ width: defaultSize.w, height: defaultSize.h }`

- [ ] **Step 1: Write failing asserts**

Create `core/app/extensions/initialSize.assert.ts`:

```ts
/**
 * Run: npx tsx core/app/extensions/initialSize.assert.ts
 */
import { initialSizeForExtension } from "./initialSize";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

{
  const s = initialSizeForExtension({
    defaultSize: { w: 280, h: 200 },
    hugHeight: false,
  });
  assert(s.width === 280 && s.height === 200, "normal size");
}

{
  const s = initialSizeForExtension({
    defaultSize: { w: 222, h: 120 },
    hugHeight: true,
  });
  assert(s.width === 222 && s.height === undefined, "hugHeight skips h");
}

{
  const s = initialSizeForExtension({ hugHeight: false });
  assert(s.width === undefined && s.height === undefined, "runtime omit");
}

console.log("initialSize.assert.ts: ok");
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx tsx core/app/extensions/initialSize.assert.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement helper**

Create `core/app/extensions/initialSize.ts`:

```ts
/** Map extension defaultSize → createInstance width/height opts. */
export function initialSizeForExtension(def: {
  defaultSize?: { w: number; h: number };
  hugHeight?: boolean;
}): { width?: number; height?: number } {
  const ds = def.defaultSize;
  if (!ds) return {};
  if (def.hugHeight) return { width: ds.w };
  return { width: ds.w, height: ds.h };
}
```

- [ ] **Step 4: Run asserts — expect PASS**

Run: `npx tsx core/app/extensions/initialSize.assert.ts`  
Expected: `initialSize.assert.ts: ok`

- [ ] **Step 5: Wire `WidgetHost.onAddType`**

Replace playground hardcode:

```ts
import { initialSizeForExtension } from "../extensions/initialSize";

function onAddType(typeId: string): string | undefined {
  if (!isEnabled(typeId)) return undefined;
  const def = defFor(typeId);
  if (!def) return undefined;
  const size = initialSizeForExtension(def);
  const created = createInstance(typeId, def.position, {
    hideTitle: Boolean(def.defaultHideTitle),
    ...size,
  });
  // ... unchanged flush / catalog / hooks ...
}
```

`defFor` must return an object that includes `defaultSize` for builtins (via `HostExtensionRef` after Task 1).

---

### Task 3: Backfill `defaultSize` on all first-party manifests

**Files:**
- Modify: every `extensions/*/manifest.json` (27 files)
- Prefer existing `DEFAULT_WIDTH`/`DEFAULT_HEIGHT` in extension logic over the table when they differ

**Size map (authoritative for this task):**

| id | w | h | Notes |
|----|---|---|--------|
| alarm | 240 | 160 | |
| app-launcher | 222 | 120 | `48*4+10*3`; hugHeight |
| ask-llm | 360 | 420 | |
| calculator | 200 | 280 | |
| calendar | 260 | 320 | |
| clipboard | 260 | 200 | |
| clock | 200 | 120 | |
| color-picker | 200 | 160 | |
| emoji-picker | 288 | 280 | |
| focus-tracker | 300 | 220 | |
| github-actions | 300 | 280 | |
| image | 220 | 140 | logic defaults |
| moodist | 280 | 360 | |
| notes | 280 | 200 | logic defaults |
| now-playing | 320 | 120 | |
| pomodoro | 200 | 260 | |
| redacted | 240 | 160 | logic defaults |
| snake | 220 | 220 | playground |
| snapshots | 320 | 220 | logic defaults |
| stocks | 280 | 240 | |
| stopwatch | 200 | 180 | |
| system-info | 280 | 200 | |
| tado | 120 | 118 | widget defaults |
| time-tracker | 340 | 320 | logic defaults |
| timer | 200 | 160 | |
| todo | 280 | 260 | logic defaults |
| weather | 260 | 200 | |

- [ ] **Step 1: Add `defaultSize` under each manifest `ui` object**

Example (`extensions/pomodoro/manifest.json`):

```json
"ui": {
  "defaultOffset": { "x": 0, "y": 0 },
  "defaultSize": { "w": 200, "h": 260 }
}
```

Preserve existing `ui` flags (`flush`, `compact`, `hugHeight`, etc.).

- [ ] **Step 2: Smoke the loader**

Run: `npx tsx -e "console.log('skip')"` is useless here — instead start typecheck:

Run: `npm run build`  
Expected: PASS (or only pre-existing unrelated errors). Loader must not throw on missing `defaultSize`.

---

### Task 4: Gallery membership logic + video glob

**Files:**
- Create: `core/app/gallery/galleryLogic.ts`
- Create: `core/app/gallery/galleryLogic.assert.ts`
- Create: `core/app/gallery/introVideos.ts`

**Interfaces:**
- Produces:
  - `export function extensionIdFromIntroPath(path: string): string | null` — match `extensions/<id>/intro.mp4`
  - `export function buildGalleryTiles(registry: { id: string; title: string }[], videoById: Record<string, string>): { id: string; title: string; videoUrl: string }[]` — stable sort by `id`; only ids in both; skip unknown videos
  - `introVideos.ts` exports `export const introVideoById: Record<string, string>` built from Vite glob

- [ ] **Step 1: Failing asserts**

Create `core/app/gallery/galleryLogic.assert.ts`:

```ts
/**
 * Run: npx tsx core/app/gallery/galleryLogic.assert.ts
 */
import {
  buildGalleryTiles,
  extensionIdFromIntroPath,
} from "./galleryLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  extensionIdFromIntroPath("/extensions/notes/intro.mp4") === "notes",
  "posix path",
);
assert(
  extensionIdFromIntroPath("/extensions/moodist/intro.mp4") === "moodist",
  "moodist",
);
assert(extensionIdFromIntroPath("/extensions/notes/icon.svg") === null, "reject non-intro");

{
  const tiles = buildGalleryTiles(
    [
      { id: "snake", title: "Snake" },
      { id: "notes", title: "Notes" },
      { id: "pomodoro", title: "Pomodoro" },
      { id: "moodist", title: "Moodist" },
    ],
    {
      notes: "url-notes",
      pomodoro: "url-pomodoro",
      moodist: "url-moodist",
    },
  );
  assert(tiles.length === 3, "only video∩registry");
  assert(tiles[0].id === "moodist", "sorted by id");
  assert(tiles[1].id === "notes" && tiles[1].videoUrl === "url-notes", "notes url");
  assert(tiles.every((t) => t.id !== "snake"), "snake omitted");
}

console.log("galleryLogic.assert.ts: ok");
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx tsx core/app/gallery/galleryLogic.assert.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `galleryLogic.ts`**

```ts
/** Parse `extensions/<id>/intro.mp4` from a Vite glob key. */
export function extensionIdFromIntroPath(path: string): string | null {
  const m = path.match(/extensions\/([^/]+)\/intro\.mp4$/);
  return m ? m[1] : null;
}

export interface GalleryTile {
  id: string;
  title: string;
  videoUrl: string;
}

/** Registry ∩ intro videos; sorted by id. */
export function buildGalleryTiles(
  registry: { id: string; title: string }[],
  videoById: Record<string, string>,
): GalleryTile[] {
  const titleById = new Map(registry.map((r) => [r.id, r.title]));
  const tiles: GalleryTile[] = [];
  for (const [id, videoUrl] of Object.entries(videoById)) {
    const title = titleById.get(id);
    if (!title) continue;
    tiles.push({ id, title, videoUrl });
  }
  tiles.sort((a, b) => a.id.localeCompare(b.id));
  return tiles;
}
```

- [ ] **Step 4: Implement `introVideos.ts`**

```ts
import { extensionIdFromIntroPath } from "./galleryLogic";

const modules = import.meta.glob("/extensions/*/intro.mp4", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** extension id → resolved asset URL */
export const introVideoById: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const id = extensionIdFromIntroPath(path);
  if (id) introVideoById[id] = url;
}
```

If Vite rejects `query`/`import`, fall back to the project’s existing asset-glob style (search sibling globs / Vite docs used elsewhere in repo).

- [ ] **Step 5: Run asserts — expect PASS**

Run: `npx tsx core/app/gallery/galleryLogic.assert.ts`  
Expected: `galleryLogic.assert.ts: ok`

- [ ] **Step 6: Ensure the three mp4 files are tracked**

Confirm paths exist:

- `extensions/notes/intro.mp4`
- `extensions/pomodoro/intro.mp4`
- `extensions/moodist/intro.mp4`

Include them in the change set when the user asks to commit.

---

### Task 5: Gallery panel UI

**Files:**
- Create: `core/app/gallery/useWidgetGallery.ts`
- Create: `core/app/gallery/WidgetGalleryPanel.vue`

**Interfaces:**
- Consumes: `buildGalleryTiles`, `introVideoById`, `listExtensions` (or injected tile list), `kavibayAddWidget`
- Produces: `useWidgetGallery()` → `{ open, show, hide }` (same pattern as `useSettingsModal`)

- [ ] **Step 1: Shared modal state**

Create `core/app/gallery/useWidgetGallery.ts`:

```ts
import { ref, type Ref } from "vue";

const open: Ref<boolean> = ref(false);

/** Shared open state for the widget gallery overlay. */
export function useWidgetGallery() {
  function show() {
    open.value = true;
  }
  function hide() {
    open.value = false;
  }
  return { open, show, hide };
}
```

- [ ] **Step 2: Panel component**

Create `WidgetGalleryPanel.vue`:

- `v-if="open"` fullscreen scrim; click scrim → `hide()`
- Centered panel; inner grid `display: grid; grid-template-columns: repeat(3, 1fr); gap: …`
- For each tile from `buildGalleryTiles(listExtensions(), introVideoById)`:
  - Card with `<video :src="tile.videoUrl" autoplay muted loop playsinline />` + `pointer-events: none`
  - Title label
  - Hover: translateY lift + border; **Add** button opacity 0→1
  - Add `@click.stop` → `inject('kavibayAddWidget')?.(tile.id)` — gallery **stays open**
- Match existing Kavibay dark glass chrome (no new purple/glow theme)
- Escape key closes (listen while open)
- `object-fit: cover` on video; fixed tile height (~220–280px) so 1×3 reads evenly

Skeleton:

```vue
<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted } from "vue";
import { listExtensions } from "../extensions/registry";
import { buildGalleryTiles } from "./galleryLogic";
import { introVideoById } from "./introVideos";
import { useWidgetGallery } from "./useWidgetGallery";

const { open, hide } = useWidgetGallery();
const addWidget = inject<(typeId: string) => string | undefined>("kavibayAddWidget");

const tiles = computed(() =>
  buildGalleryTiles(
    listExtensions().map((e) => ({ id: e.id, title: e.title })),
    introVideoById,
  ),
);

function onAdd(id: string) {
  addWidget?.(id);
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) {
    e.preventDefault();
    hide();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>
```

- [ ] **Step 3: Manual visual check once wired (Task 6)** — three looping muted videos, hover Add, no click-through into video.

---

### Task 6: Entry points — First-Open, Palette, Widget Manager

**Files:**
- Modify: `core/app/host/WidgetHost.vue`
- Modify: `core/app/palette/commands.ts`
- Modify: `core/app/palette/CommandPalette.vue`

**Interfaces:**
- Consumes: `useWidgetGallery().show/hide/open`
- First-open: after `consumeFirstOpen()`, open cockpit **and** show gallery (in addition to search reveal)

- [ ] **Step 1: Mount panel + first-open**

In `WidgetHost.vue`:

```ts
import WidgetGalleryPanel from "../gallery/WidgetGalleryPanel.vue";
import { useWidgetGallery } from "../gallery/useWidgetGallery";

const { open: galleryOpen, show: showGallery } = useWidgetGallery();
```

Template: render `<WidgetGalleryPanel />` next to settings overlay (portal/fixed root).

Change first-open block:

```ts
if (consumeFirstOpen()) {
  onPaletteHotkey(true);
  showGallery();
}
```

Ensure gallery open does not break click-through region sync (treat like `settingsOpen`: while gallery is open, keep dismiss/catcher behavior consistent — if settings blocks outside-dismiss, mirror that for `galleryOpen`).

- [ ] **Step 2: Palette command**

In `commands.ts` add:

```ts
{
  id: "open-gallery",
  title: "Widget Gallery",
  subtitle: "Browse widgets with video previews",
  keywords: ["gallery", "widgets", "browse", "add", "onboarding"],
},
```

In `CommandPalette.vue` `runRow` (near `open-settings`):

```ts
if (row.commandId === "open-gallery") {
  query.value = "";
  selectedIndex.value = 0;
  closeAddMenu();
  showGallery(); // from useWidgetGallery()
  return;
}
```

- [ ] **Step 3: (+) menu Gallery button**

In the add-menu header (near filter chips), add a button labeled **Gallery** that calls `showGallery()` and `closeAddMenu()`.

- [ ] **Step 4: Manual checklist**

1. Clear `localStorage` key `kavibay:first-open-done` → relaunch → gallery opens with 3 videos  
2. Palette → “Widget Gallery” → opens  
3. (+) → Gallery → opens  
4. Add on Notes / Pomodoro / Moodist → instances appear at `defaultSize`; gallery stays open  
5. Esc / scrim closes; desk usable  
6. Add a non-gallery widget from (+) → still gets its `defaultSize`

---

### Task 7: Docs + final verify

**Files:**
- Modify: `docs/extensions.md`
- Modify: `.cursor/skills/kavibay-widget/reference.md`

- [x] **Step 1: Document `defaultSize` + optional `intro.mp4`**

In `docs/extensions.md`, under manifest / layout section, add:

- `ui.defaultSize: { w, h }` — CSS px; required; host sets instance size on Add  
- Optional `intro.mp4` beside `manifest.json` — inclusion in Widget Gallery  
- `hugHeight` still content-height; only width comes from `defaultSize`

In skill `reference.md` manifest checklist, add `defaultSize` and optional `intro.mp4`.

- [x] **Step 2: Run verifies**

```bash
npx tsx core/app/extensions/initialSize.assert.ts
npx tsx core/app/gallery/galleryLogic.assert.ts
npm run build
```

Expected: all ok / build green.

- [x] **Step 3: Mark spec/plan progress**

In the plan file, check off completed tasks. Optionally add a one-line completion note at the top of the spec (`Status: Implemented`).

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| `defaultSize` on contract | 1 |
| Values for all widgets | 3 |
| Apply on Add / hugHeight / playground | 2 |
| Host gallery, not desk widget | 5–6 |
| First-Open + Palette + Manager | 6 |
| `intro.mp4` convention + glob | 4 |
| 1×3 grid, muted loop, hover Add | 5 |
| Omit without video | 4 |
| No live demo | (out of scope — no task) |
| Docs | 7 |

## Placeholder / consistency check

- Names aligned: `initialSizeForExtension`, `buildGalleryTiles`, `introVideoById`, `useWidgetGallery`, `open-gallery`
- No `demoData` / `mode` introduced
- Runtime `defaultSize` optional throughout
