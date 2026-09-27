import { forwardFrameZoom, installContentZoom } from "./contentZoom";

function assertEqual(actual: unknown, expected: unknown, message = "Unexpected result") {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

// A DOM boundary double; the production listeners, validation and scale curve run unchanged.
class Surface extends EventTarget {
  parent: Surface | null = null;
  marked = false;
  contentWindow = {};
  setAttribute() { this.marked = true; }
  removeAttribute() { this.marked = false; }
  closest(): Surface | null { return this.marked ? this : this.parent?.closest() ?? null; }
}
const previousElement = globalThis.Element;
Object.assign(globalThis, { Element: Surface });
const surface = new Surface();
const frame = new Surface();
frame.parent = surface;
const iframe = frame as unknown as HTMLIFrameElement;
let scale = 1;
const dispose = installContentZoom(surface as unknown as HTMLElement, () => scale, (next) => { scale = next; });
// Node's EventTarget has no DOM bubbling; relay the real frame event to its surface.
frame.addEventListener("kavibay:content-zoom", (event) => {
  const copy = new CustomEvent(event.type, { detail: (event as CustomEvent).detail });
  surface.dispatchEvent(copy);
});
const message = (data: unknown, source = frame.contentWindow) => ({ data, source }) as MessageEvent;
const zoom = (change: object) => message({ type: "kavibay.ext.zoom", ...change });

assertEqual(forwardFrameZoom(iframe, message({ type: "kavibay.ext.zoom", kind: "pinch", factor: 2 }, {})), false);
assertEqual(scale, 1, "another frame cannot zoom this widget");
forwardFrameZoom(iframe, zoom({ kind: "wheel", deltaY: -100, deltaMode: 0 }));
assertEqual(scale, 1.1, "iframe wheel uses the same curve as a builtin widget");
forwardFrameZoom(iframe, zoom({ kind: "pinch", factor: 2 }));
assertEqual(scale, 2.2);
forwardFrameZoom(iframe, zoom({ kind: "pinch", factor: 10 }));
assertEqual(scale, 3, "pinch shares the host zoom ceiling");
for (const change of [
  { kind: "pinch", factor: NaN }, { kind: "pinch", factor: -1 },
  { kind: "wheel", deltaY: Infinity, deltaMode: 0 }, { kind: "wheel", deltaY: 1, deltaMode: 9 },
]) forwardFrameZoom(iframe, zoom(change));
assertEqual(scale, 3, "invalid frame data never reaches layout state");

function dispatch(target: Surface | EventTarget, type: string, fields: object = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
  return event;
}
scale = 1;
assertEqual(dispatch(surface, "wheel", { deltaY: -100, deltaMode: 0 }).defaultPrevented, false);
assertEqual(scale, 1, "ordinary scrolling is left to the widget");
dispatch(surface, "gesturestart");
dispatch(surface, "gesturechange", { scale: 1.5 });
dispatch(surface, "wheel", { ctrlKey: true, deltaY: -100, deltaMode: 0 });
assertEqual(scale, 1.5, "WebKit's simultaneous wheel stream does not double-zoom");
dispatch(surface, "gesturechange", { scale: 2 });
assertEqual(scale, 2, "gesture scale is cumulative from gesture start, not from each event");
dispatch(surface, "gestureend");
dispatch(surface, "wheel", { metaKey: true, deltaY: 100, deltaMode: 0 });
assertEqual(scale, 2 / 1.1);

const inner = new Surface();
const stopInner = installContentZoom(inner as unknown as HTMLElement, () => 1, () => {});
const nested = new Event("wheel", { cancelable: true });
Object.assign(nested, { ctrlKey: true, deltaY: -100, deltaMode: 0 });
Object.defineProperty(nested, "target", { value: inner });
surface.dispatchEvent(nested);
assertEqual(nested.defaultPrevented, false, "outer Wizard leaves its preview's gesture alone");
stopInner();
dispose();
const before = scale;
dispatch(surface, "wheel", { ctrlKey: true, deltaY: -100, deltaMode: 0 });
assertEqual(scale, before, "unmounted surfaces release their listeners");
Object.assign(globalThis, { Element: previousElement });

console.log("contentZoom.assert.ts: ok");
