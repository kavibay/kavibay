# Notes Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a resizable Notes widget with TipTap WYSIWYG (bold/italic/underline/H1/H2/lists/links), markdown persistence per instance, and Image-style resize.

**Architecture:** Pure helpers in `notesLogic.ts`; per-instance cache + debounced save in `useNotesState.ts`; TipTap editor + toolbar + resize grip in `NotesWidget.vue`; register in `registry.ts` and wire seed/dispose in `WidgetHost.vue`. No Rust.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 overlay, TipTap v3 (`@tiptap/vue-3`, StarterKit, Underline, Link, `@tiptap/markdown`).

## Global Constraints

- Widget inside existing dark `WidgetCard`, title **Notes**, id `notes`
- One document per instance; WYSIWYG only (no raw markdown toggle in V1)
- Toolbar: Bold, Italic, Underline, H1, H2, bullet list, numbered list, link
- Persist `kavibay:notes-widget:{instanceId}` as `{ markdown, width, height }`
- Autosave debounce ~300ms; resize grip bottom-right (Image pattern)
- Link URLs: only `http:` / `https:`
- Underline may persist as HTML `<u>` inside markdown (acceptable V1)
- No settings panel; no images/attachments/sync/export
- No git repository in this workspace — skip all commit steps
- No test runner — verify with Node assert scripts, `npx vue-tsc --noEmit`, and manual UI checks
- Spec: `docs/superpowers/specs/2026-07-18-notes-widget-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/notesLogic.ts` | Types, size clamp, URL check, normalize, load/save/clear |
| `src/widgets/useNotesState.ts` | Per-`instanceId` cache; debounced markdown persist; dispose; seed |
| `src/widgets/NotesWidget.vue` | TipTap editor, toolbar, link popover, resize grip |
| `src/widgets/registry.ts` | Register `notes` |
| `src/widgets/WidgetHost.vue` | Duplicate/remove seed/dispose for `notes` |
| `package.json` | TipTap + markdown deps |

---

### Task 1: Pure notes logic

**Files:**
- Create: `src/widgets/notesLogic.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export interface NotesWidgetState { markdown: string; width: number; height: number }`
  - `export const DEFAULT_WIDTH / DEFAULT_HEIGHT / MIN_* / MAX_*`
  - `export const EMPTY_STATE: NotesWidgetState`
  - `export function storageKey(instanceId: string): string`
  - `export function isValidNoteUrl(value: string): boolean`
  - `export function clampSize(width: number, height: number): { width: number; height: number }`
  - `export function normalizeState(raw: unknown): NotesWidgetState`
  - `export function loadState(instanceId: string): NotesWidgetState`
  - `export function saveState(instanceId: string, state: NotesWidgetState): void`
  - `export function clearState(instanceId: string): void`

- [ ] **Step 1: Create `src/widgets/notesLogic.ts`**

```ts
export interface NotesWidgetState {
  /** Markdown body (may include HTML <u> for underline). */
  markdown: string;
  /** Widget content width in CSS pixels. */
  width: number;
  /** Widget content height in CSS pixels. */
  height: number;
}

export const DEFAULT_WIDTH = 280;
export const DEFAULT_HEIGHT = 200;
export const MIN_WIDTH = 180;
export const MIN_HEIGHT = 120;
export const MAX_WIDTH = 900;
export const MAX_HEIGHT = 700;

export const EMPTY_STATE: NotesWidgetState = {
  markdown: "",
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
};

/** localStorage key for one widget instance. */
export function storageKey(instanceId: string): string {
  return `kavibay:notes-widget:${instanceId}`;
}

/** Accept only http(s) absolute URLs for links. */
export function isValidNoteUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Clamp width/height into allowed bounds. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  const w = Number.isFinite(width) ? width : DEFAULT_WIDTH;
  const h = Number.isFinite(height) ? height : DEFAULT_HEIGHT;
  return {
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w))),
    height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h))),
  };
}

/** Normalize raw persisted JSON into a safe state. */
export function normalizeState(raw: unknown): NotesWidgetState {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_STATE };
  }
  const o = raw as Record<string, unknown>;
  const size = clampSize(
    typeof o.width === "number" ? o.width : DEFAULT_WIDTH,
    typeof o.height === "number" ? o.height : DEFAULT_HEIGHT,
  );
  const markdown = typeof o.markdown === "string" ? o.markdown : "";
  return { markdown, ...size };
}

/** Load persisted state for an instance (empty on miss/corrupt). */
export function loadState(instanceId: string): NotesWidgetState {
  try {
    const raw = localStorage.getItem(storageKey(instanceId));
    if (!raw) return { ...EMPTY_STATE };
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** Persist state for an instance. */
export function saveState(instanceId: string, state: NotesWidgetState): void {
  localStorage.setItem(storageKey(instanceId), JSON.stringify(normalizeState(state)));
}

/** Remove persisted state (widget instance removed). */
export function clearState(instanceId: string): void {
  localStorage.removeItem(storageKey(instanceId));
}
```

