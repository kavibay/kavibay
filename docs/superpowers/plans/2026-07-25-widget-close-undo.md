# Widget Close Undo Implementation Plan

> **For agentic workers:** Execute task-by-task. Spec: `docs/superpowers/specs/2026-07-25-widget-close-undo-design.md`.

**Goal:** Ctrl/Cmd+Z undoes the last Hide or Remove (stack of 5), without stealing text-field undo, coexisting with geometry undo.

**Tech:** Vue host + pure TS stack (`*.assert.ts` via `npx tsx`). No Rust.

## File map

| File | Responsibility |
|------|----------------|
| `widgetCloseHistory.ts` | Stack + snapshot types + push/pop |
| `widgetCloseHistory.assert.ts` | Cap, LIFO, types |
| `deskLogic.ts` | `restoreRemovedInstance` pure helper |
| `deskLogic.assert.ts` | Restore placement/catalog asserts (append) |
| `WidgetHost.vue` | Snapshot on hide/remove; Ctrl+Z timestamp routing |

---

### Task 1: Pure close history + restore helper

- [x] `widgetCloseHistory.ts` + asserts
- [x] `restoreRemovedInstance` in `deskLogic.ts` + asserts
- [x] Verify: `npx tsx` both assert files

### Task 2: Wire WidgetHost

- [x] Push hide/remove snapshots; track `lastCloseUndoAt` / `lastGeometryUndoAt`
- [x] Extend `onLayoutHistoryKeydown` to undo close when newer
- [x] Verify: `npm run build`
