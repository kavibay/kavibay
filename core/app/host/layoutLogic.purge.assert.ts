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

console.log("layoutLogic.purge.assert.ts: ok");
