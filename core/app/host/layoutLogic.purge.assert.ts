/**
 * Hidden copies of a widget that is on the desk are cleaned up at start, but
 * only the empty ones. A copy somebody filled and closed keeps its values.
 * Run: npx tsx core/app/host/layoutLogic.purge.assert.ts
 */
import type { RegisteredExtension } from "@sdk/types";
import { LAYOUT_STORAGE_KEY_V4, loadLayout } from "./layoutLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const mem = new Map<string, string>();
const store = {
  get length() {
    return mem.size;
  },
  key: (i: number) => [...mem.keys()][i] ?? null,
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, v);
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
};
(globalThis as { localStorage: typeof store }).localStorage = store;

const registry = [{ id: "water-tracker", position: { x: 0, y: 0 } }] as RegisteredExtension[];
const ids = ["open", "stored", "noted", "configured", "empty", "a"];

mem.set(
  LAYOUT_STORAGE_KEY_V4,
  JSON.stringify({
    activeDeskId: "1",
    desks: [
      {
        id: "1",
        name: "Desk 1",
        palette: { x: 0, y: 0 },
        placements: ids.map((instanceId) => ({
          instanceId,
          offset: { x: 0, y: 0 },
          ...(instanceId === "open" ? {} : { hidden: true }),
        })),
      },
    ],
    catalog: ids.map((instanceId) => ({ instanceId, typeId: "water-tracker" })),
  }),
);
mem.set("kavibay:runtime:water-tracker:stored", '{"entries":[250,250]}');
mem.set("kavibay:widget-data:noted\0body", '"buy milk"');
mem.set("kavibay:widget-config:configured", '{"goalMl":3000}');
mem.set("kavibay:widget-data:ab\0body", '"not a"');

const kept = loadLayout(registry).catalog.map((entry) => entry.instanceId);

assert(
  JSON.stringify(kept) === JSON.stringify(["open", "stored", "noted", "configured"]),
  `the empty hidden copies go, the rest stay: ${JSON.stringify(kept)}`,
);
assert(
  JSON.parse(mem.get(LAYOUT_STORAGE_KEY_V4)!).catalog.length === 4,
  "the cleaned layout is saved",
);

// A runtime package is registered only after the async scan. Its cards must
// survive the start, and the values of cards that are gone must not.
{
  const live = "11111111-2222-4333-8444-555555555555";
  const gone = "66666666-7777-4888-9999-aaaaaaaaaaaa";
  mem.clear();
  mem.set(
    LAYOUT_STORAGE_KEY_V4,
    JSON.stringify({
      activeDeskId: "1",
      desks: [{ id: "1", name: "Desk 1", palette: { x: 0, y: 0 }, placements: [{ instanceId: live, offset: { x: 0, y: 0 } }] }],
      catalog: [{ instanceId: live, typeId: "nyc-countdown" }],
    }),
  );
  mem.set(`kavibay:runtime:nyc-countdown:${live}`, "{}");
  mem.set(`kavibay:runtime:water-tracker:${gone}`, '{"entries":[750]}');
  mem.set("kavibay:runtime:water-tracker:wizard-preview-water-tracker", "{}");
  mem.set("kavibay:runtime:water-tracker:palette-inline:water-tracker", "{}");
  mem.set(`kavibay:widget-data:${gone}\0body`, '"not runtime"');

  const layout = loadLayout([]);
  assert(layout.catalog.some((entry) => entry.instanceId === live), "a card of a package not yet scanned stays");
  assert(layout.desks[0]!.placements.length === 1, "and keeps its place on the desk");
  assert(mem.has(`kavibay:runtime:nyc-countdown:${live}`), "its values stay");
  assert(!mem.has(`kavibay:runtime:water-tracker:${gone}`), "values of a card that is gone are deleted");
  assert(mem.has("kavibay:runtime:water-tracker:wizard-preview-water-tracker"), "the Wizard preview's values stay");
  assert(mem.has("kavibay:runtime:water-tracker:palette-inline:water-tracker"), "the palette's scratch copy stays");
  assert(mem.has(`kavibay:widget-data:${gone}\0body`), "only runtime storage is swept");
}

console.log("layoutLogic.purge.assert.ts: ok");
