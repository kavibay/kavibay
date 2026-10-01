/**
 * Quick checks for Moodist state helpers
 * (run: npx tsx extensions/moodist/moodistLogic.assert.ts).
 */
import {
  DEFAULT_CATEGORY_ID,
  clearVolumes,
  clampVolume,
  emptyState,
  isActive,
  normalizeState,
  setSoundVolume,
  stateForDuplicate,
  toggleSound,
} from "./moodistLogic";
import extension from "./extension";
import { MOODIST_DATA_KEY, duplicateMoodistData, moodistWidget } from "./widgets/moodist";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(extension.name === "moodist", "contract extension name");
assert(moodistWidget.duplicateData === true, "moodist duplicates data");

const categoryIds = new Set(["nature", "rain", "noise"]);
const soundIds = new Set(["birds", "rain-light", "white-noise", "thunder"]);
const opts = {
  defaultCategoryId: DEFAULT_CATEGORY_ID,
  categoryIds,
  soundIds,
};

// emptyState
const empty = emptyState("nature");
assert(empty.version === 1, "empty version");
assert(empty.activeCategoryId === "nature", "empty category");
assert(Object.keys(empty.volumes).length === 0, "empty volumes");

// clampVolume
assert(clampVolume(0.5) === 0.5, "clamp mid");
assert(clampVolume(-1) === 0, "clamp low");
assert(clampVolume(2) === 1, "clamp high");
assert(clampVolume("0.25") === 0.25, "clamp string");
assert(clampVolume(Number.NaN) === 0, "clamp nan");
assert(clampVolume(null) === 0, "clamp null");

// normalize repairs bad category / out-of-range volumes / unknown keys / strips zeros
const normalized = normalizeState(
  {
    version: 99,
    activeCategoryId: "missing-cat",
    volumes: {
      birds: 1.5,
      "rain-light": -0.2,
      "white-noise": 0,
      unknown: 0.8,
      thunder: "0.3",
    },
  },
  opts,
);
assert(normalized.version === 1, "normalize version");
assert(normalized.activeCategoryId === DEFAULT_CATEGORY_ID, "normalize bad category");
assert(normalized.volumes.birds === 1, "normalize clamp high");
assert(normalized.volumes.thunder === 0.3, "normalize string volume");
assert(!("rain-light" in normalized.volumes), "normalize strip zero after clamp");
assert(!("white-noise" in normalized.volumes), "normalize strip explicit zero");
assert(!("unknown" in normalized.volumes), "normalize drop unknown key");

// null / non-object → empty
const fromNull = normalizeState(null, opts);
assert(fromNull.activeCategoryId === DEFAULT_CATEGORY_ID && Object.keys(fromNull.volumes).length === 0, "null → empty");

// keep valid category
const keepCat = normalizeState({ activeCategoryId: "rain", volumes: {} }, opts);
assert(keepCat.activeCategoryId === "rain", "keep valid category");

// isActive / toggleSound / setSoundVolume / clearVolumes
let volumes: Record<string, number> = {};
assert(!isActive(volumes, "birds"), "inactive by default");
volumes = toggleSound(volumes, "birds");
assert(isActive(volumes, "birds"), "toggle on");
assert(volumes.birds === 0.5, "toggle default volume");
volumes = toggleSound(volumes, "birds");
assert(!isActive(volumes, "birds"), "toggle off");
assert(!("birds" in volumes), "toggle removes key");

volumes = setSoundVolume({}, "thunder", 0.75);
assert(volumes.thunder === 0.75, "set volume");
volumes = setSoundVolume(volumes, "thunder", 0);
assert(!("thunder" in volumes), "set ≤0 removes key");
volumes = setSoundVolume({}, "birds", 2);
assert(volumes.birds === 1, "set clamps high");

assert(Object.keys(clearVolumes()).length === 0, "clearVolumes");

// stateForDuplicate deep-copies volumes
const src = normalizeState(
  { activeCategoryId: "noise", volumes: { birds: 0.4, thunder: 0.6 } },
  opts,
);
const dup = stateForDuplicate(src);
assert(dup.activeCategoryId === "noise", "dup category");
assert(dup.volumes.birds === 0.4 && dup.volumes.thunder === 0.6, "dup volumes");
dup.volumes.birds = 0.9;
assert(src.volumes.birds === 0.4, "dup is a copy");

const duplicated = duplicateMoodistData(MOODIST_DATA_KEY, src) as typeof src;
assert(duplicated.activeCategoryId === "noise", "duplicate category");
assert(duplicated.volumes.birds === 0.4 && duplicated.volumes.thunder === 0.6, "duplicate volumes");
assert(duplicated !== src && duplicated.volumes !== src.volumes, "duplicate is detached");

console.log("moodistLogic.assert.ts: ok");
