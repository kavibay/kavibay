import redactedExtension from "../extension";
import manifest from "../manifest.json";
import { redactedWidget } from "./redacted";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(redactedExtension.name === "redacted", "the port keeps the redacted extension id");
assert(redactedWidget.configuration === undefined, "the look lives in the manifest, not in widget settings");

const appearance = manifest.widgets.redacted.ui.appearance;
assert(appearance.background === "#000000", "a new cover is black");
assert(appearance.opacity === 1, "a new cover hides everything behind it");
assert(appearance.blur === 0, "an opaque cover needs no blur");
assert(appearance.radius === 16, "a new cover keeps the 16px corners it always had");
assert(appearance.editable === true, "each cover can change its look in its settings");

console.log("redacted.assert.ts: ok");
