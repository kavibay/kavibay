import redactedExtension from "../extension";
import {
  DEFAULT_BORDER_RADIUS,
  MAX_BORDER_RADIUS,
  MIN_BORDER_RADIUS,
  normalizeColor,
  normalizeRedactedConfig,
  redactedWidget,
  type RedactedConfig,
} from "./redacted";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(redactedExtension.name === "redacted", "the port keeps the redacted extension id");
assert(normalizeColor("#abc") === "#aabbcc", "short hex expands");
assert(normalizeColor("#FF00AA") === "#ff00aa", "long hex lowercases");
assert(normalizeColor("nope") === "#000000", "invalid color falls back to black");

const solid = normalizeRedactedConfig({ color: "#fff", borderRadius: 99 });
assert(solid.color === "#ffffff", "the config normalizes color");
assert(solid.borderRadius === MAX_BORDER_RADIUS, "radius clamps to max");
assert(
  normalizeRedactedConfig({ borderRadius: -4 }).borderRadius === MIN_BORDER_RADIUS,
  "radius clamps to min",
);
assert(
  normalizeRedactedConfig({ mode: "blur", blurPx: 99 }).borderRadius === DEFAULT_BORDER_RADIUS,
  "removed legacy blur fields do not change defaults",
);

const fields = redactedWidget.configuration ?? {};
assert(fields.color?.type === "string", "color is a declarative string setting");
assert(fields.borderRadius?.type === "number", "radius is a declarative number setting");
assert((fields.borderRadius?.default as number) === DEFAULT_BORDER_RADIUS, "radius has a default");
const config: RedactedConfig = { color: "#123456", borderRadius: 8 };
assert(normalizeRedactedConfig(config).borderRadius === 8, "valid config passes through");

console.log("redacted.assert.ts: ok");
