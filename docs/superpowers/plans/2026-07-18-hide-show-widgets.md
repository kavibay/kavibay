# Hide / Show Widgets + Palette Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soft-hide widgets (keep settings/position), pause them by unmounting, and toggle open/hidden instances from the command palette search for every widget type.

**Architecture:** Add optional `hidden` on `WidgetInstance` persisted in `kavibay:layout-v3`. `WidgetHost` mounts only visible instances and provides toggle + instance list. Pure helpers build disambiguated search rows; `CommandPalette` merges them with commands via existing fuzzy matching.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 overlay (no new dependencies).

## Global Constraints

- Soft-hide via `hidden?: boolean` on `WidgetInstance`; missing ⇒ visible
- Storage key remains `kavibay:layout-v3` (no new key / version)
- Hide keeps offset, title, `hideTitle`, and all per-instance typed storage
- Remove stays hard-delete (splice + dispose/clear) — unchanged
- Hidden widgets are not mounted (pause polling/timers)
- Search lists each instance separately; selecting toggles `hidden`
- Empty query: commands only; non-empty query: commands + widgets
- Widget toggle must not call `execute_action` or hide the Kavibay window
- Duplicates always start visible
- No git repository in this workspace — skip all commit steps
- No test runner — verify with Node assert scripts, `npx vue-tsc --noEmit`, and manual UI checks
- Spec: `docs/superpowers/specs/2026-07-18-hide-show-widgets-design.md`

## File Structure

| File | Responsibility |
|------|----------------|
| `src/widgets/types.ts` | Add `hidden?: boolean` on `WidgetInstance` |
| `src/widgets/layoutLogic.ts` | Persist/normalize `hidden`; keep duplicate visible |
| `src/palette/paletteResults.ts` | Disambiguated titles, widget rows, unified filter |
| `src/widgets/WidgetCard.vue` | **Hide** menu item; emit `hide` |
| `src/widgets/WidgetInstanceView.vue` | Forward `hide` |
| `src/widgets/WidgetHost.vue` | `onHide` / `onToggleWidget`; mount filter; provide |
| `src/palette/CommandPalette.vue` | Unified results; toggle widgets on select |

---

### Task 1: `hidden` on layout model

**Files:**
- Modify: `src/widgets/types.ts`
- Modify: `src/widgets/layoutLogic.ts`

**Interfaces:**
- Consumes: existing `WidgetInstance`, `normalizeInstance`, `duplicateInstance`, `saveLayout`, `loadLayout`
- Produces:
  - `WidgetInstance.hidden?: boolean`
  - `normalizeInstance` persists `hidden: true` when set
  - `duplicateInstance` never copies `hidden` (always visible)

- [ ] **Step 1: Extend `WidgetInstance` in `src/widgets/types.ts`**

After `hideTitle?: boolean;` add:

```ts
  /** When true, instance is not mounted; settings and offset are kept. */
  hidden?: boolean;
```

- [ ] **Step 2: Persist `hidden` in `normalizeInstance` (`src/widgets/layoutLogic.ts`)**

Update `normalizeInstance`:

```ts
/** Strip a loaded instance down to the fields we persist. */
function normalizeInstance(i: WidgetInstance): WidgetInstance {
  const next: WidgetInstance = {
    instanceId: i.instanceId,
    typeId: i.typeId,
    offset: { x: i.offset.x, y: i.offset.y },
  };
  if (typeof i.title === "string") next.title = i.title;
  if (typeof i.hideTitle === "boolean") next.hideTitle = i.hideTitle;
  if (i.hidden === true) next.hidden = true;
  return next;
}
```

Confirm `duplicateInstance` does **not** spread `hidden` (current implementation already omits it — leave as-is):

```ts
export function duplicateInstance(source: WidgetInstance): WidgetInstance {
  return {
    instanceId: newInstanceId(),
    typeId: source.typeId,
    offset: {
      x: source.offset.x + DUPLICATE_DELTA,
      y: source.offset.y + DUPLICATE_DELTA,
    },
    ...(source.title !== undefined ? { title: source.title } : {}),
    ...(source.hideTitle !== undefined ? { hideTitle: source.hideTitle } : {}),
  };
}
```

- [ ] **Step 3: Verify with Node assert script**

