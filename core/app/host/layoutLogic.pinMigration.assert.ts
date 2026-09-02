/**
 * Layouts saved before the Sticky→Pin rename: `sticky` / `paletteSticky` load
 * as `pinned` / `palettePinned` and the old keys vanish on the next save.
 * Run: npx tsx core/app/host/layoutLogic.pinMigration.assert.ts
 */
import type { RegisteredExtension } from "@sdk/types";
import { LAYOUT_STORAGE_KEY, LAYOUT_STORAGE_KEY_V4, loadLayout } from "./layoutLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const mem = new Map<string, string>();
const store = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, v);
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
};
(globalThis as { localStorage: typeof store }).localStorage = store;

const registry = [
  { id: "clock", position: { x: 0, y: 0 } },
  { id: "notes", position: { x: 0, y: 0 } },
] as RegisteredExtension[];

// 1. legacy v4 document
{
  mem.clear();
  mem.set(
    LAYOUT_STORAGE_KEY_V4,
    JSON.stringify({
      activeDeskId: "1",
      desks: [
        {
          id: "1",
          name: "Desk 1",
          palette: { x: 400, y: 300 },
          paletteSticky: true,
          placements: [
            { instanceId: "a", offset: { x: 10, y: 20 }, sticky: true },
            { instanceId: "b", offset: { x: 30, y: 40 } },
          ],
        },
      ],
      catalog: [
        { instanceId: "a", typeId: "clock" },
        { instanceId: "b", typeId: "notes" },
      ],
    }),
  );

  const layout = loadLayout(registry);
  const desk = layout.desks[0]!;
  assert(desk.palettePinned === true, "v4 paletteSticky → palettePinned");
  assert(desk.placements[0]!.pinned === true, "v4 sticky → pinned");
  assert(desk.placements[1]!.pinned === undefined, "unpinned placement stays unpinned");
  assert(
    !JSON.stringify(layout).includes("sticky"),
    "loaded layout carries no legacy keys",
  );
}

// 2. legacy v3 document migrated to v4
{
  mem.clear();
  mem.set(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({
      palette: { x: 400, y: 300 },
      paletteSticky: true,
      instances: [
        { instanceId: "a", typeId: "clock", offset: { x: 10, y: 20 }, sticky: true },
      ],
    }),
  );

  const layout = loadLayout(registry);
  const desk = layout.desks[0]!;
  assert(desk.palettePinned === true, "v3 paletteSticky → palettePinned");
  assert(desk.placements[0]!.pinned === true, "v3 sticky → pinned");
  assert(
    !mem.get(LAYOUT_STORAGE_KEY_V4)!.includes("sticky"),
    "saved v4 drops legacy keys",
  );
}

console.log("layoutLogic.pinMigration.assert.ts: ok");
