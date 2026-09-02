# Extension-First Widget Architecture

**Date:** 2026-07-18  
**Status:** Approved

## Goal

Every widget is a first-party **extension**: its own folder, its own metadata, registered with the host via discovery — Raycast / n8n paradigm. Hybrid: build-time packages now; contract shaped for runtime plugins later.

## Decisions

| Topic | Choice |
|-------|--------|
| Scope | First-party folders + Vite glob discovery; runtime install later |
| Metadata | `manifest.json` (catalog) + `index.ts` (Vue / lifecycle) |
| Backend | Declare `commands` / `permissions` in manifest; Rust stays shared for now |
| Migration | All existing widgets in one pass |
| Host | Fully generic — no `typeId` switches; lifecycle via extension hooks |
| Discovery | `import.meta.glob` (no codegen, no manual barrel) |

## Layout

```
src/core/extensions/     # types, loadExtensions, registry API
src/core/host/           # WidgetHost, WidgetInstanceView, WidgetCard, useWidgetData, layoutLogic
src/extensions/<id>/     # manifest.json + index.ts + widget files
```

Persisted layout `typeId`s stay stable (no layout-v3 migration).

## Contract

### `manifest.json`

- Required: `id`, `name`, `description`, `version`, `author`, `keywords`, `categories`, `ui`, `commands`, `permissions`
- `ui`: `defaultOffset`, optional `allowDuplicate`, `flush`, `compact`, `defaultHideTitle`
- Canonical id is `manifest.id`; folder name should match (warn on mismatch)

### `index.ts` (default export)

- `component`, optional `settingsComponent` / `menuComponent`
- Optional `backendCommand` / `refreshInterval` (code wiring)
- Lifecycle: `onCreate?`, `onDuplicate?`, `onSuspend?`, `onResume?`, `onDispose?`

### Runtime

Loader pairs manifest + module → `RegisteredExtension`. Host and palette use registry helpers only. Invalid/missing extensions fail at startup. Unknown `typeId` in saved layout → skip + warn.

## Out of scope

- Third-party runtime install
- Per-extension Rust crates / auto invoke registration
- Mass refactor of direct `invoke()` inside widgets
- Extension marketplace UI
