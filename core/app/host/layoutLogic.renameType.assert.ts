/**
 * A renamed package keeps its cards: the catalog's `typeId` follows the new
 * package id, placements stay keyed by instance.
 * Run: npx tsx core/app/host/layoutLogic.renameType.assert.ts
 */
import type { SavedLayoutV4 } from "./types";
import { renameWidgetType } from "./layoutLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function layout(): SavedLayoutV4 {
  return {
    activeDeskId: "1",
    desks: [
      {
        id: "1",
        name: "Desk 1",
        palette: { x: 0, y: 0 },
        placements: [
          { instanceId: "a", offset: { x: 10, y: 20 } },
          { instanceId: "b", offset: { x: 30, y: 40 } },
        ],
      },
    ],
    catalog: [
      { instanceId: "a", typeId: "dssd", title: "Innen & Außen" },
      { instanceId: "b", typeId: "clock" },
    ],
  };
}

// --- every card of the renamed package follows it ---
{
  const next = renameWidgetType(layout(), "dssd", "tadoweather");
  assert(next.catalog[0]!.typeId === "tadoweather", "the renamed type is rewritten");
  assert(
    next.catalog[0]!.title === "Innen & Außen",
    "and the card keeps the title the person gave it",
  );
  assert(next.catalog[1]!.typeId === "clock", "other types are untouched");
  assert(
    JSON.stringify(next.desks[0]!.placements) === JSON.stringify(layout().desks[0]!.placements),
    "placements reference instances, which a rename does not move",
  );
}

// --- nothing to rename is not a change ---
{
  const before = layout();
  assert(renameWidgetType(before, "absent", "x") === before, "an unknown type returns the same doc");
  assert(renameWidgetType(before, "dssd", "dssd") === before, "and so does renaming to itself");
  assert(renameWidgetType(before, "", "x") === before, "an empty id is never a rename");
}

console.log("layoutLogic.renameType.assert.ts: ok");
