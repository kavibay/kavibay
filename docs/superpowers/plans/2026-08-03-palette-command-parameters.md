# Palette Commands with Parameters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raycast-style actions in the palette — a matched command row accepts typed parameters via
Tab and runs them, either as an OS action (Rust) or against one widget instance (extension),
creating or revealing that widget when it is closed or hidden.

**Architecture:** Declarative `actions` in `manifest.json` + a handler map on `ExtensionModule`;
pure argument parsing/validation in `core/app/palette/commandArgs.ts`; pure target resolution in
`paletteResults.ts`; one generic dispatch branch in `CommandPalette.vue` — no per-extension code in
core.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript, colocated `*.assert.ts` via `npx tsx`, Rust
(Windows Core Audio) for the new OS actions.

**Spec:** `docs/superpowers/specs/2026-08-03-palette-command-parameters-design.md`

> **Post-implementation change (2026-08-03).** Tasks below describe extension actions as their own
> palette rows (`buildActionCommands` → `Command[]`). After seeing it running, that was reversed:
> **an extension owns exactly one row**, and its action hangs off the widget row as
> `PaletteTypeRow.action`, reached with Tab. `buildActionCommands` no longer exists;
> `paletteRowAction(row)` is the accessor for both row kinds. The spec §4 is current — the task text
> below is kept as the record of how it was built.

## Global Constraints

- **No `typeId` switches in `core/app/`.** Extension actions are dispatched through the registry only.
- `sdk/` must not import `core/` — action *types* live in `sdk/extension/types.ts`, the dispatcher in core.
- `extensions/` import only their own folder, `@sdk`, `vue`, `@tauri-apps/*`.
- `manifest.commands` keeps its meaning (Tauri command names). The new key is `actions`, optional
  everywhere, so every existing manifest and installed runtime package stays valid.
- Runtime (sandboxed) packages declaring actions is **out of scope** — but validation of the
  `actions` shape must live in one place so the follow-up can reuse it.
- No vitest/jest. Pure logic gets a colocated `*.assert.ts` with plain node asserts.
- Do not commit unless the user explicitly asks; commit steps below are optional checkpoints.
- Verify with the relevant `npx tsx …assert.ts`, then `npm run build` after FE tasks and
  `cd src-tauri && cargo test --lib` after Rust tasks.

## File map

| File | Responsibility |
|------|----------------|
| `sdk/extension/types.ts` | `ActionParam`, `ExtensionAction`, `ActionArgs`, `ExtensionActionContext`; `actions` on manifest/module/registered |
| `core/app/palette/commandArgs.ts` | **New** — pure validate/normalize of chip inputs |
| `core/app/palette/commandArgs.assert.ts` | **New** — required/number/enum/trim cases |
| `core/app/palette/paletteResults.ts` | `PaletteCommandRow` fields, `buildActionCommands`, `resolveActionTarget` |
| `core/app/palette/paletteResults.assert.ts` | Action-row + target-resolution asserts |
| `core/app/palette/commands.ts` | `params` on `Command`; volume / mute / lock / media rows |
| `core/app/extensions/loadExtensions.ts` | Normalize `actions`, `runExtensionAction`, dev warnings |
| `core/app/palette/CommandPalette.vue` | Argument mode (state, chips, keys) + generic dispatch |
| `extensions/timer/{manifest.json,index.ts}` | `set-timer` action |
| `extensions/pomodoro/{manifest.json,index.ts}` | `pomodoro` action — enum + optional number (the multi-param case) |
| `extensions/todo/{manifest.json,index.ts}` | `todo-add` action — free text with spaces |
| `src-tauri/src/commands.rs` | `execute_action(action_id, args)`; `set_volume`, `toggle_mute`, `lock_screen` |
| `src-tauri/src/lib.rs` | Register the new commands |
| `src-tauri/Cargo.toml` | `Win32_Media_Audio*`, `Win32_System_Shutdown` features |
| `docs/extensions.md` | "Actions" section for extension authors |

---

### Task 1: Action types in the SDK

**Files:**
- Modify: `sdk/extension/types.ts`

