/**
 * The landing page's two Wizard stories share one director.
 * Run: npx tsx core/embed/demo/demoCase.assert.ts
 */
import { demoCase, isDemoCaseId, resetDemoCase, setDemoCase } from "./demoCase";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

resetDemoCase();
assert(demoCase() === "water-tracker", "a page starts on the water tracker");
assert(isDemoCaseId("water-tracker"), "the water tracker is a known case");
assert(isDemoCaseId("linear-github-todos"), "the Linear/GitHub inbox is a known case");
assert(!isDemoCaseId("calendar"), "an unknown name is not a case");
assert(!isDemoCaseId(""), "an empty name is not a case");

setDemoCase("linear-github-todos");
assert(demoCase() === "linear-github-todos", "setDemoCase is what the buttons call");

resetDemoCase();
assert(demoCase() === "water-tracker", "reset returns to the default story");

console.log("core/embed/demo/demoCase.assert.ts: ok");
