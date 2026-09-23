/**
 * Quick assert for desk/catalog helpers and v3→v4 migration.
 * Run: npx tsx src/core/host/deskLogic.assert.ts
 */
import {
  addCatalogInstance,
  addDesk,
  catalogNotOnDesk,
  deleteDesk,
  desksWithInstance,
  fullyHiddenInstanceIds,
  migrateV3ToV4,
  normalizeLayoutV4,
  placeOnDesk,
  renameDesk,
  purgeRedundantHiddenInstances,
  removeFromDesk,
  removeEverywhere,
  restoreRemovedInstance,
  setActiveDesk,
  instancesForDesk,
  normalizePlacement,
} from "./deskLogic";
import type { SavedLayoutV3, SavedLayoutV4 } from "./types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertThrows(fn: () => void, msg: string) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, msg);
}

// 1. migrate v3 with 2 instances → 1 desk, 2 catalog, 2 placements
{
  const v3: SavedLayoutV3 = {
    palette: { x: 400, y: 300 },
    palettePinned: true,
    instances: [
      { instanceId: "a", typeId: "notes", offset: { x: 10, y: 20 }, width: 200 },
      { instanceId: "b", typeId: "clock", offset: { x: 30, y: 40 }, pinned: true },
    ],
  };
  const v4 = migrateV3ToV4(v3);
  assert(v4.activeDeskId === "1", "migrate active desk");
  assert(v4.desks.length === 1 && v4.desks[0]!.name === "Desk 1", "migrate one desk");
  assert(v4.catalog.length === 2, "migrate catalog size");
  assert(v4.desks[0]!.placements.length === 2, "migrate placements size");
  assert(v4.desks[0]!.palette.x === 400 && v4.desks[0]!.palettePinned === true, "migrate palette");
  assert(v4.desks[0]!.placements[0]!.width === 200, "migrate placement geometry");
  assert(v4.desks[0]!.placements[1]!.pinned === true, "migrate pinned");
}

// 2. addDesk → names "Desk 1" then "Desk 2"; active unchanged until setActiveDesk
{
  let layout: SavedLayoutV4 = migrateV3ToV4({
    palette: { x: 0, y: 0 },
    instances: [{ instanceId: "a", typeId: "notes", offset: { x: 0, y: 0 } }],
  });
  assert(layout.desks[0]!.name === "Desk 1", "initial desk name");
  assert(layout.activeDeskId === "1", "initial active");

  const added = addDesk(layout);
  layout = added.layout;
  assert(layout.desks.length === 2, "two desks after add");
  assert(layout.desks[1]!.name === "Desk 2", "second desk name");
  assert(layout.activeDeskId === "1", "active unchanged after add");

  layout = setActiveDesk(layout, added.deskId);
  assert(layout.activeDeskId === "2", "active after switch");

  layout = renameDesk(layout, "1", "Home");
  assert(layout.desks[0]!.name === "Home", "rename changes the label");
  assert(layout.desks[0]!.id === "1", "rename keeps the id");
  assert(layout.desks[1]!.name === "Desk 2", "rename leaves other desks alone");
}

// 3. placeOnDesk same instance on desk 2 → desksWithInstance length 2
{
  let layout: SavedLayoutV4 = migrateV3ToV4({
    palette: { x: 0, y: 0 },
    instances: [{ instanceId: "shared", typeId: "notes", offset: { x: 5, y: 5 } }],
  });
  const { layout: withDesk2, deskId: desk2Id } = addDesk(layout);
  layout = withDesk2;

  const placed = placeOnDesk(layout, "shared", desk2Id, { x: 100, y: 100 });
  assert(placed !== null, "placeOnDesk succeeds");
  layout = placed!;
  assert(desksWithInstance(layout, "shared").length === 2, "instance on two desks");

  const dup = placeOnDesk(layout, "shared", desk2Id, { x: 200, y: 200 });
  assert(dup === null, "placeOnDesk no-op when already placed");
}