**Interfaces:**
- Produces:
  - `ActionParam = { name: string; type: "text" | "number" | "enum"; required: boolean; placeholder?: string; options?: string[] }`
  - `ExtensionAction = { id: string; title: string; subtitle?: string; keywords: string[]; params?: ActionParam[]; needsInstance?: boolean }`
  - `ActionArgs = Record<string, string>`
  - `ExtensionActionContext = { instanceId: string; args: ActionArgs }`
  - `ExtensionActionHandler = (ctx: ExtensionActionContext) => void | Promise<void>`
  - `ExtensionManifest.actions?: ExtensionAction[]`
  - `ExtensionModule.actions?: Record<string, ExtensionActionHandler>`
  - `RegisteredExtension.actions: ExtensionAction[]` (normalized, never undefined)

- [x] **Step 1: Add the types**

  Types only — no runtime code, no imports beyond `vue`'s `Component` already there. Keep the
  doc-comment style of the surrounding interfaces (one line, says *why* where non-obvious).

  Document on `ExtensionManifest.actions` that it is **not** `commands`: `commands` stays the list of
  declared Tauri command names.

- [x] **Step 2: Verify**

  ```bash
  npm run build
  ```

  Must stay green: every new field is optional, so no existing extension breaks.

---

### Task 2: Argument parsing and validation (pure logic)

**Files:**
- Create: `core/app/palette/commandArgs.ts`
- Create: `core/app/palette/commandArgs.assert.ts`

**Interfaces:**
- Produces:
  - `type ArgValidation = { ok: true; args: ActionArgs } | { ok: false; invalidIndex: number }`
  - `validateActionArgs(params: readonly ActionParam[], values: readonly string[]): ArgValidation`
  - `paramPlaceholder(param: ActionParam): string` — `param.placeholder ?? param.name`; for `enum`
    without an explicit placeholder, `options.join(" | ")`
  - `nextParamIndex(current: number, count: number): number` — Tab cycles (`count - 1` → `0`)
  - `firstInvalidIndex(params, values): number` — `-1` when all valid

**Rules (from spec §5):**
- Values are trimmed before validation and before being written into `args`.
- Empty + `required` → invalid at that index.
- Empty + optional → key omitted from `args` entirely (handlers see `undefined`, not `""`).
- `number` → must parse as a finite number (`Number(value)`, reject `""`, `NaN`, `Infinity`).
- `enum` → case-insensitive match against `options`; the **canonical** option string is emitted.
- Unknown/malformed `enum` without `options` → treat as `text` (fail open on shape, not on value).

- [x] **Step 1: Write the failing asserts**

  Create `commandArgs.assert.ts`:

  ```ts
  /**
   * Run: npx tsx core/app/palette/commandArgs.assert.ts
   */
  import assert from "node:assert/strict";
  import type { ActionParam } from "@sdk/types";
  import {
    firstInvalidIndex,
    nextParamIndex,
    paramPlaceholder,
    validateActionArgs,
  } from "./commandArgs";

  const text = (name: string, required = true): ActionParam => ({ name, type: "text", required });
  const num = (name: string, required = true): ActionParam => ({ name, type: "number", required });
  const en = (name: string, options: string[]): ActionParam => ({
    name,
    type: "enum",
    required: true,
    options,
  });

  // required + empty → invalid at that index
  assert.deepEqual(validateActionArgs([text("item")], [""]), { ok: false, invalidIndex: 0 });
  assert.deepEqual(validateActionArgs([text("item")], ["   "]), { ok: false, invalidIndex: 0 });

  // trimming
  assert.deepEqual(validateActionArgs([text("item")], ["  milk  "]), {
    ok: true,
    args: { item: "milk" },
  });

  // optional empty → key omitted, not ""
  assert.deepEqual(validateActionArgs([text("item"), text("list", false)], ["milk", ""]), {
    ok: true,
    args: { item: "milk" },
  });

  // number
  assert.deepEqual(validateActionArgs([num("level")], ["0"]), { ok: true, args: { level: "0" } });
  assert.deepEqual(validateActionArgs([num("level")], ["100"]), { ok: true, args: { level: "100" } });
  assert.deepEqual(validateActionArgs([num("level")], ["abc"]), { ok: false, invalidIndex: 0 });
  assert.deepEqual(validateActionArgs([num("level")], ["Infinity"]), { ok: false, invalidIndex: 0 });

  // enum: case-insensitive, canonical value emitted
  const mode = en("mode", ["start", "stop", "restart"]);
  assert.deepEqual(validateActionArgs([mode], ["Start"]), { ok: true, args: { mode: "start" } });
  assert.deepEqual(validateActionArgs([mode], ["paused"]), { ok: false, invalidIndex: 0 });

  // reports the FIRST offender, not the last
  assert.deepEqual(validateActionArgs([text("a"), num("b")], ["", "x"]), {
    ok: false,
    invalidIndex: 0,
  });
  assert.equal(firstInvalidIndex([text("a"), num("b")], ["ok", "x"]), 1);
  assert.equal(firstInvalidIndex([text("a")], ["ok"]), -1);

  // no params → always valid, empty args
  assert.deepEqual(validateActionArgs([], []), { ok: true, args: {} });

  // placeholders
  assert.equal(paramPlaceholder(text("item")), "item");
  assert.equal(paramPlaceholder({ ...num("level"), placeholder: "Volume (0-100)" }), "Volume (0-100)");
  assert.equal(paramPlaceholder(mode), "start | stop | restart");

  // Tab cycles
  assert.equal(nextParamIndex(0, 2), 1);
  assert.equal(nextParamIndex(1, 2), 0);
  assert.equal(nextParamIndex(0, 1), 0);

  console.log("commandArgs.assert.ts: ok");
  ```

