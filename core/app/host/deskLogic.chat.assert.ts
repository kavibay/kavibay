/**
 * The chat grant on a card: kept through every layout rebuild and reload,
 * never inherited by a duplicate.
 * Run: npx tsx core/app/host/deskLogic.chat.assert.ts
 */
import { instancesForDesk, normalizeLayoutV4 } from "./deskLogic";
import { duplicateInstance } from "./layoutLogic";
import type { SavedLayoutV4, WidgetCatalogEntry } from "./types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const layout = (chat: unknown): SavedLayoutV4 => ({
  activeDeskId: "1",
  desks: [{ id: "1", name: "Desk 1", palette: { x: 0, y: 0 }, placements: [{ instanceId: "a", offset: { x: 0, y: 0 } }] }],
  catalog: [{ instanceId: "a", typeId: "schritte-heute", chat } as WidgetCatalogEntry],
});

// `reloadInstances` (adding a widget, duplicate, remove, desk switch, restart)
// rebuilds every card from the catalog through exactly this path.
const live = instancesForDesk(normalizeLayoutV4(layout({ model: "claude-sonnet-5-5" })), "1");
assert(live[0]?.chat?.model === "claude-sonnet-5-5", "the grant survives a layout rebuild");
assert(
  instancesForDesk(normalizeLayoutV4(layout({ model: 42 })), "1")[0]?.chat === undefined,
  "a malformed grant is dropped",
);
assert(duplicateInstance(live[0]!).chat === undefined, "a duplicate asks again");
