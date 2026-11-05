/**
 * The stopwatch's own strings, in English — the source catalog.
 *
 * Only text the widget draws itself. Its name and description in the catalog
 * are drawn by the host and stay in `manifest.json`; a translation overlays
 * them with host keys (`widgets.stopwatch.displayName`, …), see
 * `docs/i18n.md`.
 */
export default {
  "status.running": "Running…",
  "status.paused": "Paused",
  "status.ready": "Ready",
  "action.start": "Start",
  "action.pause": "Pause",
  "action.lap": "Lap",
  "action.reset": "Reset",
  "laps.heading": "Laps",
  "laps.empty": "Record a lap while running.",
  "laps.label": "Lap times",
  "laps.entry": "Lap {number}",
} as const;