Export `normalizeInstance` temporarily for the script, **or** inline a copy of the persistence rule. Prefer exporting:

```ts
/** Strip a loaded instance down to the fields we persist. */
export function normalizeInstance(i: WidgetInstance): WidgetInstance {
  // ...same body as above...
}
```

Run (PowerShell):

```powershell
node --input-type=module -e @"
import assert from 'node:assert/strict';
import { normalizeInstance, duplicateInstance } from './src/widgets/layoutLogic.ts';

const base = {
  instanceId: 'a',
  typeId: 'clock',
  offset: { x: 1, y: 2 },
  title: 'My Clock',
  hideTitle: true,
  hidden: true,
};
const n = normalizeInstance(base);
assert.equal(n.hidden, true);
assert.equal(n.title, 'My Clock');
assert.equal(n.hideTitle, true);

const visible = normalizeInstance({
  instanceId: 'b',
  typeId: 'clock',
  offset: { x: 0, y: 0 },
  hidden: false,
});
assert.equal(visible.hidden, undefined);

const dup = duplicateInstance(base);
assert.equal(dup.hidden, undefined);
assert.notEqual(dup.instanceId, base.instanceId);
console.log('ok');
"@
```

Expected: `ok`

If Node cannot import `.ts`, use `npx vite-node` with the same asserts.

- [ ] **Step 4: Commit** — skip (no git in this workspace)

---

### Task 2: Palette result helpers

**Files:**
- Create: `src/palette/paletteResults.ts`
- Modify: `src/palette/fuzzy.ts` (optional thin re-export only if needed — prefer keeping `fuzzyMatch` import in the new file)

**Interfaces:**
- Consumes: `Command` from `./commands`, `fuzzyMatch` from `./fuzzy`, `WidgetInstance` from widgets types, registry title lookup
- Produces:
  - `export interface PaletteWidgetRow { kind: "widget"; id: string; instanceId: string; title: string; subtitle: string; keywords: string[]; hidden: boolean }`
  - `export interface PaletteCommandRow { kind: "command"; id: string; title: string; subtitle?: string; keywords: string[]; commandId: string }`
  - `export type PaletteRow = PaletteCommandRow | PaletteWidgetRow`
  - `export function disambiguatedTitles(instances, titleFor): Map<string, string>`
  - `export function buildWidgetRows(instances, titleFor, typeKeywordsFor): PaletteWidgetRow[]`
  - `export function filterPaletteRows(query, commands, widgetRows): PaletteRow[]`

- [ ] **Step 1: Create `src/palette/paletteResults.ts`**