- [ ] **Step 2: Verify logic with Node assert script**

Run (PowerShell):

```powershell
node --input-type=module -e @"
import assert from 'node:assert/strict';
import {
  clampSize, isValidNoteUrl, normalizeState, storageKey, EMPTY_STATE,
  MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH, DEFAULT_HEIGHT,
} from './src/widgets/notesLogic.ts';

assert.equal(storageKey('abc'), 'kavibay:notes-widget:abc');
assert.equal(isValidNoteUrl('https://example.com/x'), true);
assert.equal(isValidNoteUrl('http://x'), true);
assert.equal(isValidNoteUrl('ftp://x'), false);
assert.equal(isValidNoteUrl('not a url'), false);
assert.deepEqual(normalizeState(null), EMPTY_STATE);
assert.equal(normalizeState({ markdown: '# Hi', width: 50, height: 9999 }).markdown, '# Hi');
assert.equal(normalizeState({ markdown: '# Hi', width: 50, height: 9999 }).width, MIN_WIDTH);
assert.equal(normalizeState({ markdown: '# Hi', width: 50, height: 9999 }).height, 700);
assert.deepEqual(clampSize(DEFAULT_WIDTH, DEFAULT_HEIGHT), { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
console.log('ok');
"@
```

Expected: `ok`

If Node cannot import `.ts` directly, use `npx vite-node` with the same asserts, or paste functions into a one-off `.mjs`.

- [ ] **Step 3: Commit** — skip (no git in this workspace)

---

### Task 2: Notes state composable

**Files:**
- Create: `src/widgets/useNotesState.ts`

**Interfaces:**
- Consumes: `notesLogic` APIs from Task 1
- Produces:
  - `export function useNotesState(instanceId: string)` → `{ state, setMarkdown, setSize, flush }`
  - `export function disposeNotesState(instanceId: string): void`
  - `export function clearNotesState(instanceId: string): void`
  - `export function seedNotesStateFrom(fromId: string, toId: string): void`

- [ ] **Step 1: Create `src/widgets/useNotesState.ts`**

