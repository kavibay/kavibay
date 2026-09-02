/**
 * Recent palette MRU — dedupe, cap, launch-history seed.
 * Run: npx tsx core/app/palette/recentPaletteRuns.assert.ts
 */
import {
  normalizeRecentRuns,
  recentAppsFromLaunchHistory,
  recentRunKey,
  recordRecentPaletteRun,
  RECENT_PALETTE_RUNS_LIMIT,
} from "./recentPaletteRuns";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg);
}

assert(
  recentRunKey({ kind: "command", commandId: "settings", title: "Settings" }) ===
    "command:settings",
  "command key",
);
assert(
  recentRunKey({ kind: "app", path: "C:\\Apps\\Slack.exe", title: "Slack" }) ===
    "app:c:\\apps\\slack.exe",
  "app key lowercases path",
);
assert(
  recentRunKey({ kind: "type", typeId: "notes", title: "Notes" }) === "type:notes",
  "type key",
);

assertEq(normalizeRecentRuns(null), [], "null → []");
assertEq(
  normalizeRecentRuns([{ kind: "command", commandId: "", title: "X" }]),
  [],
  "empty commandId dropped",
);
assertEq(
  normalizeRecentRuns([
    { kind: "command", commandId: "a", title: "A" },
    { kind: "command", commandId: "a", title: "A again" },
    { kind: "app", path: "/x", title: "X" },
  ]),
  [
    { kind: "command", commandId: "a", title: "A" },
    { kind: "app", path: "/x", title: "X" },
  ],
  "dedupe keeps first",
);

const many = Array.from({ length: 20 }, (_, i) => ({
  kind: "command" as const,
  commandId: `c${i}`,
  title: `C${i}`,
}));
assert(normalizeRecentRuns(many).length === RECENT_PALETTE_RUNS_LIMIT, "cap at 12");

let runs = recordRecentPaletteRun([], {
  kind: "command",
  commandId: "open-settings",
  title: "Settings",
});
runs = recordRecentPaletteRun(runs, {
  kind: "app",
  path: "/Slack.app",
  title: "Slack",
});
runs = recordRecentPaletteRun(runs, {
  kind: "command",
  commandId: "open-settings",
  title: "Settings",
});
assertEq(
  runs,
  [
    { kind: "command", commandId: "open-settings", title: "Settings" },
    { kind: "app", path: "/Slack.app", title: "Slack" },
  ],
  "reuse moves to front",
);

assertEq(
  recentAppsFromLaunchHistory(
    {
      "name:slack": { count: 3, lastAt: 200 },
      "name:zoom": { count: 1, lastAt: 300 },
    },
    [
      { name: "Slack", path: "/Apps/Slack.app" },
      { name: "Zoom", path: "/Apps/Zoom.app" },
      { name: "Other", path: "/Apps/Other.app" },
    ],
  ),
  [
    { kind: "app", path: "/Apps/Zoom.app", title: "Zoom" },
    { kind: "app", path: "/Apps/Slack.app", title: "Slack" },
  ],
  "seed by lastAt, skip unused",
);

console.log("recentPaletteRuns.assert.ts: ok");
