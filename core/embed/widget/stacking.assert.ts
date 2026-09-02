/**
 * The stacking counter is shared, not per caller.
 * Run: npx tsx core/embed/widget/stacking.assert.ts
 */
import { nextStackOrder, stackOrderTop } from "./stacking";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const a = nextStackOrder();
const b = nextStackOrder();
const c = nextStackOrder();

assert(b > a && c > b, "each call sits above the one before it");
assert(stackOrderTop() === c, "the top is the value handed out last");

/**
 * The regression this file exists for: the counter used to live in
 * `<script setup>`, which runs per component instance, so three cards touched
 * in turn all received the same number and the last one was not on top.
 * Simulated here by two independent callers reading one module.
 */
const cardOne = nextStackOrder();
const cardTwo = nextStackOrder();
assert(cardTwo > cardOne, "a second card raised later must outrank the first");

console.log("core/embed/widget/stacking.assert.ts: ok");