```ts
import { type Ref, ref } from "vue";
import {
  type NotesWidgetState,
  clearState,
  clampSize,
  loadState,
  normalizeState,
  saveState,
} from "./notesLogic";

interface NotesCache {
  state: Ref<NotesWidgetState>;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

const cache = new Map<string, NotesCache>();
const DEBOUNCE_MS = 300;

function ensure(instanceId: string): NotesCache {
  let existing = cache.get(instanceId);
  if (!existing) {
    existing = {
      state: ref(loadState(instanceId)),
      saveTimer: null,
    };
    cache.set(instanceId, existing);
  }
  return existing;
}

/** Persist immediately (cancel pending debounce). */
function persistNow(instanceId: string, entry: NotesCache) {
  if (entry.saveTimer != null) {
    clearTimeout(entry.saveTimer);
    entry.saveTimer = null;
  }
  saveState(instanceId, entry.state.value);
}

/** Schedule a debounced persist. */
function schedulePersist(instanceId: string, entry: NotesCache) {
  if (entry.saveTimer != null) clearTimeout(entry.saveTimer);
  entry.saveTimer = setTimeout(() => {
    entry.saveTimer = null;
    saveState(instanceId, entry.state.value);
  }, DEBOUNCE_MS);
}

/** Per-instance notes state shared by the widget UI. */
export function useNotesState(instanceId: string) {
  const entry = ensure(instanceId);
  const { state } = entry;

  /** Replace markdown and debounce-save (keeps size). */
  function setMarkdown(markdown: string) {
    state.value = normalizeState({ ...state.value, markdown });
    schedulePersist(instanceId, entry);
  }

  /** Update size and persist immediately (resize should feel snappy). */
  function setSize(width: number, height: number) {
    const size = clampSize(width, height);
    state.value = { ...state.value, ...size };
    persistNow(instanceId, entry);
  }

  /** Flush any pending debounced save (call on unmount). */
  function flush() {
    persistNow(instanceId, entry);
  }

  return { state, setMarkdown, setSize, flush };
}

/** Drop in-memory cache entry (after Remove). */
export function disposeNotesState(instanceId: string): void {
  const entry = cache.get(instanceId);
  if (entry?.saveTimer != null) clearTimeout(entry.saveTimer);
  cache.delete(instanceId);
}

/** Clear persisted storage for an instance. */
export function clearNotesState(instanceId: string): void {
  clearState(instanceId);
}

/** Ensure target cache matches source after Duplicate. */
export function seedNotesStateFrom(fromId: string, toId: string): void {
  const from = ensure(fromId);
  const cloned = normalizeState(from.state.value);
  cache.set(toId, {
    state: ref(cloned),
    saveTimer: null,
  });
  saveState(toId, cloned);
}
```

- [ ] **Step 2: Verify seed + normalize path with a small Node script**

Run (PowerShell) — paste or import `normalizeState` / `clampSize` only if `useNotesState` cannot run under Node (Vue refs). Minimum check: re-run Task 1 asserts still pass; manually confirm `seedNotesStateFrom` copies markdown by reading the source once in the browser console after Task 5, or add this unit-less check by duplicating normalize logic:

```powershell
node --input-type=module -e @"
import assert from 'node:assert/strict';
import { normalizeState } from './src/widgets/notesLogic.ts';
const a = normalizeState({ markdown: '**x**', width: 300, height: 220 });
const b = normalizeState(a);
assert.deepEqual(a, b);
assert.equal(a.markdown, '**x**');
console.log('ok');
"@
```

Expected: `ok`

- [ ] **Step 3: Commit** — skip (no git)

---

### Task 3: Install TipTap dependencies

**Files:**
- Modify: `package.json` / `package-lock.json` (via npm)

**Interfaces:**
- Consumes: nothing
- Produces: packages available for import in Task 4

- [ ] **Step 1: Install TipTap v3 + official markdown extension**

Run from repo root:

```powershell
npm install @tiptap/vue-3 @tiptap/starter-kit @tiptap/extension-underline @tiptap/extension-link @tiptap/markdown
```

Expected: exit 0; packages listed under `dependencies` in `package.json`.

Use matching major versions (TipTap 3.x). If npm resolves peer conflicts, align all `@tiptap/*` to the same version.

- [ ] **Step 2: Smoke-import check**

```powershell
node --input-type=module -e @"
import('@tiptap/starter-kit').then(() => console.log('ok')).catch((e) => { console.error(e); process.exit(1); });
"@
```

Expected: `ok`

- [ ] **Step 3: Commit** — skip (no git)

---

### Task 4: NotesWidget UI (TipTap + toolbar + resize)

**Files:**
- Create: `src/widgets/NotesWidget.vue`

