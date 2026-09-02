/**
 * Run: npx tsx core/app/onboarding/onboardingArrow.assert.ts
 */
import { arrowPath, bubbleAnchorForTarget } from "./onboardingArrow";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const path = arrowPath({ x: 10, y: 10 }, { x: 200, y: 80 });
assert(path.d.includes("C"), "cubic curve");
assert(path.tip.length > 0, "tip path present");

const target = { left: 400, top: 300, width: 200, height: 40 };
const aboveLeft = bubbleAnchorForTarget(target, "above-left");
assert(aboveLeft.x < target.left + target.width / 2, "bubble left of center");
assert(aboveLeft.y < target.top, "bubble above target");

const belowLeft = bubbleAnchorForTarget(target, "below-left");
assert(belowLeft.y > target.top + target.height, "bubble below target");

console.log("onboardingArrow.assert.ts: ok");
