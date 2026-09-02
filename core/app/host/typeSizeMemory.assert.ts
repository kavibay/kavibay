/**
 * Per-type size memory: normalization and the pure map update.
 * Run: npx tsx core/app/host/typeSizeMemory.assert.ts
 */
import {
  MAX_REMEMBERED_TYPES,
  TYPE_SIZE_STORAGE_KEY,
  type RememberedSize,
  normalizeTypeSizes,
  rememberTypeSize,
  rememberTypeSizeIn,
  rememberedSizeFor,
} from "./typeSizeMemory";
import {
  DEFAULT_WIDGET_MAX_WIDTH,
  DEFAULT_WIDGET_MIN_WIDTH,
} from "./resizeLogic";
import { initialSizeForExtension } from "../extensions/initialSize";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Minimal localStorage so the persisted path can be exercised under tsx. */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

// --- normalize ---
{
  const m = normalizeTypeSizes({ notes: { w: 420, h: 340 } });
  assert(m.notes?.w === 420 && m.notes?.h === 340, "round trip");
}

{
  const m = normalizeTypeSizes({ "launcher-buttons": { w: 500 } });
  assert(m["launcher-buttons"]?.w === 500, "width-only entry kept");
  assert(m["launcher-buttons"]?.h === undefined, "width-only entry stays width-only");
}

{
  // A hand-edited or corrupted entry must not spawn widgets at nonsense sizes.
  const m = normalizeTypeSizes({
    notes: { w: 420, h: 340 },
    broken: { w: "wide" },
    missing: {},
    nulled: null,
    stringy: "240x200",
  });
  assert(Object.keys(m).length === 1 && m.notes !== undefined, "malformed entries dropped");
}

{
  const m = normalizeTypeSizes({ tiny: { w: 1, h: 1 }, huge: { w: 999999, h: 999999 } });
  assert(m.tiny?.w === DEFAULT_WIDGET_MIN_WIDTH, "clamped up to the resize minimum");
  assert(m.huge?.w === DEFAULT_WIDGET_MAX_WIDTH, "clamped down to the resize maximum");
}

assert(Object.keys(normalizeTypeSizes(null)).length === 0, "null → empty");
assert(Object.keys(normalizeTypeSizes([1, 2])).length === 0, "array → empty");
assert(Object.keys(normalizeTypeSizes("nope")).length === 0, "string → empty");

// --- pure update ---
{
  const before: Record<string, RememberedSize> = { clock: { w: 200, h: 200 } };
  const after = rememberTypeSizeIn(before, "notes", { w: 420, h: 340 });
  assert(after.notes?.w === 420, "new type recorded");
  assert(after.clock?.w === 200, "other types untouched");
  assert(before.notes === undefined, "input map not mutated");
}

{
  const after = rememberTypeSizeIn({ notes: { w: 300, h: 300 } }, "notes", {
    w: 420,
    h: 340,
  });
  assert(after.notes?.w === 420 && after.notes?.h === 340, "last resize wins");
}

{
  const after = rememberTypeSizeIn({}, "", { w: 420, h: 340 });
  assert(Object.keys(after).length === 0, "empty typeId ignored");
}

{
  const after = rememberTypeSizeIn({ notes: { w: 300, h: 300 } }, "notes", {
    w: Number.NaN,
  });
  assert(after.notes?.w === 300, "unusable size leaves the map alone");
}

{
  // Oldest entries fall off so a churning package cannot grow storage forever.
  let map: Record<string, RememberedSize> = {};
  for (let i = 0; i < MAX_REMEMBERED_TYPES + 5; i++) {
    map = rememberTypeSizeIn(map, `type-${i}`, { w: 200 + i, h: 200 });
  }
  const keys = Object.keys(map);
  assert(keys.length === MAX_REMEMBERED_TYPES, "map trimmed to the cap");
  assert(map["type-0"] === undefined, "oldest dropped");
  assert(map[`type-${MAX_REMEMBERED_TYPES + 4}`] !== undefined, "newest kept");
}

{
  // Re-recording a type refreshes it, so an actively used type is not the one trimmed.
  let map: Record<string, RememberedSize> = {};
  for (let i = 0; i < MAX_REMEMBERED_TYPES; i++) {
    map = rememberTypeSizeIn(map, `type-${i}`, { w: 200, h: 200 });
  }
  map = rememberTypeSizeIn(map, "type-0", { w: 333, h: 200 });
  map = rememberTypeSizeIn(map, "fresh", { w: 250, h: 200 });
  assert(map["type-0"]?.w === 333, "refreshed type survives the trim");
  assert(map["type-1"] === undefined, "the stalest type is the one dropped");
}

// --- the whole trip: resize a Notes card, add the next one ---
{
  const notes = { defaultSize: { w: 280, h: 200 }, hugHeight: false };

  const first = initialSizeForExtension(notes, rememberedSizeFor("notes"));
  assert(first.width === 280 && first.height === 200, "first add uses the manifest");

  rememberTypeSize("notes", { w: 420, h: 340 });

  const second = initialSizeForExtension(notes, rememberedSizeFor("notes"));
  assert(second.width === 420 && second.height === 340, "next add reuses the resize");

  // Survives a restart: only what reached storage is read back.
  const persisted = normalizeTypeSizes(
    JSON.parse(store.get(TYPE_SIZE_STORAGE_KEY) ?? "{}") as unknown,
  );
  assert(persisted.notes?.w === 420 && persisted.notes?.h === 340, "written to storage");

  // Another type is unaffected — memory is per typeId.
  const clock = { defaultSize: { w: 200, h: 200 }, hugHeight: false };
  const other = initialSizeForExtension(clock, rememberedSizeFor("clock"));
  assert(other.width === 200 && other.height === 200, "other types keep their manifest size");
}

console.log("typeSizeMemory.assert.ts: ok");
