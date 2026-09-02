# Palette Commands with Parameters (Raycast-style Actions) — Design

**Date:** 2026-08-03
**Status:** Draft — awaiting approval for implementation planning
**Approach:** Declarative `actions` in the manifest + handler map in `index.ts`; Tab-driven argument
mode in the palette with one input per parameter; target instance resolved visible → hidden → create.

## Goal

Turn the palette from "find and open" into "get it done without UI". Typing `set timer`, pressing
Tab, typing `25m`, pressing Enter should start a timer — without the widget ever needing a click.

Two sources of actions, one execution model:

- **OS actions** — `set volume <0-100>`, `mute`, `lock screen`. Owned by core, run in Rust.
- **Extension actions** — declared per extension, run against one widget instance:
  `set timer <time>`, `pomodoro <start|stop|restart>`, `todo add <item>`.

## Non-goals

- **Runtime packages (sandboxed) declaring actions.** `HostToExt` in `bridgeProtocol.ts` only carries
  *replies* today; host-initiated invoke is a new direction with request/response, timeout, a new
  permission, and the "iframe not mounted" case. Deliberate follow-up — see §9.
- **Inline arguments without Tab** (`set timer 25m` typed as one string). Fuzzy match is a
  subsequence test, so the argument text breaks the match against the command title. Needs
  per-command prefix parsing; deferred. Tab is the only way into argument mode in V1 (Raycast is the
  same).
- **Enum dropdown / autocomplete inside a parameter.** Enum values are validated, not suggested.
- **Multi-instance disambiguation UI** (three timers open, which one?). V1 applies a fixed
  preference order (§6); the picker is a separate discussion.
- **Generated static variant rows** (`Set Volume to 0%` next to `Set Volume`, as Raycast shows).
  Cheap to add later from `enum` options; not V1.
- **A second action per extension.** One extension = one palette row = one Tab, so only the first
  declared action is reachable. A picker for several actions is a follow-up.
- Recording actions in `recentPaletteRuns` (empty-query recents stay commands/apps only).

## Constraints

- Host stays generic: **no `typeId` switches**. The palette must never know that `timer` has a
  `set-timer` action — it reads the registry.
- `sdk/` must not import `core/`. Action *types* live in `sdk/extension/types.ts`; the dispatcher
  lives in core.
- `extensions/` import only their own folder, `@sdk`, `vue`, `@tauri-apps/*`.
- Pure logic gets a colocated `*.assert.ts` (plain node asserts via `tsx`). No vitest.
- `manifest.commands` keeps its current meaning (**declared Tauri command names**,
  `sdk/extension/types.ts:55`, validated fail-closed in `manifestValidate.ts:151`). Renaming it would
  break already-installed runtime packages. The new key is **`actions`**.

## 1. Terminology

| Term | Meaning |
|------|---------|
| **Tauri command** | Rust IPC name. Stays `manifest.commands`. Unchanged by this work. |
| **Action** | A palette-invokable operation with optional parameters. New concept. |
| **OS action** | Action owned by core, executed in Rust via `execute_action`. |
| **Extension action** | Action declared by an extension, executed against one instance in the FE. |

The palette shows both as `Command` in the right-hand type column (as in the Raycast reference
screenshot) — "Action" is an internal term.

## 2. Data model

New in `sdk/extension/types.ts` (MIT, no core imports):

```ts
/** One parameter of an action, rendered as an inline chip in the palette. */
export interface ActionParam {
  /** Key in the args record handed to the handler. */
  name: string;
  type: "text" | "number" | "enum";
  required: boolean;
  /** Grey chip text before input, e.g. "Volume (0-100)". Defaults to `name`. */
  placeholder?: string;
  /** `enum` only — accepted values, matched case-insensitively. */
  options?: string[];
}

/** An action declared in manifest.json. */
export interface ExtensionAction {
  /** Unique within the extension; key into the handler map. */
  id: string;
  title: string;
  subtitle?: string;
  keywords: string[];
  /** Empty / omitted = runs immediately on Enter, no argument mode. */
  params?: ActionParam[];
  /**
   * When false the action runs without a widget instance (nothing is created).
   * Default true: the action targets one instance (§6).
   */
  needsInstance?: boolean;
}
```

