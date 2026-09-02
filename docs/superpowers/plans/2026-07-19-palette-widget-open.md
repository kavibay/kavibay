# Palette Widget Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search registry widgets in the palette (e.g. `snake`) and open them via smart Enter, with Ctrl+N for always-new and an `N` badge on selected type rows.

**Architecture:** Add `PaletteTypeRow` + `buildTypeRows` in `paletteResults.ts`; wire `CommandPalette.vue` for Enter/Ctrl+N/badge. Reuse host `addWidget` / `focusWidget` / instance toggle rows.

**Tech Stack:** Vue 3 + TypeScript, existing fuzzy matcher, Node assert script (no new deps).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-palette-widget-open-design.md`
- Empty query: commands only
- Type rows: smart Enter; Ctrl/Meta+N always create; `N` badge when selected
- Instance rows: unchanged toggle behavior
- Do not hide Kavibay window on widget open
- Bare `n` must still type into the search field

## File Structure

| File | Responsibility |
|------|----------------|
| `src/palette/paletteResults.ts` | Type rows, smart intent, filter merge |
| `src/palette/paletteResults.assert.ts` | Assert script for smart/filter |
| `src/palette/CommandPalette.vue` | Build rows, Enter/Ctrl+N, `N` badge UI |

---

### Task 1: Type rows + smart open helpers

**Files:**
- Modify: `src/palette/paletteResults.ts`
- Create: `src/palette/paletteResults.assert.ts`

- [x] Add `PaletteTypeRow` and update `PaletteRow` union
- [x] Add `buildTypeRows` + extend `filterPaletteRows` to accept type rows
- [x] Assert script: zero instances + query `snake` ⇒ type row; empty query ⇒ none; smart intents

### Task 2: Wire CommandPalette

**Files:**
- Modify: `src/palette/CommandPalette.vue`

- [x] Build type rows from `listExtensions()` + instances
- [x] Handle `kind: "type"` in `runResultAt` (smart open / create + focus)
- [x] Ctrl/Meta+N → always create + focus when type row selected
- [x] Show `N` badge on selected type row
- [x] Verify with `npx vue-tsc --noEmit`