```ts
import type { Command } from "./commands";
import { fuzzyMatch } from "./fuzzy";
import type { WidgetInstance } from "../widgets/types";

/** Command row in the unified palette list. */
export interface PaletteCommandRow {
  kind: "command";
  id: string;
  title: string;
  subtitle?: string;
  keywords: string[];
  commandId: string;
}

/** Widget-instance row in the unified palette list. */
export interface PaletteWidgetRow {
  kind: "widget";
  id: string;
  instanceId: string;
  title: string;
  subtitle: string;
  keywords: string[];
  hidden: boolean;
}

export type PaletteRow = PaletteCommandRow | PaletteWidgetRow;

/**
 * Build display titles per instanceId.
 * Same base name among siblings gets " 2", " 3", … in encounter order.
 */
export function disambiguatedTitles(
  instances: WidgetInstance[],
  titleFor: (instance: WidgetInstance) => string,
): Map<string, string> {
  const counts = new Map<string, number>();
  const out = new Map<string, string>();

  for (const instance of instances) {
    const base = titleFor(instance);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    out.set(instance.instanceId, n === 1 ? base : `${base} ${n}`);
  }

  // Second pass: if any base was used more than once, the first also needs a number.
  // Spec examples: "Clock", "Clock 2". First stays unnumbered when unique;
  // when duplicates exist, first stays "Clock" and later get "Clock 2" (encounter order).
  // The loop above already does that (first = base, second = base 2).
  return out;
}

/** Build searchable widget rows for all known registry instances. */
export function buildWidgetRows(
  instances: WidgetInstance[],
  titleFor: (instance: WidgetInstance) => string,
  typeKeywordsFor: (instance: WidgetInstance) => string[],
): PaletteWidgetRow[] {
  const titles = disambiguatedTitles(instances, titleFor);
  const rows: PaletteWidgetRow[] = [];

  for (const instance of instances) {
    const title = titles.get(instance.instanceId) ?? titleFor(instance);
    const hidden = instance.hidden === true;
    rows.push({
      kind: "widget",
      id: `widget:${instance.instanceId}`,
      instanceId: instance.instanceId,
      title,
      subtitle: hidden ? "Show widget" : "Hide widget",
      keywords: typeKeywordsFor(instance),
      hidden,
    });
  }

  return rows;
}

function scoreRow(query: string, title: string, keywords: string[]): number {
  const candidates = [title, ...keywords];
  let best = -1;
  for (const candidate of candidates) {
    const { matched, score } = fuzzyMatch(query, candidate);
    if (matched && score > best) best = score;
  }
  return best;
}

/**
 * Unified filter: empty query ⇒ all commands (no widgets).
 * Non-empty ⇒ scored commands + widgets, best score first.
 */
export function filterPaletteRows(
  query: string,
  commands: Command[],
  widgetRows: PaletteWidgetRow[],
): PaletteRow[] {
  const trimmed = query.trim();

  const commandRows: PaletteCommandRow[] = commands.map((command) => ({
    kind: "command",
    id: command.id,
    title: command.title,
    subtitle: command.subtitle,
    keywords: command.keywords,
    commandId: command.id,
  }));

  if (trimmed.length === 0) {
    return commandRows;
  }

  const scored: { row: PaletteRow; score: number }[] = [];

  for (const row of commandRows) {
    const score = scoreRow(trimmed, row.title, row.keywords);
    if (score >= 0) scored.push({ row, score });
  }

  for (const row of widgetRows) {
    const score = scoreRow(trimmed, row.title, row.keywords);
    if (score >= 0) scored.push({ row, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.row);
}
```

- [ ] **Step 2: Verify with Node assert script**

Run (PowerShell):

```powershell
node --input-type=module -e @"
import assert from 'node:assert/strict';
import { disambiguatedTitles, buildWidgetRows, filterPaletteRows } from './src/palette/paletteResults.ts';

const instances = [
  { instanceId: '1', typeId: 'clock', offset: { x: 0, y: 0 } },
  { instanceId: '2', typeId: 'clock', offset: { x: 0, y: 0 }, hidden: true },
  { instanceId: '3', typeId: 'weather', offset: { x: 0, y: 0 }, title: 'Berlin' },
];
const titleFor = (i) => i.title ?? (i.typeId === 'clock' ? 'Clock' : 'Weather');
const titles = disambiguatedTitles(instances, titleFor);
assert.equal(titles.get('1'), 'Clock');
assert.equal(titles.get('2'), 'Clock 2');
assert.equal(titles.get('3'), 'Berlin');

const rows = buildWidgetRows(instances, titleFor, (i) => [i.typeId, titleFor(i)]);
assert.equal(rows[1].subtitle, 'Show widget');
assert.equal(rows[0].subtitle, 'Hide widget');

const empty = filterPaletteRows('', [{ id: 'c', title: 'Settings', keywords: ['settings'] }], rows);
assert.equal(empty.length, 1);
assert.equal(empty[0].kind, 'command');

const hit = filterPaletteRows('clock', [{ id: 'c', title: 'Settings', keywords: ['settings'] }], rows);
assert.ok(hit.some((r) => r.kind === 'widget' && r.title === 'Clock'));
assert.ok(hit.some((r) => r.kind === 'widget' && r.title === 'Clock 2'));
console.log('ok');
"@
```

Expected: `ok`

- [ ] **Step 3: Commit** — skip (no git in this workspace)

---

### Task 3: Hide in card + host mount filter

**Files:**
- Modify: `src/widgets/WidgetCard.vue`
- Modify: `src/widgets/WidgetInstanceView.vue`
- Modify: `src/widgets/WidgetHost.vue`

