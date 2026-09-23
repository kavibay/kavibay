/**
 * Viewport layout scaling — keep desks proportional across monitors.
 * Run: npx tsx src/core/host/viewportLayout.assert.ts
 */
import {
  resolveDeskViewport,
  scaleDeskToViewport,
  scalePosition,
  viewportEdgeMargin,
  viewportsEqual,
  type ViewportSize,
} from "./viewportLayout";
import type { Desk } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const uhd: ViewportSize = { width: 3840, height: 2160 };
const fhd: ViewportSize = { width: 1920, height: 1080 };

assert(viewportsEqual(uhd, { width: 3841, height: 2160 }), "eps tolerates 1px");
assert(!viewportsEqual(uhd, fhd), "4k ≠ fhd");

// Edge inset grows with resolution; left/right use the same value.
assert(viewportEdgeMargin(fhd) === 19, "1080p margin ≈ 1.8% of 1080");
assert(viewportEdgeMargin(uhd) === 39, "4k margin ≈ 1.8% of 2160");
assert(viewportEdgeMargin({ width: 800, height: 600 }) === 16, "floor 16");
assert(viewportEdgeMargin({ width: 5120, height: 2880 }) === 52, "near ceiling");
assert(
  viewportEdgeMargin({ width: 8000, height: 4000 }) === 56,
  "ceiling 56",
);

const mid = scalePosition({ x: 1920, y: 1080 }, uhd, fhd);
assert(Math.abs(mid.x - 960) < 0.01 && Math.abs(mid.y - 540) < 0.01, "center scales");

const desk: Desk = {
  id: "1",
  name: "Main",
  palette: { x: 1920, y: 1080 },
  paletteWidth: 400,
  paletteListHeight: 200,
  placements: [
    {
      instanceId: "a",
      offset: { x: 200, y: 100 },
      width: 320,
      height: 240,
      hidden: true,
      hiddenAt: 123,
    },
  ],
  viewport: uhd,
};

const scaled = scaleDeskToViewport(desk, uhd, fhd);
assert(Math.abs(scaled.palette.x - 960) < 0.01, "palette x");
assert(Math.abs(scaled.palette.y - 540) < 0.01, "palette y");
assert(Math.abs((scaled.paletteWidth ?? 0) - 200) < 0.01, "palette width");
assert(Math.abs(scaled.placements[0]!.offset.x - 100) < 0.01, "offset x");
assert(Math.abs((scaled.placements[0]!.width ?? 0) - 160) < 0.01, "widget width");
assert(scaled.placements[0]!.hidden === true && scaled.placements[0]!.hiddenAt === 123, "hide recency survives scale");
assert(scaled.viewport?.width === 1920, "viewport updated");

const same = scaleDeskToViewport(scaled, fhd, fhd);
assert(same.palette.x === scaled.palette.x, "no-op same viewport");

const legacy: Desk = {
  id: "1",
  name: "Main",
  palette: { x: 1920, y: 1080 },
  placements: [],
};
const inferred = resolveDeskViewport(legacy, fhd);
assert(inferred.width >= 3840 && inferred.height >= 2160, "infer 4k from center");

console.log("viewportLayout.assert: ok");
