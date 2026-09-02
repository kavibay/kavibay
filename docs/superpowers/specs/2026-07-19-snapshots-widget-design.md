# Snapshots Widget — Decision List (Tier S)

**Tier:** S — client-only; no new Rust; no Settings nav  
**id / name / category:** `snapshots` / **Snapshots** / `tools`  
**Reference:** `app-launcher` (grid, +, context menu, resize) + `image` (URL validation, click-through)

## Decisions

1. Grid of HTTP(S) image URLs (webcam stills / snapshots); not video streams.
2. Add via “+” popover: URL + optional label.
3. Left-click tile → replace grid with large image + back control.
4. Right-click tile → refresh Off / 5s / 10s / 30s / 1m (default Off) + edit label + remove.
5. Refresh = cache-bust query on `<img>` src; timers pause on dispose/unmount.
6. Persist per instance: `kavibay:snapshots:{instanceId}`; duplicate copies items + size; expanded view not persisted.
7. Resizable content area (image-widget pattern).

## Files

| File | Responsibility |
|------|----------------|
| `src/extensions/snapshots/manifest.json` | Catalog |
| `src/extensions/snapshots/index.ts` | Module + seed/dispose |
| `src/extensions/snapshots/snapshotLogic.ts` | Types, normalize, load/save, helpers |
| `src/extensions/snapshots/snapshotLogic.assert.ts` | Pure helper checks |
| `src/extensions/snapshots/useSnapshotsState.ts` | Per-instance cache |
| `src/extensions/snapshots/SnapshotsWidget.vue` | Grid / expand / menus / timers |

## Out of scope (V1)

Auth/cookies, MJPEG/video, drag-reorder, tile-size picker, settingsComponent, backend proxy.