**Interfaces:**
- Consumes: `useNotesState`, `isValidNoteUrl`, `WidgetProps`
- Produces: Vue SFC registered later as `notes` component

- [ ] **Step 1: Create `src/widgets/NotesWidget.vue`**

Implement the full SFC below (adapt only if TipTap API differs slightly for the installed version — keep behavior identical).

```vue
<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { Markdown } from "@tiptap/markdown";
import { setClickThroughPaused, syncInteractiveRegions } from "../system/clickThrough";
import type { WidgetProps } from "./types";
import { isValidNoteUrl } from "./notesLogic";
import { useNotesState } from "./useNotesState";

defineProps<WidgetProps>();

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");

const { state, setMarkdown, setSize, flush } = useNotesState(instanceId);

const rootEl = ref<HTMLElement | null>(null);
const linkOpen = ref(false);
const linkDraft = ref("");
const linkError = ref<string | null>(null);

const rootStyle = computed(() => ({
  width: `${state.value.width}px`,
  height: `${state.value.height}px`,
}));

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2] },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
    }),
    Markdown,
  ],
  content: state.value.markdown || "",
  contentType: "markdown",
  editorProps: {
    attributes: {
      class: "notes-prose",
      "data-interactive": "true",
    },
  },
  onUpdate: ({ editor: ed }) => {
    setMarkdown(ed.getMarkdown());
  },
});

function toggleBold() {
  editor.value?.chain().focus().toggleBold().run();
}
function toggleItalic() {
  editor.value?.chain().focus().toggleItalic().run();
}
function toggleUnderline() {
  editor.value?.chain().focus().toggleUnderline().run();
}
function toggleH1() {
  editor.value?.chain().focus().toggleHeading({ level: 1 }).run();
}
function toggleH2() {
  editor.value?.chain().focus().toggleHeading({ level: 2 }).run();
}
function toggleBullet() {
  editor.value?.chain().focus().toggleBulletList().run();
}
function toggleOrdered() {
  editor.value?.chain().focus().toggleOrderedList().run();
}

/** Open link popover with current href if any. */
function openLink() {
  const href = editor.value?.getAttributes("link").href;
  linkDraft.value = typeof href === "string" ? href : "";
  linkError.value = null;
  linkOpen.value = true;
}

/** Apply or update link from draft URL. */
function applyLink() {
  const url = linkDraft.value.trim();
  if (!isValidNoteUrl(url)) {
    linkError.value = "http(s) URL required";
    return;
  }
  editor.value?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  linkOpen.value = false;
  linkError.value = null;
}

/** Remove link mark from selection. */
function removeLink() {
  editor.value?.chain().focus().extendMarkRange("link").unsetLink().run();
  linkOpen.value = false;
  linkError.value = null;
}

/** Bottom-right resize: drag changes persisted width/height. */
function onResizePointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const handle = e.currentTarget as HTMLElement;
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = state.value.width;
  const startH = state.value.height;
  handle.setPointerCapture(e.pointerId);
  setClickThroughPaused(true);

  function onMove(ev: PointerEvent) {
    setSize(startW + (ev.clientX - startX), startH + (ev.clientY - startY));
  }

  function onUp(ev: PointerEvent) {
    handle.releasePointerCapture(ev.pointerId);
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    setClickThroughPaused(false);
    void nextTick().then(() => syncInteractiveRegions());
  }

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
}

watch(
  () => [state.value.width, state.value.height] as const,
  async () => {
    await nextTick();
    syncInteractiveRegions();
  },
);

onMounted(() => {
  void nextTick().then(() => syncInteractiveRegions());
});

onBeforeUnmount(() => {
  flush();
  editor.value?.destroy();
});
</script>

<template>
  <div ref="rootEl" class="notes-widget" :style="rootStyle" data-interactive>
    <div class="notes-toolbar" @pointerdown.stop>
      <button type="button" class="notes-btn" :class="{ active: editor?.isActive('bold') }" title="Bold" @click="toggleBold">B</button>
      <button type="button" class="notes-btn" :class="{ active: editor?.isActive('italic') }" title="Italic" @click="toggleItalic"><em>I</em></button>
      <button type="button" class="notes-btn" :class="{ active: editor?.isActive('underline') }" title="Underline" @click="toggleUnderline"><span class="u">U</span></button>
      <button type="button" class="notes-btn" :class="{ active: editor?.isActive('heading', { level: 1 }) }" title="H1" @click="toggleH1">H1</button>
      <button type="button" class="notes-btn" :class="{ active: editor?.isActive('heading', { level: 2 }) }" title="H2" @click="toggleH2">H2</button>
      <button type="button" class="notes-btn" :class="{ active: editor?.isActive('bulletList') }" title="Bullet list" @click="toggleBullet">•</button>
      <button type="button" class="notes-btn" :class="{ active: editor?.isActive('orderedList') }" title="Numbered list" @click="toggleOrdered">1.</button>
      <button type="button" class="notes-btn" :class="{ active: editor?.isActive('link') }" title="Link" @click="openLink">Link</button>
    </div>

    <div v-if="linkOpen" class="notes-link-pop" data-interactive @pointerdown.stop>
      <input
        v-model="linkDraft"
        class="notes-link-input"
        type="url"
        placeholder="https://…"
        aria-label="Link URL"
        @keydown.enter.prevent="applyLink"
      />
      <p v-if="linkError" class="notes-link-error">{{ linkError }}</p>
      <div class="notes-link-actions">
        <button type="button" class="notes-btn" @click="applyLink">OK</button>
        <button type="button" class="notes-btn" @click="removeLink">Remove</button>
        <button type="button" class="notes-btn" @click="linkOpen = false">Cancel</button>
      </div>
    </div>

    <div class="notes-editor" @pointerdown.stop>
      <EditorContent :editor="editor" />
    </div>

    <div
      class="notes-resize"
      title="Größe ändern"
      aria-label="Größe ändern"
      @pointerdown.stop="onResizePointerDown"
    />
  </div>
</template>

<style scoped>
.notes-widget {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
}

.notes-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 6px;
  flex-shrink: 0;
}

.notes-btn {
  appearance: none;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 5px 7px;
  border-radius: 6px;
  cursor: pointer;
}

.notes-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.notes-btn.active {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}

.notes-btn .u {
  text-decoration: underline;
}

.notes-link-pop {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  margin-bottom: 6px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 8px;
  flex-shrink: 0;
}

.notes-link-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: #fff;
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
  font-size: 12px;
}

.notes-link-error {
  margin: 0;
  font-size: 11px;
  color: #f0a0a0;
}

.notes-link-actions {
  display: flex;
  gap: 4px;
}

.notes-editor {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0px 10px;
}

.notes-editor :deep(.notes-prose) {
  outline: none;
  min-height: 100%;
  font-size: 13px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.92);
}

.notes-editor :deep(.notes-prose p.is-editor-empty:first-child::before) {
  content: "Write a note…";
  color: rgba(255, 255, 255, 0.35);
  float: left;
  height: 0;
  pointer-events: none;
}

.notes-editor :deep(.notes-prose h1) {
  font-size: 1.35em;
  margin: 0.4em 0 0.25em;
}

.notes-editor :deep(.notes-prose h2) {
  font-size: 1.15em;
  margin: 0.35em 0 0.2em;
}

.notes-editor :deep(.notes-prose ul),
.notes-editor :deep(.notes-prose ol) {
  padding-left: 1.25em;
  margin: 0.35em 0;
}

.notes-editor :deep(.notes-prose a) {
  color: #9ecbff;
  text-decoration: underline;
}

.notes-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background: linear-gradient(
    135deg,
    transparent 50%,
    rgba(255, 255, 255, 0.35) 50%
  );
  border-bottom-right-radius: 4px;
}
</style>
```