**Interfaces:**
- Consumes: `WidgetInstance.hidden`, `saveLayout` / `persist` patterns in host
- Produces:
  - `WidgetCard` emit `hide: []`
  - `WidgetHost.onHide(instanceId: string): void`
  - `WidgetHost.onToggleWidget(instanceId: string): void`
  - `provide("kavibayToggleWidget", onToggleWidget)`
  - `provide("kavibayWidgetInstances", instances)` (reactive array)
  - Template mounts only `!instance.hidden`

- [ ] **Step 1: Add Hide to `WidgetCard.vue`**

Extend emits:

```ts
const emit = defineEmits<{
  rename: [title: string | undefined];
  "update:hideTitle": [hideTitle: boolean];
  duplicate: [];
  hide: [];
  remove: [];
}>();
```

Add handler next to `onRemove`:

```ts
/** Emit hide (soft-close) and close the menu. */
function onHide() {
  menuOpen.value = false;
  emit("hide");
}
```

In the template, insert **Hide** above the separator / Remove block (after the `#menu` slot, before the sep):

```vue
      <slot name="menu" />
      <div class="widget-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        class="widget-menu-item"
        @click="onHide"
      >
        Hide
      </button>
      <button
        type="button"
        role="menuitem"
        class="widget-menu-item widget-menu-item--danger"
        @click="onRemove"
      >
        Remove
      </button>
```

(If a sep already exists above Remove, keep a single sep then Hide then Remove — do not double separators.)

- [ ] **Step 2: Forward `hide` in `WidgetInstanceView.vue`**

Extend emits and card bindings:

```ts
defineEmits<{
  rename: [title: string | undefined];
  "update:hideTitle": [hideTitle: boolean];
  duplicate: [];
  hide: [];
  remove: [];
}>();
```

```vue
    @duplicate="$emit('duplicate')"
    @hide="$emit('hide')"
    @remove="$emit('remove')"
```

- [ ] **Step 3: Host handlers + provide + filter mount in `WidgetHost.vue`**

Add after `onHideTitle`:

```ts
/** Soft-hide one instance (keeps settings and offset; unmounts card). */
function onHide(instanceId: string) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  instance.hidden = true;
  persist();
  scheduleRegionSync();
}

/** Toggle hidden for palette search (open ↔ closed). */
function onToggleWidget(instanceId: string) {
  const instance = instances.find((item) => item.instanceId === instanceId);
  if (!instance) return;
  if (instance.hidden) {
    delete instance.hidden;
  } else {
    instance.hidden = true;
  }
  persist();
  scheduleRegionSync();
}
```

Provide next to `kavibayAddWidget`:

```ts
provide("kavibayAddWidget", onAddType);
provide("kavibayToggleWidget", onToggleWidget);
provide("kavibayWidgetInstances", instances);
```

Update template loop to skip hidden instances:

```vue
    <div
      v-for="instance in instances.filter((i) => !i.hidden)"
      :key="instance.instanceId"
      class="widget-anchor"
      :style="widgetStyle(instance)"
      @pointerdown="
        onPointerDown($event, {
          kind: 'widget',
          instanceId: instance.instanceId,
        })
      "
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <WidgetInstanceView
        v-if="defFor(instance.typeId)"
        :instance="instance"
        :def="defFor(instance.typeId)!"
        @rename="onRename(instance.instanceId, $event)"
        @update:hide-title="onHideTitle(instance.instanceId, $event)"
        @duplicate="onDuplicate(instance.instanceId)"
        @hide="onHide(instance.instanceId)"
        @remove="onRemove(instance.instanceId)"
      />
    </div>
```

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: exit 0

- [ ] **Step 5: Manual check**

1. Open a Clock → ⋯ → Hide → card disappears  
2. Reload app → Clock still gone (persisted)  
3. Confirm other widgets still work  
4. ⋯ → Remove still deletes (use a disposable duplicate)

- [ ] **Step 6: Commit** — skip (no git in this workspace)

---

### Task 4: Wire palette search toggle

**Files:**
- Modify: `src/palette/CommandPalette.vue`

**Interfaces:**
- Consumes:
  - `inject<(id: string) => void>("kavibayToggleWidget")`
  - `inject<WidgetInstance[]>("kavibayWidgetInstances")`
  - `filterPaletteRows`, `buildWidgetRows` from `./paletteResults`
  - `widgetRegistry` for title/keywords