`ExtensionManifest` gains `actions?: ExtensionAction[]` (optional — every existing manifest stays
valid). `RegisteredExtension` carries `actions: ExtensionAction[]` (normalized to `[]`).

Handlers are code, so they live in `index.ts` next to the lifecycle hooks:

```ts
export type ActionArgs = Record<string, string>;

export interface ExtensionActionContext {
  /** Resolved target instance; empty string when needsInstance is false. */
  instanceId: string;
  args: ActionArgs;
}

// on ExtensionModule:
actions?: Record<string, (ctx: ExtensionActionContext) => void | Promise<void>>;
```

Actions are surfaced on the extension's own palette row (§4) — never as separate rows.

**Why split manifest and module:** the manifest is catalog data (searchable before the module is
touched, and the shape a future store/settings UI reads); the handler is code. Same split the
existing `commands` / `backendCommand` pair already uses.

`loadExtensions.ts` warns (dev console, like the icon assert) when a manifest declares an action id
with no handler, or a handler with no manifest entry. Missing handler = the row is not built, so a
broken extension cannot produce a dead palette row.

## 3. OS actions

`core/app/palette/commands.ts` grows the same optional `params` field on `Command`. `execute_action`
gains an args map:

```rust
pub fn execute_action(action_id: String, args: HashMap<String, String>) // was: (action_id: String)
```

V1 implements these (the rest of `commands.ts` stays the current `println!` stubs):

| id | params | Windows impl |
|----|--------|--------------|
| `set-volume` | `level: number, required` (0–100) | **New:** `IAudioEndpointVolume::SetMasterVolumeLevelScalar` |
| `toggle-mute` | — | **New:** `IAudioEndpointVolume::SetMute` |
| `lock-screen` | — | **New:** `LockWorkStation` |
| `media-next` | — | **Existing** `now_playing_next` |
| `media-previous` | — | **Existing** `now_playing_prev` |
| `media-play-pause` | — | **Existing** `now_playing_play_pause` |

Media transport needs no new Rust: `now_playing.rs` already drives SMTC (`TrySkipNextAsync` etc.)
and the three commands are registered in `lib.rs`. These rows invoke those command names directly
instead of going through `execute_action` — the palette already has that pattern for
`search-google` / `search-files`. The only new Rust is audio + lock.

Rust validates independently of the FE: out-of-range `level` returns an error, the palette stays
open (same failure rule as `launch_path`).

## 4. Palette rows

`PaletteCommandRow` gains only what OS commands need; the extension action lives on the type row:

```ts
export interface PaletteCommandRow {
  kind: "command";
  // …existing fields…
  params: ActionParam[];      // [] = no argument chips
  invokeCommand?: string;     // direct Tauri command instead of execute_action
}

export interface PaletteTypeRow {
  kind: "type";
  // …existing fields…
  action?: ExtensionAction;   // reachable with Tab on this row
}
```

**One row per extension** (decided 2026-08-03, after seeing it in the app). An extension action does
**not** get its own row — it hangs off that extension's existing type row as
`PaletteTypeRow.action`, and the action's title and keywords are folded into that row's keywords so
`start` still finds Pomodoro. Rationale: actions belong to an extension the same way its widget
does; two rows titled "Pomodoro" is noise, not choice.

Consequences:

- `PaletteCommandRow` stays what it always was — **OS commands only**. No `extId` on it.
- `paletteRowAction(row)` is the one accessor both row kinds go through, so the argument UI and the
  dispatcher never branch on row kind.
- Only the **first** declared action rides along. A second action would need a picker — deferred.
- **Tab on a type row with an action opens the chips**, which displaces the existing
  jump-into-widget shortcut for those extensions. Enter still focuses a visible instance, so the
  widget is not unreachable, but the keep-palette-open jump is gone for them.

## 5. Argument mode (UX)

Rendered exactly like the reference: the search text stays, grey chips follow it.

```
┌──────────────────────────────────────────────┐
│ 🔊  set vol   [ Volume (0-100) ]             │
└──────────────────────────────────────────────┘
```

**One `<input>` per parameter**, inline after the search text, auto-sized from the placeholder.
This is deliberate: native caret handling, IME, and Shift+Tab come for free, and because the search
input's value never changes while arguments are typed, the results list freezes on the selected row
with no extra state.

