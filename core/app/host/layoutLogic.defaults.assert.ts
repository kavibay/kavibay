/**
 * Manifest opening defaults (`ui.defaultHideTitle`, `ui.defaultScale`) as they
 * reach a fresh instance.
 * Run: npx tsx core/app/host/layoutLogic.defaults.assert.ts
 */
import { createInstance } from "./layoutLogic";
import { MAX_CONTENT_SCALE, MIN_CONTENT_SCALE } from "./resizeLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const at = { x: 0, y: 0 };

{
  const inst = createInstance("clock", at, { jitter: false });
  assert(inst.contentScale === undefined, "no scale opt → nothing stored");
  assert(inst.hideTitle === undefined, "no hideTitle opt → nothing stored");
}

{
  const inst = createInstance("clock", at, { contentScale: 1, jitter: false });
  // 1 is the host default, so storing it would only add noise to layout JSON.
  assert(inst.contentScale === undefined, "scale 1 stays absent");
}

{
  const inst = createInstance("clock", at, { contentScale: 1.5, jitter: false });
  assert(inst.contentScale === 1.5, "declared scale applied");
}

{
  const inst = createInstance("clock", at, { contentScale: 12, jitter: false });
  assert(inst.contentScale === MAX_CONTENT_SCALE, "over-range scale clamps up");
}

{
  const inst = createInstance("clock", at, { contentScale: 0.01, jitter: false });
  assert(inst.contentScale === MIN_CONTENT_SCALE, "under-range scale clamps down");
}

{
  const inst = createInstance("clock", at, { hideTitle: true, jitter: false });
  assert(inst.hideTitle === true, "declared hideTitle applied");
}

console.log("layoutLogic.defaults.assert.ts: ok");
