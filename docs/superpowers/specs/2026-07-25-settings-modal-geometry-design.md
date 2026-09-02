# Settings Modal Move / Resize — Design

**Date:** 2026-07-25  
**Status:** Implemented  
**Approach:** Reuse widget drag strip + `ResizeEdges`; persist geometry in localStorage

## Decisions

| Topic | Choice |
|-------|--------|
| Move | Top drag strip (palette/widget style) |
| Resize | `ResizeEdges`, all edges except top |
| Persist | localStorage `kavibay:settings-geometry-v1` |
| Default | Current centered `min(720×480)` modal |
| Clamp | Keep fully on-screen when restoring / after resize |

## Out of scope

- Ctrl+resize content zoom, sticky, multi-monitor virtual desktop math beyond viewport clamp