While in argument mode the search `<input>` is replaced by a **static echo `<span>`** carrying the
same text. A span sizes itself to its content, so there is no mirror-measuring hack to keep the
search text and the chips flush. Editing the search text requires leaving argument mode anyway
(Shift+Tab from param 1), which restores the real input and puts the caret at the end.

| Key | In argument mode |
|-----|------------------|
| `Tab` (from search) | Enter argument mode **only if the selected row has params**; focus param 1. Otherwise the existing jump-into-widget behavior (`leftSearchViaTab`) is unchanged. |
| `Tab` | Next param; cycles from the last back to the first. Never leaves argument mode. |
| `Shift+Tab` | Previous param; **from param 1 back to the search input** (leaves argument mode, keeps typed args cached for re-entry within the same query). |
| `Backspace` on empty param 1 | Same as Shift+Tab from param 1. |
| `↑` / `↓` | Move the result selection as usual; changing the selected row **exits** argument mode and clears args. |
| `Enter` | Validate, then run. |
| `Escape` | Leave argument mode and clear args. A second Escape closes the palette as today. |

The chip stack is also exited whenever the search text itself changes.

**Validation on Enter** (pure function, `commandArgs.ts`):

- every `required` param non-empty — otherwise focus the first offender and do nothing (no error toast)
- `number` params parse as a finite number
- `enum` params match one of `options` case-insensitively; the canonical option value is passed on

Only valid runs dismiss the palette (`afterPaletteAction` + `dismissAfterAction`), matching how the
app-launch path treats failures.

**Discoverability:** two signals, both needed. The chips render **dimmed inline the moment a row
with an action is selected** — before Tab is pressed — so the input field is visibly waiting for
something. And the row gets a `⇥ <action title>` button on the right, which is what actually names
the key and the action ("⇥ Set Timer" on the Timer row).

The search input hugs its text (`field-sizing: content`) while chips are on screen, so the first
chip sits right after what was typed instead of at the far edge.

## 6. Target instance resolution

For `needsInstance` actions, resolved in this order — note it deliberately differs from
`resolveTypeSmart`, which prefers hidden-first:

1. **A visible instance of the type exists** → use it. (If it is on screen, that is the one meant.)
2. **Only hidden instances** → `toggleWidget(instanceId)` to reveal, then use it.
3. **No instance** → `addWidget(typeId)` (returns the new instanceId), then use it.
4. **Several candidates** in step 1 or 2 → first in instance order. V1 only; picker deferred.

This is one pure function in `paletteResults.ts` (`resolveActionTarget(typeId, instances)`) returning
`{ mode: "use" | "reveal" | "create", instanceId? }`, so it is testable without the host.

**Why create-then-run works:** extension state lives in module-level `createInstanceStore` maps keyed
by `instanceId`, not in the component. The handler writes to the store immediately; the freshly
created widget picks the state up when it mounts. No waiting for `nextTick`, no mounted-component
dependency. This is the reason handlers belong in `index.ts` and not inside a `.vue`.

Handler errors are caught and logged like `runExtensionHook` does — one broken extension must not
break the palette. On error the palette stays open.

## 7. Dispatch

```
Enter
  → row.kind === "command"
      → parseActionArgs(params, inputs)     // pure, validated
      → row.extId ?  runExtensionAction(extId, actionId, args)
                   :  invoke("execute_action", { actionId, args })
```

`runExtensionAction` lives next to `runExtensionHook` in `loadExtensions.ts`:

```ts
export async function runExtensionAction(
  ext: RegisteredExtension | undefined,
  actionId: string,
  ctx: ExtensionActionContext,
): Promise<boolean>
```

`CommandPalette.vue` keeps its existing `commandId` if-chain for the core rows (settings, gallery,
onboarding, prefix search) and gains **one** generic branch for actions — no per-extension code.

## 8. Proof extensions (V1)

| Extension | Action | Params | Proves |
|-----------|--------|--------|--------|
| `timer` | `set-timer` | `duration: text, required` | create-then-run, text parsing (`25m`, `1h30`) |
| `pomodoro` | `pomodoro` | `mode: enum [start, stop, restart], required` + `minutes: number, optional` | **multiple params**, enum validation, optional param |
| `todo` | `todo-add` | `item: text, required` | free text with spaces in a chip |

