/**
 * Quick assert for spawn collision placement.
 * Run: npx tsx core/app/host/spawnPlacement.assert.ts
 */
import { GRID_GAP } from "./gridSnap";
import {
  SPAWN_GAP,
  findClearSpawnOffset,
  spawnOffsetBlocked,
  spawnRectsOverlap,
} from "./spawnPlacement";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(SPAWN_GAP === GRID_GAP, "spawn gap matches grid");

assert(
  spawnRectsOverlap(
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 50, y: 0, w: 100, h: 100 },
    0,
  ),
  "overlap without gap",
);
assert(
  !spawnRectsOverlap(
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 200, y: 0, w: 100, h: 100 },
    GRID_GAP,
  ),
  "far apart clear",
);

// Exactly GRID_GAP between edges is allowed (not blocked).
assert(
  !spawnRectsOverlap(
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 100 + GRID_GAP, y: 0, w: 100, h: 100 },
    GRID_GAP,
  ),
  "exact grid gap ok",
);

const palette = { x: 0, y: 0, w: 640, h: 120 };
const clockSize = { w: 200, h: 120 };

assert(
  spawnOffsetBlocked({ x: 240, y: -35 }, clockSize, [palette]),
  "preferred blocked by palette",
);

{
  const pos = findClearSpawnOffset({
    preferred: { x: 240, y: -35 },
    size: clockSize,
    obstacles: [palette],
  });
  assert(
    !spawnOffsetBlocked(pos, clockSize, [palette]),
    `cleared palette at ${pos.x},${pos.y}`,
  );
  // Stay near preferred — spiral pack, not a leap past the wide palette.
  assert(Math.hypot(pos.x - 240, pos.y - -35) < 200, `near preferred (${pos.x},${pos.y})`);
  const edgeGapX = Math.abs(pos.x) - palette.w / 2 - clockSize.w / 2;
  const edgeGapY = Math.abs(pos.y) - palette.h / 2 - clockSize.h / 2;
  // Separation on the clearing axis should be about one grid gap.
  const clearingGap = Math.max(edgeGapX, edgeGapY);
  assert(clearingGap >= GRID_GAP - 1, "at least one grid gap clear");
}

{
  const other = { x: 280, y: -200, w: 200, h: 120 };
  const pos = findClearSpawnOffset({
    preferred: { x: 280, y: -200 },
    size: clockSize,
    obstacles: [palette, other],
  });
  assert(
    !spawnOffsetBlocked(pos, clockSize, [palette, other]),
    `cleared palette+sibling at ${pos.x},${pos.y}`,
  );
}

{
  const open = findClearSpawnOffset({
    preferred: { x: 400, y: 300 },
    size: clockSize,
    obstacles: [palette],
  });
  assert(open.x === 400 && open.y === 300, "keeps clear preferred");
}

{
  const quantize = (c: { x: number; y: number }) => ({
    x: Math.round(c.x / GRID_GAP) * GRID_GAP,
    y: Math.round(c.y / GRID_GAP) * GRID_GAP,
  });
  const pos = findClearSpawnOffset({
    preferred: { x: 241, y: -37 },
    size: clockSize,
    obstacles: [palette],
    quantize: (c) => quantize(c),
  });
  assert(pos.x % GRID_GAP === 0 && pos.y % GRID_GAP === 0, "quantized to grid");
  assert(!spawnOffsetBlocked(pos, clockSize, [palette]), "quantized still clear");
}

console.log("spawnPlacement.assert.ts: ok");