- [x] **Step 2: Implement `commandArgs.ts` until the asserts pass**

  Pure functions only — no Vue, no DOM, no imports from `core/`.

- [x] **Step 3: Verify**

  ```bash
  npx tsx core/app/palette/commandArgs.assert.ts
  ```

---

### Task 3: Action rows and target resolution

**Files:**
- Modify: `core/app/palette/paletteResults.ts`
- Modify: `core/app/palette/paletteResults.assert.ts`

**Interfaces:**
- Modifies `Command` (in `commands.ts`): adds optional `extId?: string`, `params?: ActionParam[]`,
  `needsInstance?: boolean`
- Modifies `PaletteCommandRow`: adds `extId?: string`, `params: ActionParam[]` (normalized to `[]`),
  `needsInstance: boolean` (normalized to `true` for extension actions, `false` for OS actions)
- Produces:
  - `buildActionCommands(extensions: { id: string; title: string; actions: ExtensionAction[] }[]): Command[]`
  - `type ActionTarget = { mode: "use" | "reveal" | "create"; instanceId?: string }`
  - `resolveActionTarget(typeId: string, instances: WidgetInstance[]): ActionTarget`

**Why `Command[]` and not `PaletteCommandRow[]`:** `filterPaletteRows` already maps `Command` →
`PaletteCommandRow`. Emitting rows directly would mean a second construction path for the same row
kind. Action commands are appended to the OS command list at the call site; the existing mapping
copies the three new fields through.

**Rules (spec §4, §6):**
- Row id is `action:<extId>:<actionId>` so it cannot collide with command / type / widget ids.
- `commandId` carries the bare action id; `extId` distinguishes extension from OS actions.
- Keywords indexed: action title + declared keywords + the extension title (so `timer` finds
  `Set Timer`). **Not** the description — same false-positive reasoning as `buildTypeRows`.
- `needsInstance` defaults to `true` when the manifest omits it.
- Target order: **visible → hidden → create**. Deliberately different from `resolveTypeSmart`, which
  prefers hidden-first; add a one-line comment saying so, or the next reader will "fix" it.
- Several candidates → first in instance order (V1; picker deferred).

