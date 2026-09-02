/**
 * Quick assert for invisible grid snap math.
 * Run: npx tsx core/app/host/gridSnap.assert.ts
 */
import {
  GRID_GAP,
  snapBox,
  snapPosition,
  snapPositionInInset,
  snapResizeGeometry,
  snapValue,
} from "./gridSnap";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(GRID_GAP === 15, "gap is 15");

assert(snapValue(0) === 0, "0 stays 0");
assert(snapValue(15) === 15, "already on grid");
assert(snapValue(7) === 0, "7 → 0");
assert(snapValue(8) === 15, "8 → 15 (midpoint up)");
assert(snapValue(-8) === -15, "negative rounds to nearest");
assert(snapValue(12, 10) === 10, "custom gap");

{
  const b = snapBox({ x: 12, y: 7, width: 203, height: 98 });
  assert(b.x === 15 && b.y === 0, "box origin");
  assert(b.width === 210 && b.height === 105, "box size");
}

{
  // Center (103, 54) + size 200×100 → top-left (3, 4) → snap (0, 0) → center (100, 50)
  const c = snapPosition({ x: 103, y: 54 }, { width: 200, height: 100 });
  assert(c.x === 100 && c.y === 50, "move snaps top-left, keeps size");
}

{
  // Inset snap: extremes flush to the inset box → equal outer margins.
  const inset = { left: 19, top: 19, right: 1901, bottom: 1061 };
  const size = { width: 220, height: 120 };
  const left = snapPositionInInset({ x: 0, y: 540 }, size, inset);
  const right = snapPositionInInset({ x: 9999, y: 540 }, size, inset);
  assert(left.x - size.width / 2 === inset.left, "left extreme → inset");
  assert(right.x + size.width / 2 === inset.right, "right extreme → inset");
}

{
  // East resize: left=120 stays, right 280 → 285, width 165
  const r = snapResizeGeometry(
    "e",
    { x: 200, y: 100 },
    { width: 160, height: 100 },
    { minWidth: 120, minHeight: 80 },
  );
  assert(r.width === 165, "e width snaps via right edge");
  assert(r.center.x === 202.5, "e center shifts with width");
}

{
  // Left on grid at 105: width 120 stays reachable
  const r = snapResizeGeometry(
    "e",
    { x: 165, y: 100 },
    { width: 120, height: 100 },
    { minWidth: 80, minHeight: 80 },
  );
  assert(r.width === 120, "e can keep width 120 when left on grid");
}

{
  // Min floor 80 with left on grid at 0
  const r = snapResizeGeometry(
    "e",
    { x: 40, y: 100 },
    { width: 80, height: 100 },
    { minWidth: 80, minHeight: 80 },
  );
  assert(r.width === 75 || r.width === 80, "e can sit near min 80");
}

console.log("gridSnap.assert.ts: ok");