`pomodoro start 45` is the multi-parameter case, and it works entirely on APIs that already exist
(`settings.focusMinutes` + `clampMinutes` + `saveSettings`). The obvious-looking alternative,
`todo add <item> <list>`, was rejected: `todoLogic.ts` has no concept of lists, so it would mean
inventing a todo feature to have something to demo.

## 9. Runtime packages (follow-up, not V1)

Sketch so V1 does not paint it into a corner:

- `ExtToHost` / `HostToExt` gain `kavibay.host.action.invoke` + `kavibay.host.action.result`
  (requestId, timeout, error codes reusing the `HttpErrorCode` style).
- New permission `actions.invoke`, validated by `permissions.ts` / `manifestValidate.ts`.
- Package manifests reuse the **same** `actions` schema, so `manifestValidate.ts` gets one validator
  that core and packages share.
- Open problem: an action on a package whose iframe is not mounted. Resolution order §6 creates the
  instance, so the host must queue the invoke until `kavibay.ext.ready` arrives, with a timeout.

Nothing in V1 blocks this as long as the `actions` schema is validated in one place from the start.

## 10. File map

| File | Change |
|------|--------|
| `sdk/extension/types.ts` | `ActionParam`, `ExtensionAction`, `ExtensionActionContext`; `actions` on manifest / module / registered |
| `core/app/palette/commandArgs.ts` | **New** — pure parse/validate/normalize of chip inputs |
| `core/app/palette/commandArgs.assert.ts` | **New** — required/number/enum/trim/cycle cases |
| `core/app/palette/paletteResults.ts` | `PaletteTypeRow.action`, `paletteRowAction`, `resolveActionTarget` |
| `core/app/palette/paletteResults.assert.ts` | Target-resolution + action-row cases |
| `core/app/palette/commands.ts` | `params` on `Command`; `set-volume`, `toggle-mute` entries |
| `core/app/palette/CommandPalette.vue` | Argument-mode state, chip inputs, Tab/Escape rules, generic action branch |
| `core/app/extensions/loadExtensions.ts` | Normalize `actions`, `runExtensionAction`, dev warnings |
| `extensions/{timer,pomodoro,todo}/manifest.json` + `index.ts` | Declare + implement the proof actions |
| `src-tauri/src/commands.rs` | `execute_action(action_id, args)`; volume / mute / lock |
| `docs/extensions.md` | "Actions" section for extension authors |

## Testing

**Pure asserts (`npx tsx …assert.ts`):**

- `commandArgs`: missing required → invalid + index of offender; number rejects `abc` / accepts `0`
  and `100`; enum matches `Start` → `start`; optional empty param omitted from args; whitespace trimmed
- `resolveActionTarget`: visible wins over hidden; hidden → `reveal`; none → `create`; several
  visible → first
- `buildTypeRows`: the action rides on the extension row; one row per extension; action keywords search it; only the first action is attached
- `paletteRowAction`: type row with/without action, command row with/without params

**Rust (`cargo test --lib`):** `set-volume` rejects out-of-range and non-numeric `level`; unknown
action id errors instead of silently succeeding.

**Manual:**

1. `set timer` → Tab → `25m` → Enter, with **no** timer widget open → widget appears, running
2. Same with a hidden timer → reveals and starts, no second widget
3. Same with a visible timer → uses it
4. `todo add` → Tab → item → Tab → list → Enter
5. `mute` (no params) → Enter runs immediately, no chip appears
6. Tab on a row *without* params still jumps into the widget (no regression)
7. Escape from argument mode returns to search; second Escape closes the palette

## Success criteria

1. Extension actions are declared in `manifest.json` + `index.ts` only — zero per-extension code in
   `core/app/`.
1a. An extension never occupies more than one row in the result list.
2. Multi-parameter actions work end-to-end via Tab chips, including one optional param.
3. An action on a closed or hidden widget creates/reveals the instance and applies the effect in one
   Enter.
4. `manifest.commands` semantics unchanged; every existing manifest and installed runtime package
   still validates.
5. Argument mode never steals Tab from the existing jump-into-widget behavior.
6. `npm run build` clean, `cargo test --lib` green, new asserts pass.

## Open questions

- **Multiple matching instances** (§6.4): first-in-order is a placeholder. Options later: a
  disambiguation sub-list on Enter, or targeting the most recently focused instance. Deferred by
  agreement.
- Should no-param actions appear in `recentPaletteRuns`? Currently out of scope; trivial to add once
  the row kind is stable.