- [x] **Step 1: Extend the existing asserts**

  Append to `paletteResults.assert.ts` (keep the existing cases untouched):

  ```ts
  // --- action rows -------------------------------------------------------
  const timerExt = {
    id: "timer",
    title: "Timer",
    actions: [
      {
        id: "set-timer",
        title: "Set Timer",
        keywords: ["timer", "countdown"],
        params: [{ name: "duration", type: "text" as const, required: true }],
      },
    ],
  };

  const actionCmds = buildActionCommands([timerExt, { id: "clock", title: "Clock", actions: [] }]);
  assert.equal(actionCmds.length, 1, "extensions without actions contribute nothing");
  assert.equal(actionCmds[0]!.id, "action:timer:set-timer");
  assert.equal(actionCmds[0]!.extId, "timer");
  assert.equal(actionCmds[0]!.needsInstance, true, "needsInstance defaults to true");
  assert.ok(actionCmds[0]!.keywords.includes("Timer"), "extension title is searchable");

  // action commands score through the existing command path, fields carried through
  const matched = filterPaletteRows("set tim", actionCmds, []);
  assert.equal(matched.length, 1);
  assert.equal(matched[0]!.kind, "command");
  assert.equal((matched[0] as PaletteCommandRow).extId, "timer");
  assert.equal((matched[0] as PaletteCommandRow).params.length, 1);
  assert.equal(filterPaletteRows("zzzz", actionCmds, []).length, 0);

  // --- target resolution -------------------------------------------------
  const inst = (instanceId: string, typeId: string, hidden = false) =>
    ({ instanceId, typeId, hidden }) as WidgetInstance;

  assert.deepEqual(resolveActionTarget("timer", []), { mode: "create" });
  assert.deepEqual(resolveActionTarget("timer", [inst("a", "timer", true)]), {
    mode: "reveal",
    instanceId: "a",
  });
  assert.deepEqual(resolveActionTarget("timer", [inst("a", "timer")]), {
    mode: "use",
    instanceId: "a",
  });
  // visible wins over hidden — opposite of resolveTypeSmart
  assert.deepEqual(
    resolveActionTarget("timer", [inst("h", "timer", true), inst("v", "timer")]),
    { mode: "use", instanceId: "v" },
  );
  // other types are ignored
  assert.deepEqual(resolveActionTarget("timer", [inst("c", "clock")]), { mode: "create" });
  // several visible → first in order
  assert.deepEqual(
    resolveActionTarget("timer", [inst("v1", "timer"), inst("v2", "timer")]),
    { mode: "use", instanceId: "v1" },
  );
  ```

- [x] **Step 2: Implement in `paletteResults.ts`**

  Keep `filterPaletteRows`'s signature: action rows are `PaletteCommandRow`s, so they arrive through
  the existing `commands` parameter path or a merged array at the call site — do **not** add a
  seventh positional parameter. Prefer merging OS commands and action rows into one `Command[]`-ish
  list before the call.

- [x] **Step 3: Verify**

  ```bash
  npx tsx core/app/palette/paletteResults.assert.ts
  ```

---

### Task 4: Registry normalization + action dispatch

**Files:**
- Modify: `core/app/extensions/loadExtensions.ts`

**Interfaces:**
- Produces:
  - `runExtensionAction(ext: RegisteredExtension | undefined, actionId: string, ctx: ExtensionActionContext): Promise<boolean>`
  - `normalizeActions(raw: unknown): ExtensionAction[]` (internal; exported only if an assert needs it)

- [x] **Step 1: Normalize manifest actions at load time**

  Where the manifest is merged into `RegisteredExtension`, map `actions` to a normalized array:
  drop entries without a string `id`/`title`, default `params` to `[]`, default `needsInstance` to
  `true`, drop params without a `name`, coerce an unknown `type` to `"text"`.

  Fail **soft** here (skip the bad entry, `console.warn`) — a malformed action must not take the
  whole extension out of the registry.

- [x] **Step 2: Dev-time consistency warnings**

  After merge, warn once per extension when:
  - a manifest action id has no handler in `module.actions` → drop the action from the registry
    (no dead palette row)
  - a handler exists with no manifest entry → keep it out of the registry, warn

  Follow the existing `[kavibay] Extension "<id>" …` message style.

- [x] **Step 3: Implement `runExtensionAction`**

  Mirrors `runExtensionHook`: look up the handler, `try/catch` around it (now also `await`), log
  `[kavibay] Extension "<id>" action "<actionId>" failed:` on throw, return `false`. Return `false`
  when the extension or handler is missing. One broken extension must never break the palette.