**Placeholder note:** TipTap’s empty placeholder often needs `Placeholder` extension. If the CSS `::before` trick does not show, install `@tiptap/extension-placeholder` and add:

```ts
import Placeholder from "@tiptap/extension-placeholder";
// in extensions:
Placeholder.configure({ placeholder: "Write a note…" }),
```

Prefer Placeholder extension over the CSS-only approach if the empty-state hint does not show.

- [ ] **Step 2: Typecheck**

```powershell
npx vue-tsc --noEmit
```

Expected: no errors in `NotesWidget.vue` / notes modules. Fix TipTap API mismatches (e.g. `contentType` placement) if the installed version differs — keep markdown load/save via `getMarkdown()` + `setContent(..., { contentType: 'markdown' })`.

- [ ] **Step 3: Commit** — skip (no git)

---

### Task 5: Register widget + host seed/dispose

**Files:**
- Modify: `src/widgets/registry.ts`
- Modify: `src/widgets/WidgetHost.vue`

**Interfaces:**
- Consumes: `NotesWidget.vue`, `seedNotesStateFrom`, `disposeNotesState`, `clearNotesState`
- Produces: palette-addable `notes` widget with duplicate/remove persistence

- [ ] **Step 1: Register in `src/widgets/registry.ts`**

Add import:

