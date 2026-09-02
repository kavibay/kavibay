/**
 * Quick assert for near-palette spawn scaling.
 * Run: npx tsx core/app/host/layoutLogic.spawn.assert.ts
 */
import { SPAWN_OFFSET_SCALE, spawnOffsetNearPalette } from "./layoutLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(SPAWN_OFFSET_SCALE === 0.5, "scale");

{
  const near = spawnOffsetNearPalette({ x: 480, y: 560 });
  assert(near.x === 240 && near.y === 280, "half notes-like offset");
}

{
  const near = spawnOffsetNearPalette({ x: -480, y: -70 });
  assert(near.x === -240 && near.y === -35, "negative quadrant");
}

{
  const near = spawnOffsetNearPalette({ x: 0, y: 220 });
  assert(near.x === 0 && near.y === 110, "below palette");
}

console.log("layoutLogic.spawn.assert.ts: ok");