- [x] **Step 4: Verify**

  ```bash
  npm run build
  ```

  Then `npm run tauri dev` and confirm the console shows no new warnings for the shipped extensions.

---

### Task 5: Argument mode in the palette (UI + keys)

**Files:**
- Modify: `core/app/palette/CommandPalette.vue`

**State to add:**
- `argMode = ref(false)`
- `argValues = ref<string[]>([])` — one slot per param of the active row
- `activeParamIndex = ref(0)`
- `argInputEls = ref<HTMLInputElement[]>([])`
- `activeActionRow = computed(() => …)` — the selected row when it is a command row with `params.length > 0`

- [x] **Step 1: Markup**

  Wrap the existing search `<input>` (line ~1753) in a flex row `.palette-input-row`:

  - **Not** in argument mode: today's `<input>` unchanged, `flex: 1`.
  - In argument mode: the input is replaced by `<span class="palette-input-echo">{{ query }}</span>`
    (a span sizes to content — no mirror-measuring), followed by one `<input class="palette-arg-chip">`
    per param, each with `:placeholder="paramPlaceholder(param)"` and `@keydown.capture="onKeydown"`.

  Chip styling: grey pill matching the reference screenshot; the active chip is highlighted. Width
  via `field-sizing: content` with a `min-width` fallback in `ch` derived from the placeholder
  length — chip sizing is cosmetic, do not build a measuring harness for it.

  Reuse the existing palette CSS variables; no new colour literals.

- [x] **Step 2: Enter / leave argument mode**

  - `enterArgMode()`: only when `activeActionRow` is set; seed `argValues` with `""` per param
    (or the cached values if re-entering for the same row + query), set `activeParamIndex = 0`,
    focus that chip on `nextTick`.
  - `exitArgMode(opts: { keepValues?: boolean })`: clear `argMode`, restore the search input, focus
    it with the caret at the end.
  - Auto-exit (clearing values) when `query` changes or `selectedIndex` changes — add to the
    existing watchers rather than new ones.

- [x] **Step 3: Key handling in `onKeydown`**

  Extend the existing handler; **do not** add a second listener.

  | Key | Behavior |
  |-----|----------|
  | `Tab` (not in arg mode) | If `activeActionRow` → `enterArgMode()` and `preventDefault()`. Otherwise the current jump-into-widget path (`leftSearchViaTab`) — unchanged. |
  | `Tab` (in arg mode) | `nextParamIndex(...)`, focus that chip, `preventDefault()`. Never leaves arg mode. |
  | `Shift+Tab` (in arg mode, index > 0) | Previous chip. |
  | `Shift+Tab` (in arg mode, index 0) | `exitArgMode({ keepValues: true })`. |
  | `Backspace` on an empty chip at index 0 | Same as above. |
  | `ArrowUp` / `ArrowDown` | Existing selection movement (the selection watcher exits arg mode). |
  | `Enter` | `runResultAt(selectedIndex)` — validation happens there (Task 6). |
  | `Escape` (in arg mode) | `exitArgMode()`, `preventDefault()` so the palette stays open. |

  The document-capture `Shift+Tab` handler (`onDocumentShiftTab`) must **bail out while
  `argMode` is true**, or it will steal the back-navigation between chips.

- [x] **Step 4: Discoverability hint**

  In the results list, rows with `params.length > 0` render a `⇥` hint next to the existing
  `Command` label. Without it nobody finds Tab.

- [x] **Step 5: Verify**

  ```bash
  npm run build
  ```

  Manual (`npm run tauri dev`): type `set tim`, press Tab → chip appears; ↑/↓ dismisses it; Escape
  returns to search without closing the palette; Tab on a plain widget row still jumps into the
  widget.

---

### Task 6: Dispatch actions from the palette

**Files:**
- Modify: `core/app/palette/CommandPalette.vue`

- [x] **Step 1: Validate before running**

  At the top of the command branch in `runResultAt` (line ~1086):

  ```
  if (row.params.length > 0) {
    if (!argMode) → enterArgMode(); return;          // Enter also opens chips
    const result = validateActionArgs(row.params, argValues);
    if (!result.ok) → focus chip result.invalidIndex; return;   // no toast, no close
  }
  ```