// 4. removeFromDesk one desk → catalog remains; remove last → disposed
{
  let layout: SavedLayoutV4 = migrateV3ToV4({
    palette: { x: 0, y: 0 },
    instances: [{ instanceId: "x", typeId: "notes", offset: { x: 0, y: 0 } }],
  });
  const { layout: withDesk2, deskId: desk2Id } = addDesk(layout);
  layout = withDesk2;
  layout = placeOnDesk(layout, "x", desk2Id, { x: 1, y: 1 })!;

  const partial = removeFromDesk(layout, "x", "1");
  layout = partial.layout;
  assert(!partial.disposed, "partial remove not disposed");
  assert(layout.catalog.some((c) => c.instanceId === "x"), "catalog survives partial remove");

  const final = removeFromDesk(layout, "x", desk2Id);
  layout = final.layout;
  assert(final.disposed, "last placement disposed");
  assert(!layout.catalog.some((c) => c.instanceId === "x"), "catalog entry removed");
}

// 5. deleteDesk with exclusive instance → id in disposedInstanceIds; shared survives
{
  let layout: SavedLayoutV4 = migrateV3ToV4({
    palette: { x: 0, y: 0 },
    instances: [{ instanceId: "shared", typeId: "clock", offset: { x: 0, y: 0 } }],
  });
  const { layout: withDesk2, deskId: desk2Id } = addDesk(layout);
  layout = withDesk2;
  layout = placeOnDesk(layout, "shared", desk2Id, { x: 10, y: 10 })!;
  layout = setActiveDesk(layout, desk2Id);
  layout = addCatalogInstance(
    layout,
    { instanceId: "exclusive", typeId: "notes" },
    { instanceId: "exclusive", offset: { x: 0, y: 0 } },
  );

  const deleted = deleteDesk(layout, desk2Id);
  layout = deleted.layout;
  assert(deleted.disposedInstanceIds.includes("exclusive"), "exclusive disposed");
  assert(!deleted.disposedInstanceIds.includes("shared"), "shared not disposed");
  assert(layout.catalog.some((c) => c.instanceId === "shared"), "shared catalog remains");
  assert(desksWithInstance(layout, "shared").length === 1, "shared still on desk 1");
}

// 6. delete last desk → rejected
{
  const layout: SavedLayoutV4 = migrateV3ToV4({
    palette: { x: 0, y: 0 },
    instances: [],
  });
  assertThrows(() => deleteDesk(layout, "1"), "cannot delete last desk");
}

// 7. normalizeLayoutV4 upgrades legacy bare numeric names; keeps custom labels
{
  const legacy: SavedLayoutV4 = {
    activeDeskId: "1",
    desks: [
      {
        id: "1",
        name: "1",
        palette: { x: 0, y: 0 },
        placements: [],
      },
      {
        id: "2",
        name: "Focus",
        palette: { x: 0, y: 0 },
        placements: [],
      },
    ],
    catalog: [],
  };
  const normalized = normalizeLayoutV4(legacy);
  assert(normalized.desks[0]!.name === "Desk 1", "legacy numeric name upgraded");
  assert(normalized.desks[1]!.name === "Focus", "custom name preserved");
}

// catalogNotOnDesk lists entries missing from the target desk
{
  let layout: SavedLayoutV4 = migrateV3ToV4({
    palette: { x: 0, y: 0 },
    instances: [
      { instanceId: "only-d1", typeId: "notes", offset: { x: 0, y: 0 } },
      { instanceId: "both", typeId: "clock", offset: { x: 0, y: 0 } },
    ],
  });
  const { layout: withDesk2, deskId: desk2Id } = addDesk(layout);
  layout = withDesk2;
  layout = placeOnDesk(layout, "both", desk2Id, { x: 0, y: 0 })!;

  const notOn2 = catalogNotOnDesk(layout, desk2Id);
  assert(notOn2.length === 1 && notOn2[0]!.instanceId === "only-d1", "catalogNotOnDesk");
}