```ts
import NotesWidget from "./NotesWidget.vue";
```

Add registry entry (place below calculator / away from crowded left stack):

```ts
{
  id: "notes",
  title: "Notes",
  // Right of palette, below calculator stack.
  position: { x: 480, y: 560 },
  component: NotesWidget,
},
```

- [ ] **Step 2: Wire duplicate/remove in `src/widgets/WidgetHost.vue`**

Add import:

```ts
import {
  clearNotesState,
  disposeNotesState,
  seedNotesStateFrom,
} from "./useNotesState";
```

In `onDuplicate`, after other seeds:

```ts
if (source.typeId === "notes") {
  seedNotesStateFrom(source.instanceId, copy.instanceId);
}
```

In `onRemove`, after other clears:

```ts
if (removed.typeId === "notes") {
  disposeNotesState(removed.instanceId);
  clearNotesState(removed.instanceId);
}
```

- [ ] **Step 3: Typecheck again**

```powershell
npx vue-tsc --noEmit
```

Expected: exit 0 (or only pre-existing unrelated errors).

- [ ] **Step 4: Manual UI checklist**

Run the app (`npm run tauri dev` or project’s usual command), then:

1. Add **Notes** from the command palette
2. Type text; apply Bold, Italic, Underline, H1, H2, bullet, numbered, link (`https://example.com`)
3. Resize via bottom-right grip
4. Restart app → same markdown content and size
5. Duplicate Notes → edit copy; original unchanged
6. Remove duplicate → its `localStorage` key `kavibay:notes-widget:{id}` is gone
7. Confirm invalid link (e.g. `ftp://x`) shows error and does not apply

- [ ] **Step 5: Commit** — skip (no git)

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Registry `notes` / title Notes / WidgetCard | Task 5 |
| One doc per instance; seed on duplicate; clear on remove | Task 2 + 5 |
| TipTap WYSIWYG | Task 3 + 4 |
| Toolbar B/I/U/H1/H2/lists/link | Task 4 |
| Markdown persist under the hood | Task 1–4 (`getMarkdown` / `contentType: 'markdown'`) |
| Autosave ~300ms | Task 2 |
| Resize + size persist | Task 1, 2, 4 |
| Placeholder empty state | Task 4 |
| http(s) links only | Task 1 + 4 |
| No Rust / no settings | All tasks |
| Underline as HTML-in-markdown OK | Task 4 + TipTap Markdown HTML parse |

## Type consistency

- Storage shape: `{ markdown, width, height }` everywhere
- Composable names: `useNotesState`, `disposeNotesState`, `clearNotesState`, `seedNotesStateFrom`
- Key: `kavibay:notes-widget:{instanceId}`
- Registry id: `notes`
