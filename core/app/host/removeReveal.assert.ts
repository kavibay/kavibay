/**
 * Reproduce: reveal hidden → remove everywhere → must not remain under Hidden.
 * Run: npx tsx core/app/host/removeReveal.assert.ts
 */
import { reactive, toRaw } from "vue";
import { instancesForDesk, migrateV3ToV4, removeEverywhere } from "./deskLogic.ts";
import type { DeskPlacement, SavedLayoutV4, WidgetInstance } from "./types.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function instanceToPlacement(instance: WidgetInstance): DeskPlacement {
  return {
    instanceId: instance.instanceId,
    offset: { x: instance.offset.x, y: instance.offset.y },
    ...(instance.hidden === true ? { hidden: true } : {}),
  };
}

/** Mirror WidgetHost flush → removeEverywhere → reload → flush. */
function hostRemoveEverywhere(
  layoutDoc: SavedLayoutV4,
  live: WidgetInstance[],
  instanceId: string,
) {
  const desk = layoutDoc.desks.find((row) => row.id === layoutDoc.activeDeskId);
  if (!desk) throw new Error("active desk missing");
  desk.placements = live.map((instance) => instanceToPlacement(instance));

  const next = removeEverywhere(
    JSON.parse(JSON.stringify(toRaw(layoutDoc))) as SavedLayoutV4,
    instanceId,
  );
  layoutDoc.activeDeskId = next.activeDeskId;
  layoutDoc.desks = next.desks;
  layoutDoc.catalog = next.catalog;

  const reloaded = instancesForDesk(layoutDoc, layoutDoc.activeDeskId);
  live.splice(0, live.length, ...reloaded);

  const desk2 = layoutDoc.desks.find((row) => row.id === layoutDoc.activeDeskId);
  if (!desk2) throw new Error("active desk missing after remove");
  desk2.placements = live.map((instance) => instanceToPlacement(instance));
}

{
  const layoutDoc = reactive(
    migrateV3ToV4({
      palette: { x: 0, y: 0 },
      instances: [
        {
          instanceId: "s1",
          typeId: "snake",
          offset: { x: 1, y: 2 },
          hidden: true,
        },
      ],
    }),
  ) as SavedLayoutV4;
  const live = reactive(
    instancesForDesk(layoutDoc, layoutDoc.activeDeskId),
  ) as WidgetInstance[];

  assert(live.length === 1 && live[0]!.hidden === true, "start hidden");

  delete live[0]!.hidden;
  assert(live[0]!.hidden !== true, "revealed");

  hostRemoveEverywhere(layoutDoc, live, "s1");

  assert(live.length === 0, "no live instances after remove");
  assert(layoutDoc.catalog.length === 0, "catalog empty after remove");
  assert(
    layoutDoc.desks.every((d) => d.placements.length === 0),
    "no placements after remove",
  );
  assert(
    !live.some((i) => i.hidden === true),
    "must not count as Hidden after remove",
  );
}

console.log("removeReveal.assert.ts: ok");
