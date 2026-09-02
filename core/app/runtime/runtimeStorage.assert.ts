/**
 * Run: npx tsx src/core/runtime/runtimeStorage.assert.ts
 */
import {
  clearAllRuntimeStorageForExt,
  clearRuntimeInstance,
  loadRuntimeInstanceJson,
  renameRuntimeStorageExt,
  runtimeStorageKey,
  saveRuntimeInstanceJson,
} from "./runtimeStorage";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Map-backed mock Storage for asserts (no real localStorage). */
function createMockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

const storage = createMockStorage();

// --- key shape ---
assert(
  runtimeStorageKey("demo", "inst-1") === "kavibay:runtime:demo:inst-1",
  "key shape kavibay:runtime:<extId>:<instanceId>",
);

// --- save/load round-trip ---
{
  const value = { count: 3, label: "hi" };
  saveRuntimeInstanceJson("demo", "inst-1", value, storage);
  const loaded = loadRuntimeInstanceJson("demo", "inst-1", storage);
  assert(
    JSON.stringify(loaded) === JSON.stringify(value),
    "save/load round-trip",
  );
}

// --- clearRuntimeInstance removes one key ---
{
  saveRuntimeInstanceJson("demo", "keep", { a: 1 }, storage);
  saveRuntimeInstanceJson("demo", "drop", { b: 2 }, storage);
  clearRuntimeInstance("demo", "drop", storage);
  assert(
    loadRuntimeInstanceJson("demo", "drop", storage) === null,
    "cleared instance is null",
  );
  assert(
    JSON.stringify(loadRuntimeInstanceJson("demo", "keep", storage)) ===
      JSON.stringify({ a: 1 }),
    "sibling instance intact after clearRuntimeInstance",
  );
}

// --- clearAllRuntimeStorageForExt removes only that ext’s keys ---
{
  const s = createMockStorage();
  saveRuntimeInstanceJson("alpha", "i1", { x: 1 }, s);
  saveRuntimeInstanceJson("alpha", "i2", { x: 2 }, s);
  saveRuntimeInstanceJson("beta", "i1", { y: 9 }, s);
  clearAllRuntimeStorageForExt("alpha", s);
  assert(
    loadRuntimeInstanceJson("alpha", "i1", s) === null,
    "alpha i1 cleared",
  );
  assert(
    loadRuntimeInstanceJson("alpha", "i2", s) === null,
    "alpha i2 cleared",
  );
  assert(
    JSON.stringify(loadRuntimeInstanceJson("beta", "i1", s)) ===
      JSON.stringify({ y: 9 }),
    "other ext key intact",
  );
}

// --- a renamed package keeps its instances' data ---
{
  const s = createMockStorage();
  saveRuntimeInstanceJson("dssd", "i1", { x: 1 }, s);
  saveRuntimeInstanceJson("dssd", "i2", { x: 2 }, s);
  saveRuntimeInstanceJson("other", "i1", { y: 9 }, s);
  // Already occupied under the new name: whatever runs there now owns the cell.
  saveRuntimeInstanceJson("tadoweather", "i2", { kept: true }, s);

  renameRuntimeStorageExt("dssd", "tadoweather", s);

  assert(
    JSON.stringify(loadRuntimeInstanceJson("tadoweather", "i1", s)) ===
      JSON.stringify({ x: 1 }),
    "the data moves with the package, under the same instance id",
  );
  assert(loadRuntimeInstanceJson("dssd", "i1", s) === null, "and does not stay behind");
  assert(
    JSON.stringify(loadRuntimeInstanceJson("tadoweather", "i2", s)) ===
      JSON.stringify({ kept: true }),
    "an occupied cell is not overwritten",
  );
  assert(
    JSON.stringify(loadRuntimeInstanceJson("other", "i1", s)) === JSON.stringify({ y: 9 }),
    "another package's cells are untouched",
  );
}

console.log("runtimeStorage.assert.ts: ok");