// purgeRedundantHiddenInstances drops soft-hidden orphans when type is visible / forced
{
  let layout: SavedLayoutV4 = migrateV3ToV4({
    palette: { x: 0, y: 0 },
    instances: [
      { instanceId: "vis", typeId: "snake", offset: { x: 0, y: 0 } },
      {
        instanceId: "hid",
        typeId: "snake",
        offset: { x: 10, y: 10 },
        hidden: true,
      },
    ],
  });
  assert(
    fullyHiddenInstanceIds(layout, "snake").includes("hid"),
    "hid is fully hidden",
  );
  const purged = purgeRedundantHiddenInstances(layout);
  layout = purged.layout;
  assert(purged.removedInstanceIds.includes("hid"), "orphan hidden removed");
  assert(!layout.catalog.some((c) => c.instanceId === "hid"), "hid catalog gone");
  assert(layout.catalog.some((c) => c.instanceId === "vis"), "visible kept");

  // After removing the last visible, forceTypeId still clears leftover hidden.
  layout = addCatalogInstance(
    layout,
    { instanceId: "ghost", typeId: "snake" },
    { instanceId: "ghost", offset: { x: 1, y: 1 }, hidden: true },
  );
  layout = removeEverywhere(layout, "vis");
  const forced = purgeRedundantHiddenInstances(layout, "snake");
  assert(forced.removedInstanceIds.includes("ghost"), "forceTypeId clears ghost");
  assert(forced.layout.catalog.length === 0, "no snake leftovers");
}

// restoreRemovedInstance puts catalog + full placement back after removeEverywhere
{
  let layout: SavedLayoutV4 = migrateV3ToV4({
    palette: { x: 0, y: 0 },
    instances: [
      {
        instanceId: "n1",
        typeId: "notes",
        offset: { x: 10, y: 20 },
        width: 320,
        pinned: true,
      },
    ],
  });
  layout = removeEverywhere(layout, "n1");
  assert(layout.catalog.length === 0, "removed catalog");
  layout = restoreRemovedInstance(
    layout,
    { instanceId: "n1", typeId: "notes", title: "Idea" },
    [
      {
        deskId: layout.activeDeskId,
        placement: {
          instanceId: "n1",
          offset: { x: 10, y: 20 },
          width: 320,
          pinned: true,
        },
      },
    ],
  );
  assert(layout.catalog.some((c) => c.instanceId === "n1" && c.title === "Idea"), "catalog back");
  const p = layout.desks[0]?.placements.find((row) => row.instanceId === "n1");
  assert(p?.width === 320 && p.pinned === true, "placement size/pinned restored");
}

{
  const kept = normalizePlacement({
    instanceId: "a",
    offset: { x: 1, y: 2 },
    hidden: true,
    hiddenAt: 42.6,
  });
  assert(kept.hidden === true && kept.hiddenAt === 43, "normalize keeps rounded hiddenAt");

  const visible = normalizePlacement({
    instanceId: "b",
    offset: { x: 0, y: 0 },
    hiddenAt: 9,
  });
  assert(visible.hidden === undefined && visible.hiddenAt === undefined, "visible drops hiddenAt");

  const layout: SavedLayoutV4 = {
    activeDeskId: "1",
    desks: [
      {
        id: "1",
        name: "Desk 1",
        palette: { x: 0, y: 0 },
        placements: [
          { instanceId: "a", offset: { x: 0, y: 0 }, hidden: true, hiddenAt: 100 },
        ],
      },
    ],
    catalog: [{ instanceId: "a", typeId: "notes" }],
  };
  const live = instancesForDesk(normalizeLayoutV4(layout), "1");
  assert(live[0]?.hidden === true && live[0].hiddenAt === 100, "reload keeps hide recency");
}

console.log("deskLogic.assert.ts: ok");