- Produces: unified `results` computed; Enter/click toggles widgets

- [ ] **Step 1: Replace command-only results in `CommandPalette.vue`**

Add imports:

```ts
import { buildWidgetRows, filterPaletteRows, type PaletteRow } from "./paletteResults";
import type { WidgetInstance } from "../widgets/types";
```

Inject:

```ts
const addWidget = inject<(typeId: string) => void>("kavibayAddWidget");
const toggleWidget = inject<(instanceId: string) => void>("kavibayToggleWidget");
const widgetInstances = inject<WidgetInstance[]>("kavibayWidgetInstances");
```

Replace `results` computed:

```ts
const results = computed(() => {
  const instances = widgetInstances ?? [];
  const titleFor = (instance: WidgetInstance) => {
    const def = widgetRegistry.find((d) => d.id === instance.typeId);
    return instance.title ?? def?.title ?? instance.typeId;
  };
  const typeKeywordsFor = (instance: WidgetInstance) => {
    const def = widgetRegistry.find((d) => d.id === instance.typeId);
    const keywords = [instance.typeId];
    if (def?.title) keywords.push(def.title);
    if (instance.title) keywords.push(instance.title);
    return keywords;
  };
  // Skip unknown types (not in registry).
  const known = instances.filter((i) => widgetRegistry.some((d) => d.id === i.typeId));
  const widgetRows = buildWidgetRows(known, titleFor, typeKeywordsFor);
  return filterPaletteRows(query.value, commands, widgetRows);
});
```

- [ ] **Step 2: Handle selection for widget vs command**

Replace `runCommandAt` with:

```ts
async function runResultAt(index: number) {
  if (settingsOpen.value) return;

  const row = results.value[index] as PaletteRow | undefined;
  if (!row) return;

  if (row.kind === "widget") {
    toggleWidget?.(row.instanceId);
    query.value = "";
    selectedIndex.value = 0;
    return;
  }

  if (row.commandId === "open-settings") {
    openSettings();
    return;
  }

  await invoke("execute_action", { actionId: row.commandId });
  await getCurrentWindow().hide();
}
```

Update keydown Enter + list click to call `runResultAt` instead of `runCommandAt`.

- [ ] **Step 3: Update list template bindings**

```vue
    <ul ref="listEl" class="palette-list">
      <li
        v-for="(row, index) in results"
        :key="row.id"
        :data-index="index"
        class="palette-item"
        :class="{ 'palette-item--selected': index === selectedIndex }"
        @mouseenter="selectedIndex = index"
        @click="runResultAt(index)"
      >
        <span class="palette-item-title">{{ row.title }}</span>
        <span v-if="row.subtitle" class="palette-item-subtitle">{{
          row.subtitle
        }}</span>
      </li>
      <li v-if="results.length === 0" class="palette-empty">No matches</li>
    </ul>
```

Update placeholder:

```vue
      placeholder="Search commands and widgets..."
```

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit`  
Expected: exit 0

- [ ] **Step 5: Manual end-to-end**

1. Hide Weather via ⋯  
2. Type `weather` in palette → see Weather with subtitle **Show widget**  
3. Enter → Weather remounts at prior offset with settings  
4. Enter again on same search → hides again (subtitle was **Hide widget**)  
5. Two Clocks → search `clock` shows `Clock` and `Clock 2` independently  
6. Empty query → only commands, no widget dump  
7. Pomodoro: start timer, Hide → timer paused (unmounted); Show → fresh mount from persisted state  

- [ ] **Step 6: Commit** — skip (no git in this workspace)

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `hidden` flag + persist in layout-v3 | Task 1 |
| Hide keeps settings/position | Task 3 (unmount only) |
| Remove unchanged | Task 3 (no change to `onRemove`) |
| Pause while hidden (unmount) | Task 3 filter mount |
| Hide in ⋯ menu | Task 3 |
| Search each instance; toggle | Task 2 + 4 |
| Empty query = commands only | Task 2 `filterPaletteRows` |
| No `execute_action` / window hide on widget | Task 4 |
| Disambiguated titles | Task 2 |
| Duplicate starts visible | Task 1 |
| Unknown typeId omitted from search | Task 4 filter |
| Every widget type | Task 3–4 (host-level, not per-widget) |
