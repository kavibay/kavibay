import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function dispatch(target, type, fields = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
  return event;
}

// Execute the exact classic script injected by Rust, with a real EventTarget.
const guest = new EventTarget();
const sent = [];
runInNewContext(readFileSync(new URL("./frameGestures.js", import.meta.url), "utf8"), {
  window: guest, parent: { postMessage: (data) => sent.push(data) },
});
assert.equal(dispatch(guest, "wheel", { deltaY: 5, deltaMode: 0 }).defaultPrevented, false);
assert.equal(sent.length, 0);
assert.equal(dispatch(guest, "wheel", { ctrlKey: true, deltaY: -100, deltaMode: 0 }).defaultPrevented, true);
assert.equal(JSON.stringify(sent.pop()), JSON.stringify({ type: "kavibay.ext.zoom", kind: "wheel", deltaY: -100, deltaMode: 0 }));
dispatch(guest, "gesturestart");
dispatch(guest, "gesturechange", { scale: 1.5 });
dispatch(guest, "gesturechange", { scale: 2 });
dispatch(guest, "wheel", { ctrlKey: true, deltaY: -100, deltaMode: 0 });
assert.equal(sent.length, 2);
assert.equal(sent[0].factor, 1.5);
assert.equal(sent[1].factor, 2 / 1.5);
dispatch(guest, "gestureend");
dispatch(guest, "wheel", { metaKey: true, deltaY: 10, deltaMode: 1 });
assert.equal(sent.length, 3);
console.log("frameGestures.assert.mjs: ok");
