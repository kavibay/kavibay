# Widget Close Undo (Ctrl+Z) — Design

**Date:** 2026-07-25  
**Status:** Implemented  
**Approach:** Action stack for Hide/Remove; share Ctrl/Cmd+Z with existing geometry undo via timestamps

## Goal

After Hide (eye) or Remove (×), **Ctrl+Z** / **Cmd+Z** restores the last close when focus is not in a text field.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Actions | Hide **and** Remove (desk / everywhere) |
| Depth | Last **5** close actions (session-only) |
| Shortcut | Ctrl+Z / Cmd+Z (same as geometry undo) |
| Text fields | Do **not** intercept — native undo wins |
| Redo | Out of scope for close undo |
| Geometry coexistence | Chronological: whichever pushed last (close vs move/resize) undoes first |

## Behavior

1. **Hide** → push `{ kind: "hide", instanceId }`. Undo → reveal (existing show path) + focus.
2. **Remove** → push snapshot of catalog entry + removed placement(s) + whether catalog was disposed. Undo → reinsert into layout-v4, `onCreate` if disposed else `onResume` when remounting, focus.
3. Stack capped at 5; oldest dropped. Cleared on process restart (not persisted).
4. Key handler reuses `isEditableKeyTarget` + settings guard from geometry undo.

## Out of scope

- Redo for close
- Undo for rename / sticky / desk delete
- Restoring siblings purged by `disposePurgedHidden` as a side effect of remove
- Persisting the undo stack across restarts

## Files

| File | Role |
|------|------|
| `core/app/host/widgetCloseHistory.ts` | Pure stack + snapshot types |
| `core/app/host/widgetCloseHistory.assert.ts` | Colocated asserts |
| `core/app/host/WidgetHost.vue` | Push on hide/remove; Ctrl+Z prefers newer of close vs geometry |
