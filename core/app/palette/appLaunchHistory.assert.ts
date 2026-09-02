/**
 * App launch history — one-offs stay unboosted; habitual opens rank up.
 * Run: npx tsx core/app/palette/appLaunchHistory.assert.ts
 */
import {
  COUNT_GAP_MS,
  MIN_COUNT_FOR_BOOST,
  appHistoryKey,
  normalizeHistory,
  queryFrecencyBoost,
  recordAppLaunch,
  usageBoostForApp,
  type AppLaunchHistoryState,
} from "./appLaunchHistory";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function loadEmptyState(): AppLaunchHistoryState {
  return { apps: {}, queries: {} };
}

assert(
  appHistoryKey("", "/Applications/App.app").includes("/applications/app.app"),
  "path key keeps posix-style separators",
);

let state = loadEmptyState();
const q = "spot";
const t0 = 1_000_000;
state = recordAppLaunch(state, "Spotify", "/Applications/Spotify.app", q, t0);
state = recordAppLaunch(state, "Spotify", "/Applications/Spotify.app", q, t0 + COUNT_GAP_MS);
assert(
  queryFrecencyBoost(state, "sp", "Spotify", "/Applications/Spotify.app", t0 + COUNT_GAP_MS) > 40,
  "prefix sp gets query boost after 2 launches of spot",
);
assert(
  queryFrecencyBoost(state, "zz", "Spotify", "/Applications/Spotify.app", t0 + COUNT_GAP_MS) === 0,
  "unrelated query → 0",
);

const name = "Spotify";
const path = "C:\\Apps\\Spotify\\Spotify.exe";
const pathAlt = "C:\\Users\\x\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Spotify.lnk";
let history = loadEmptyState();

history = recordAppLaunch(history, name, path, "", t0);
assert(history.apps[appHistoryKey(name, path)]?.count === 1, "first launch counted");
assert(usageBoostForApp(history, name, path, t0) === 0, "single launch → no boost");

history = recordAppLaunch(history, name, path, "", t0 + 10_000);
assert(
  history.apps[appHistoryKey(name, path)]?.count === 1,
  "within gap → no second count",
);

history = recordAppLaunch(history, name, pathAlt, "", t0 + COUNT_GAP_MS);
assert(
  history.apps[appHistoryKey(name, pathAlt)]?.count === MIN_COUNT_FOR_BOOST,
  "after gap via .lnk path → count 2 (same name key)",
);
assert(
  usageBoostForApp(history, name, path, t0 + COUNT_GAP_MS) > 0,
  "two launches → boost on exe path lookup",
);

const settingsBoost = usageBoostForApp(history, "Settings", "shell:AppsFolder\\Windows.Settings");
assert(settingsBoost === 0, "Settings unused → no boost");

const spotify = usageBoostForApp(history, name, path, t0 + COUNT_GAP_MS);
assert(spotify > 30, "habitual boost beats typical single-letter fuzzy + pin");

assert(
  Object.keys(normalizeHistory({ bad: true, "name:x": { count: 2, lastAt: 9 } })).length === 1,
  "normalize keeps valid entries only",
);

console.log("appLaunchHistory.assert: ok");
