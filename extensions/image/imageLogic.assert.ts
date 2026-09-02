import { normalizeState } from "./imageLogic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(normalizeState(null).variant === "full", "default variant is full-size");
assert(
  normalizeState({ source: "file", path: "C:\\image.png", variant: "framed" }).variant ===
    "framed",
  "framed variant persists",
);
assert(
  normalizeState({ source: "url", url: "https://example.com/image.png", variant: "unknown" })
    .variant === "full",
  "unknown variant falls back to full-size",
);

console.log("imageLogic.assert.ts: ok");