- [x] **Step 2: Extension actions — one generic branch**

  Before the existing per-command `if` chain (it stays for settings/gallery/onboarding/prefix rows):

  ```
  if (row.extId) {
    const ext = getExtension(row.extId);
    let instanceId = "";
    if (row.needsInstance) {
      const target = resolveActionTarget(row.extId, widgetInstances ?? []);
      if (target.mode === "create") instanceId = addWidget?.(row.extId) ?? "";
      else {
        instanceId = target.instanceId!;
        if (target.mode === "reveal") toggleWidget?.(instanceId);
      }
      if (!instanceId) return;              // creation refused → keep palette open
    }
    const ok = await runExtensionAction(ext, row.commandId, { instanceId, args });
    if (!ok) return;                         // handler threw → keep palette open
    exitArgMode(); afterPaletteAction(); dismissAfterAction();
    return;
  }
  ```

  No `nextTick` and no waiting for the widget to mount: handlers write into the per-instance state
  cache, which the widget reads when it mounts (spec §6).

- [x] **Step 3: OS actions**

  - `media-next` / `media-previous` / `media-play-pause` → `invoke("now_playing_next" | …)`,
    following the `search-google` pattern of a named special case.
  - Everything else → `invoke("execute_action", { actionId: row.commandId, args })`.

  On a rejected invoke: keep the palette open and keep the query (existing failure convention).

- [x] **Step 4: Verify**

  ```bash
  npm run build
  ```

---

### Task 7: Extension actions (timer, pomodoro, todo)

**Files:**
- Modify: `extensions/timer/{manifest.json,index.ts}`
- Modify: `extensions/pomodoro/{manifest.json,index.ts}`
- Modify: `extensions/todo/{manifest.json,index.ts}`

All three stores are module-level `Map`s with a lazy `ensure`, so calling `use*State(instanceId)`
from a handler works before the widget mounts and returns the *same* object the component later gets.

- [x] **Step 1: Timer — `set-timer`**

  Manifest:
  ```json
  "actions": [
    {
      "id": "set-timer",
      "title": "Set Timer",
      "subtitle": "Start a countdown",
      "keywords": ["timer", "countdown", "start"],
      "params": [
        { "name": "duration", "type": "text", "required": true, "placeholder": "Duration (25m, 1h30)" }
      ]
    }
  ]
  ```

  Handler in `index.ts` — reuse the existing `parseCustomDuration` from `timerLogic.ts` (it already
  parses `25m` / `1h30`); on `null` throw so the palette stays open:

  ```
  const ms = parseCustomDuration(args.duration ?? "");
  if (ms == null) throw new Error(`unparsable duration: ${args.duration}`);
  const state = useTimerState(instanceId);
  state.reset();               // clears running/ringing so canEditDuration is true
  state.setCustomDuration(ms);
  state.start();
  ```

  `reset()` before `setCustomDuration` is required: `setCustomDuration` is a no-op while the timer
  runs or rings.

- [x] **Step 2: Pomodoro — `pomodoro` (enum + optional number) — the multi-param case**

  Params:
  ```json
  [
    { "name": "mode", "type": "enum", "required": true, "options": ["start", "stop", "restart"] },
    { "name": "minutes", "type": "number", "required": false, "placeholder": "Focus min (optional)" }
  ]
  ```

  Handler, using only existing store APIs:

  ```
  const s = usePomodoroState(instanceId);
  if (args.minutes !== undefined) {
    s.syncDrafts();
    s.draftFocus.value = Number(args.minutes);   // clampMinutes runs inside saveSettings
    s.saveSettings();                            // updates remainingMs while not running
  }
  if (mode === "stop") s.stop();
  else {
    if (mode === "restart") s.reset();
    s.start();
  }
  ```

  Order matters: `saveSettings` only recomputes `remainingMs` when the timer is not running, so the
  minutes must be applied before `start()`.

