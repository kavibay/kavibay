/**
 * Quick assert for center-anchored resize math.
 * Run: npx tsx core/app/host/resizeLogic.assert.ts
 */
import {
  applyResizeDelta,
  clampContentScale,
  clampSize,
  CONTENT_SCALE_WHEEL_FACTOR,
  contentScaleForResize,
  contentScaleFromWheel,
  fitToContent,
  PREVIEW_FIT_MAX_HEIGHT,
  MAX_CONTENT_SCALE,
  MIN_CONTENT_SCALE,
  PINCH_DELTA_GAIN,
  PINCH_DELTA_THRESHOLD,
  RESIZE_EDGES_NO_TOP,
  WHEEL_NOTCH_DELTA,
} from "./resizeLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(RESIZE_EDGES_NO_TOP.includes("nw"), "top-left corner remains resizable");
assert(RESIZE_EDGES_NO_TOP.includes("ne"), "top-right corner remains resizable");
assert(!RESIZE_EDGES_NO_TOP.includes("n"), "top edge remains the move grip");

const start = { width: 200, height: 100 };

// East grow keeps left fixed → center moves +half
{
  const r = applyResizeDelta("e", start, 40, 0);
  assert(r.width === 240 && r.height === 100, "e size");
  assert(r.deltaOffset.x === 20 && r.deltaOffset.y === 0, "e offset");
}

// West grow (pointer left) keeps right fixed → center moves -half
{
  const r = applyResizeDelta("w", start, -40, 0);
  assert(r.width === 240 && r.height === 100, "w size");
  assert(r.deltaOffset.x === -20 && r.deltaOffset.y === 0, "w offset");
}

// South-east corner
{
  const r = applyResizeDelta("se", start, 20, 30);
  assert(r.width === 220 && r.height === 130, "se size");
  assert(r.deltaOffset.x === 10 && r.deltaOffset.y === 15, "se offset");
}

assert(clampSize(50, 9000).width >= 80, "min width");
assert(clampSize(50, 9000).height === 9000, "large height allowed");
assert(clampSize(20000, 20000).width === 16384, "max width ceiling");

assert(clampContentScale(1) === 1, "scale default");
assert(clampContentScale(0.1) === MIN_CONTENT_SCALE, "scale min");
assert(clampContentScale(99) === MAX_CONTENT_SCALE, "scale max");

{
  const next = contentScaleForResize(1, { width: 200, height: 200 }, {
    width: 300,
    height: 300,
  });
  assert(Math.abs(next - 1.5) < 1e-9, "scale tracks min side");
}

{
  const next = contentScaleForResize(2, { width: 200, height: 100 }, {
    width: 200,
    height: 200,
  });
  // min side 100 → 200 = ×2, start 2 → 4 clamped to max
  assert(next === MAX_CONTENT_SCALE, "scale clamps after grow");
}

assert(
  Math.abs(contentScaleFromWheel(1, -100) - CONTENT_SCALE_WHEEL_FACTOR) < 1e-9,
  "wheel up zooms in",
);
assert(
  Math.abs(contentScaleFromWheel(1, 100) - 1 / CONTENT_SCALE_WHEEL_FACTOR) < 1e-9,
  "wheel down zooms out",
);
assert(contentScaleFromWheel(MIN_CONTENT_SCALE, 100) === MIN_CONTENT_SCALE, "wheel clamps min");
assert(contentScaleFromWheel(MAX_CONTENT_SCALE, -100) === MAX_CONTENT_SCALE, "wheel clamps max");
assert(contentScaleFromWheel(1, 0) === 1, "zero delta keeps the scale");

// Line/page deltaModes land on the same curve as pixels.
assert(
  Math.abs(contentScaleFromWheel(1, -2.5, 1) - contentScaleFromWheel(1, -100)) < 1e-9,
  "line mode matches one notch",
);
assert(
  Math.abs(contentScaleFromWheel(1, -0.25, 2) - contentScaleFromWheel(1, -100)) < 1e-9,
  "page mode matches one notch",
);

// Trackpad pinch: many small deltas, proportional — not one full step each.
{
  const step = contentScaleFromWheel(1, -5);
  assert(step > 1 && step < 1.05, "one pinch event is still a small step");
  let scale = 1;
  for (let i = 0; i < 20; i += 1) scale = contentScaleFromWheel(scale, -5);
  // 20 × 5px, amplified ×4 = 400px = four notches — not 1.1^20.
  assert(
    Math.abs(scale - CONTENT_SCALE_WHEEL_FACTOR ** 4) < 1e-9,
    "pinch deltas accumulate to their amplified total",
  );
}

// The gain is what makes a pinch usable — and it must not reach the mouse.
assert(
  Math.abs(
    contentScaleFromWheel(1, -10) -
      CONTENT_SCALE_WHEEL_FACTOR ** ((10 * PINCH_DELTA_GAIN) / WHEEL_NOTCH_DELTA),
  ) < 1e-9,
  "a trackpad delta is amplified",
);
assert(
  Math.abs(
    contentScaleFromWheel(1, -PINCH_DELTA_THRESHOLD) -
      CONTENT_SCALE_WHEEL_FACTOR ** (PINCH_DELTA_THRESHOLD / WHEEL_NOTCH_DELTA),
  ) < 1e-9,
  "at the threshold the delta is left alone",
);
assert(
  Math.abs(contentScaleFromWheel(1, -100) - CONTENT_SCALE_WHEEL_FACTOR) < 1e-9,
  "a mouse notch keeps its 10% despite the gain",
);

// A single oversized delta is capped instead of jumping to a clamp.
assert(contentScaleFromWheel(1, -100000) < MAX_CONTENT_SCALE, "huge delta stays gradual");


// --- growing a card to fit what is in it -------------------------------------
{
  // The card grows by exactly what does not fit, so one round settles it.
  assert(fitToContent(200, 80) === 280, "the overflow is the growth");
  assert(fitToContent(280, 0) === null, "and once it fits, nothing moves");

  // A ceiling, because some content has no natural end. Past it the widget
  // keeps its scrollbar, which was the other half of the request.
  assert(fitToContent(500, 400) === PREVIEW_FIT_MAX_HEIGHT, "growth stops at the ceiling");
  assert(fitToContent(PREVIEW_FIT_MAX_HEIGHT, 200) === null, "and does not push past it");

  // A widget that animates reports a size every frame; following each by a
  // pixel would mean a card that never sits still.
  assert(fitToContent(200, 3) === null, "a change too small to see is not a resize");

  assert(fitToContent(Number.NaN, 50) === null, "a measurement that is not a number does nothing");
  assert(
    fitToContent(200, Number.POSITIVE_INFINITY) === null,
    "and neither does an absurd one",
  );
}

console.log("resizeLogic.assert.ts: ok");
