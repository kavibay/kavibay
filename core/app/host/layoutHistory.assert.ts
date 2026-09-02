/**
 * Quick checks for layout geometry undo/redo helpers.
 * Run: npx tsx src/core/host/layoutHistory.assert.ts
 * Avoids node:assert so vue-tsc stays clean in the browser tsconfig.
 */
import {
  LayoutGeometryHistory,
  applyLayoutGeometry,
  captureLayoutGeometry,
  layoutGeometryEqual,
  type LayoutGeometrySource,
  type LayoutGeometryTarget,
} from "./layoutHistory";
import type { WidgetInstance } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `expected ${String(expected)}, got ${String(actual)}`);
  }
}

function source(): LayoutGeometrySource {
  return {
    palette: { x: 100, y: 200 },
    paletteWidth: 640,
    paletteListHeight: 360,
    instances: [
      {
        instanceId: "a",
        typeId: "weather",
        offset: { x: 10, y: 20 },
        width: 200,
        height: 120,
      },
      {
        instanceId: "b",
        typeId: "notes",
        offset: { x: -40, y: 50 },
      },
    ],
  };
}

function targetFrom(s: LayoutGeometrySource): LayoutGeometryTarget & {
  paletteWidth?: number;
  paletteListHeight?: number;
} {
  const t = {
    palette: { ...s.palette },
    instances: s.instances.map((i) => ({
      ...i,
      offset: { ...i.offset },
    })) as WidgetInstance[],
    paletteWidth: s.paletteWidth,
    paletteListHeight: s.paletteListHeight,
    setPaletteWidth(width: number | undefined) {
      t.paletteWidth = width;
    },
    setPaletteListHeight(height: number | undefined) {
      t.paletteListHeight = height;
    },
  };
  return t;
}

const s = source();
const snap = captureLayoutGeometry(s);
assertEqual(snap.palette.x, 100);
assertEqual(snap.instances.length, 2);
assertEqual(snap.instances[0]?.width, 200);
assertEqual(snap.instances[1]?.width, undefined);

s.palette.x = 999;
s.instances[0]!.offset.x = 999;
assertEqual(snap.palette.x, 100, "capture clones palette");
assertEqual(snap.instances[0]?.offset.x, 10, "capture clones offsets");

const t = targetFrom(source());
applyLayoutGeometry(t, {
  palette: { x: 1, y: 2 },
  paletteWidth: 400,
  instances: [
    { instanceId: "a", offset: { x: 7, y: 8 }, width: 111 },
    { instanceId: "missing", offset: { x: 0, y: 0 } },
  ],
});
assertEqual(t.palette.x, 1);
assertEqual(t.paletteWidth, 400);
assertEqual(t.paletteListHeight, undefined, "missing list height cleared");
assertEqual(t.instances[0]?.offset.x, 7);
assertEqual(t.instances[0]?.width, 111);
assertEqual(t.instances[0]?.height, undefined, "omitted height cleared");
assertEqual(t.instances[1]?.offset.x, -40, "unmentioned instance untouched");

assertEqual(layoutGeometryEqual(snap, captureLayoutGeometry(source())), true);
assertEqual(
  layoutGeometryEqual(
    snap,
    captureLayoutGeometry({
      palette: t.palette,
      paletteWidth: t.paletteWidth,
      paletteListHeight: t.paletteListHeight,
      instances: t.instances,
    }),
  ),
  false,
);

const hist = new LayoutGeometryHistory(2);
hist.pushBefore(captureLayoutGeometry(source()));
hist.pushBefore(
  captureLayoutGeometry({ ...source(), palette: { x: 2, y: 2 } }),
);
hist.pushBefore(
  captureLayoutGeometry({ ...source(), palette: { x: 3, y: 3 } }),
);
assert(hist.canUndo, "can undo");
const cur = captureLayoutGeometry({ ...source(), palette: { x: 4, y: 4 } });
const undone = hist.undo(cur);
assert(undone, "undo returns snapshot");
assertEqual(undone.palette.x, 3);
assert(hist.canRedo, "can redo");
const redone = hist.redo(undone);
assert(redone, "redo returns snapshot");
assertEqual(redone.palette.x, 4);

console.log("layoutHistory.assert.ts: ok");