- [x] **Step 3: Todo — `todo-add`**

  One param: `item` (text, required, placeholder `Task`). Proves a chip carrying free text with
  spaces (`todo add buy milk and eggs`).

  Handler: `const { addRoot, setText } = useTodoState(instanceId); setText(addRoot(), args.item)`.

  Do **not** add a `list` param: `todoLogic.ts` has no list concept, and inventing one belongs in a
  todo feature task, not here.

- [x] **Step 4: Verify**

  ```bash
  npm run build
  ```

  Manual, per spec §Testing cases 1–4: closed / hidden / visible timer, then the enum and the
  multi-param action.

---

### Task 8: OS actions in Rust

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`
- Modify: `core/app/palette/commands.ts`

- [x] **Step 1: `execute_action` takes args**

  ```rust
  pub fn execute_action(action_id: String, args: HashMap<String, String>) -> Result<(), String>
  ```

  Unknown `action_id` returns `Err` instead of silently succeeding — a typo in a palette row must be
  visible. Keep the existing `println!` behaviour for the stub ids so nothing regresses.

- [x] **Step 2: Volume + mute (Windows)**

  Add the `Win32_Media_Audio` / `Win32_Media_Audio_Endpoints` and `Win32_System_Shutdown` features to
  the existing `windows = "0.61"` block in `Cargo.toml`.

  `IMMDeviceEnumerator` → default render endpoint → `IAudioEndpointVolume`:
  `SetMasterVolumeLevelScalar(level / 100.0)` and `SetMute(!GetMute())`. COM must be initialized on
  the calling thread — follow whatever `now_playing.rs` / `installed_apps.rs` already do rather than
  inventing a new pattern.

  `level` is validated in Rust independently of the FE: reject non-numeric and out-of-range with a
  descriptive `Err`.

  Non-Windows: `#[cfg(not(windows))]` stubs returning `Err("unsupported platform")`, matching how the
  other Windows-only commands are gated.

- [x] **Step 3: Lock screen**

  `LockWorkStation()` behind `#[cfg(windows)]`, same stub pattern elsewhere.

- [x] **Step 4: Register + palette rows**

  Register the new commands in `lib.rs`'s `invoke_handler`, one line each, keeping the module groups
  sorted (merge etiquette).

  In `commands.ts`: `set-volume` (number param, placeholder `Volume (0-100)`), `toggle-mute`,
  `media-next`, `media-previous`, `media-play-pause`. Give `lock-screen` its params-free entry —
  it already exists as a row.

- [x] **Step 5: Rust tests**

  `#[cfg(test)]` for the argument parsing that is platform-independent: out-of-range `level`,
  non-numeric `level`, unknown action id. Do not test the COM calls.

- [x] **Step 6: Verify**

  ```bash
  cd src-tauri && cargo test --lib
  ```

  Baseline is 105+ tests — keep them green. Then manual: `set vol` → Tab → `20` → Enter changes
  system volume; `mute` toggles; `next` skips the track in a running player.

---

### Task 9: Document the contract

**Files:**
- Modify: `docs/extensions.md`

- [x] **Step 1: Write the "Actions" section**

  Cover, in the voice of the existing sections:
  - the `actions` manifest block with a full example
  - the handler map on `ExtensionModule` and why it is split from the manifest
  - `needsInstance` and the visible → hidden → create resolution
  - the rule that handlers write to the per-instance store (safe before mount) and must not assume a
    mounted component
  - that `commands` is unrelated (Tauri command names)
  - that runtime (sandboxed) packages cannot declare actions yet

- [x] **Step 2: Verify**

  Re-read against the shipped `timer` manifest — the example must match what actually works.

---

## Final verification

- [x] `npx tsx core/app/palette/commandArgs.assert.ts`
- [x] `npx tsx core/app/palette/paletteResults.assert.ts`
- [x] `npm run build`
- [x] `cd src-tauri && cargo test --lib`
- [x] `node scripts/runtimeSandboxGuard.assert.mjs` (untouched, but cheap insurance)
- [x] Manual walkthrough of spec §Testing cases 1–7
- [x] Success criteria in spec §Success criteria all met — in particular: zero per-extension code in
      `core/app/`, and `manifest.commands` semantics unchanged
