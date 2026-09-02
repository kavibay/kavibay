/**
 * LRU eviction gates for the palette app-icon cache.
 * Run: npx tsx core/app/palette/iconCacheLru.assert.ts
 */
import { MAX_CACHED_APP_ICONS, iconKeysToEvict } from "./iconCacheLru";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq(actual: string[], expected: string[], msg: string): void {
  assert(
    actual.join("|") === expected.join("|"),
    `${msg} — got [${actual.join(", ")}], want [${expected.join(", ")}]`,
  );
}

// Under and at the cap: nothing is dropped.
eq(iconKeysToEvict(["a", "b"], ["a", "b"], 4), [], "under cap keeps everything");
eq(iconKeysToEvict(["a", "b"], ["a", "b"], 2), [], "exactly at cap keeps everything");

// Over the cap: oldest recency entries go first, and only the overflow.
eq(iconKeysToEvict(["a", "b", "c"], ["a", "b", "c"], 2), ["a"], "evicts oldest");
eq(iconKeysToEvict(["a", "b", "c"], ["a", "b", "c"], 1), ["a", "b"], "evicts two oldest");

// Recency order wins over the order of the cached keys.
eq(iconKeysToEvict(["a", "b", "c"], ["c", "b", "a"], 2), ["c"], "recency beats cache order");

// Keys never requested through the palette are the coldest.
eq(iconKeysToEvict(["orphan", "a", "b"], ["a", "b"], 2), ["orphan"], "untracked is coldest");
eq(
  iconKeysToEvict(["orphan", "a", "b"], ["a", "b"], 1),
  ["orphan", "a"],
  "untracked first, then recency",
);

// Recency entries that are no longer cached must not be reported as evicted.
eq(iconKeysToEvict(["b", "c"], ["a", "b", "c"], 1), ["b"], "ignores stale recency entries");

// Default cap applies when omitted.
const many = Array.from({ length: MAX_CACHED_APP_ICONS + 5 }, (_, i) => `p${i}`);
const dropped = iconKeysToEvict(many, many);
assert(dropped.length === 5, `default cap drops the overflow — got ${dropped.length}`);
eq(dropped.slice(0, 1), ["p0"], "default cap starts at the oldest");

console.log("iconCacheLru.assert: ok");
