---
name: kavibay-widget
description: >-
  Build or extend Kavibay first-party widgets as extensions under extensions/.
  Use when adding, creating, scaffolding, or implementing a widget/extension, or when
  the user asks for a new palette widget, widget settings, or extension folder.
---

# Kavibay Widget / Extension

Every widget is a first-party **extension** under `extensions/<id>/`, discovered
automatically (`import.meta.glob`) — never registered in a manual barrel.

Every extension uses the contract format (`"format": "contract"`):
`manifest.json` + `extension.ts` + `view.ts` + `widgets/`. Read
`docs/extension-host.md` before writing one; `AGENTS.md` lists the three
mistakes that are invisible until the browser loads the module. Much of
`reference.md` still describes the retired `index.ts` format — where the two
disagree, `docs/extension-host.md` is right.

Canonical contract: `docs/superpowers/specs/2026-07-18-extension-system-design.md`.  
Patterns and checklists: [reference.md](reference.md).

**Editing `docs/runtime-packages.md` or `docs/DESIGN.md`?** Both are embedded
verbatim as the Widget Wizard's system prompt (`src-tauri/src/wizard/prompt.rs`),
so a change there changes what a model is told about the package format and the
house style. Keep them accurate for both readers; do not add a second copy of
either anywhere.

Styling a widget: [DESIGN.md](../../../docs/DESIGN.md) has the colours, sizes
and spacing the existing widgets use.

## 1. Classify tier (before planning)

| Tier | Criteria | Process |
|------|----------|---------|
| **S** | Client-only, or one keyless API through `capabilities.http`; no new Rust command | Decision list (5–10 bullets) → implement from a reference. **Skip** design doc and long plan |
| **M** | New settings/state/menu or non-trivial UI; a **new credential type** (one registry entry) | Short design (decisions only) → **thin plan** → implement |
| **L** | New Rust module: streaming, pagination or chained calls, shared cache/quota, OS APIs, settings architecture | Full design → **thin plan** → implement |

Default to **S** unless M/L criteria clearly apply. State the tier to the user in one line before coding.

Two needs that look like **L** and are not — check these first:

- **A keyless public API** → list its hosts under `capabilities.http` in the
  widget definition and in `EXTENSION.capabilities` of
  `src-tauri/src/extensions/<id>/mod.rs`, then call `ctx.http`. No command,
  no CSP change. See `stocks`.
- **An API key or OAuth account** → add one entry to
  `src-tauri/src/credentials/registry.rs`. The storage, the settings UI and the
  OAuth flows already exist. Never a per-integration table, command set or panel.

## 2. Thin plan rule (M / L)

Plans must include: goal, constraints, file table, tasks with **interfaces** + verify steps, manual UI checklist.

**Do not** paste full file implementations into the plan. Write code once, in the repo.

## 3. Implement

1. Read [reference.md](reference.md) for file checklist and which reference extension to clone.
2. Create `extensions/<id>/` — folder name **must** match `manifest.id`.
3. Match existing Kavibay UI (dark glass, compact). Do not invent a new purple/glow theme.
   Never a native `<select>` for a dropdown — Windows draws that popup itself, white
   and square-cornered on top of the dark card. Build the menu (trigger + panel of
   rows, check on the selected one); clone
   `extensions/widget-wizard/WizardModelMenu.vue`, markup in [reference.md](reference.md).
4. Prefer pure helpers in `*Logic.ts`; Vue composables for per-instance cache; lifecycle hooks for seed/dispose — never `typeId` switches in the host.
5. Comment new methods/functions with a short purpose note.

## 4. Verify

- Pure helpers: Node assert script (`npx tsx` if needed)
- `npx vue-tsc --noEmit`
- If Rust touched: `npm run verify:rust` (fmt, clippy, `cargo test --lib`); one
  module: `cargo test --manifest-path src-tauri/Cargo.toml --lib <module>`
- If an `api.json` was added or changed: `cargo test --manifest-path src-tauri/Cargo.toml --lib first_party` — a
  malformed declaration would otherwise panic at first use, in front of the user
- Manual: palette add, duplicate/dispose if stateful, settings if present, and
  the widget's own data path once against the real provider

No Vitest unless the user asks to add a runner.

## 5. Anti-patterns

- Mega-plans that re-dump every source file
- Full brainstorm → design → plan for Tier S widgets
- Editing `WidgetHost` / registry for per-widget special cases
- Putting credentials or secrets in frontend storage
- A Rust proxy module for a single API call — declare the endpoint instead
- A per-integration credential table, command set or settings panel — the
  credential layer owns all of that
- Scaffold CLIs or new abstraction layers “for flexibility”
