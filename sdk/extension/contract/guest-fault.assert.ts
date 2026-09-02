// SPDX-License-Identifier: MIT
/**
 * Checks for the guest's fault reporting.
 * Run: npx tsx sdk/extension/contract/guest-fault.assert.ts
 *
 * This code runs inside a document that is, by construction, the thing being
 * debugged — so its own failure modes matter more than usual. A reporter that
 * throws, recurses, or floods the channel does not merely lose a message; it
 * takes down the one path that was supposed to explain why the widget is
 * blank.
 */
import {
  FAULT_LIMIT,
  faultMessage,
  installFaultReporting,
  readFault,
  type FaultTarget,
  type GuestFault,
} from "./sandbox-guest";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const assertEq = (actual: unknown, expected: unknown, msg: string) =>
  assert(
    Object.is(actual, expected),
    `${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`,
  );

/** A window's worth of `addEventListener`, with a way to fire what was registered. */
function fakeTarget() {
  const listeners: { type: string; capture: boolean; fire: (event: unknown) => void }[] = [];
  const target: FaultTarget = {
    addEventListener(type, listener, capture) {
      listeners.push({ type, capture: capture === true, fire: listener });
    },
  };
  return {
    target,
    /** Bubble-phase listeners only, which is where real throws arrive. */
    emit(type: string, event: unknown) {
      for (const entry of listeners) if (entry.type === type && !entry.capture) entry.fire(event);
    },
    /** Capture-phase only, which is the only place resource errors are heard. */
    emitCapture(type: string, event: unknown) {
      for (const entry of listeners) if (entry.type === type && entry.capture) entry.fire(event);
    },
    types: () => listeners.map((entry) => `${entry.type}${entry.capture ? ":capture" : ""}`),
  };
}

function harness() {
  const faults: GuestFault[] = [];
  const target = fakeTarget();
  const consoleObject = { error: (..._args: unknown[]) => {} };
  installFaultReporting(target.target, consoleObject, (fault) => faults.push(fault));
  return { ...target, consoleObject, faults };
}

// --- what it listens for -----------------------------------------------------
{
  const h = harness();
  const types = h.types();
  assert(types.includes("error"), "uncaught throws");
  assert(types.includes("unhandledrejection"), "promises nobody awaited");
  // Resource errors do not bubble. Without the capture listener a
  // `<script src>` that 404s is completely silent — no throw, no rejection,
  // and a blank widget with an empty panel.
  assert(types.includes("error:capture"), "resources that failed to load");
}

// --- an uncaught throw -------------------------------------------------------
{
  const h = harness();
  const error = new TypeError("rooms.map is not a function");
  h.emit("error", {
    message: "Uncaught TypeError: rooms.map is not a function",
    filename: "http://kavibay-ext.localhost/test123/widget.js",
    lineno: 42,
    colno: 9,
    error,
  });

  assertEq(h.faults.length, 1, "one fault");
  assertEq(h.faults[0]!.source, "error", "reported as a throw");
  assertEq(
    h.faults[0]!.message,
    "Uncaught TypeError: rooms.map is not a function",
    "the browser's own message, verbatim",
  );
  // The basename, not the URL: every file in a package shares one root, so the
  // prefix is identical on every line and only costs width in a narrow panel.
  assertEq(h.faults[0]!.where, "widget.js:42:9", "where, short enough to read");
  assert(h.faults[0]!.stack, "the stack comes along");
}

// A parse error arrives with no `error` object at all — only a message.
{
  const h = harness();
  h.emit("error", { message: "Uncaught SyntaxError: Unexpected token '}'", filename: "widget.js", lineno: 7 });
  assertEq(h.faults[0]!.message, "Uncaught SyntaxError: Unexpected token '}'", "message without an error object");
  assertEq(h.faults[0]!.where, "widget.js:7", "a line with no column still says the line");
  assertEq(h.faults[0]!.stack, undefined, "and no stack is invented");
}

// --- a rejected promise ------------------------------------------------------
{
  const h = harness();
  h.emit("unhandledrejection", { reason: new Error("network_error") });
  assertEq(h.faults[0]!.source, "rejection", "reported as a rejection");
  assertEq(h.faults[0]!.message, "Error: network_error", "named and described");
}
{
  const h = harness();
  h.emit("unhandledrejection", { reason: { code: "permission_denied" } });
  assertEq(h.faults[0]!.message, '{"code":"permission_denied"}', "a plain object is still readable");
}
{
  // A cycle makes JSON.stringify throw. Losing the fault to that would be an
  // especially bad trade: the widget is already broken.
  const h = harness();
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  h.emit("unhandledrejection", { reason: cyclic });
  assertEq(h.faults.length, 1, "a cyclic reason is still reported");
}

// --- console.error -----------------------------------------------------------
{
  const seen: unknown[][] = [];
  const faults: GuestFault[] = [];
  const target = fakeTarget();
  const consoleObject = { error: (...args: unknown[]) => seen.push(args) };
  installFaultReporting(target.target, consoleObject, (fault) => faults.push(fault));

  consoleObject.error("tado call failed", new Error("401"));
  assertEq(faults.length, 1, "the catch block's own message is reported");
  assertEq(faults[0]!.source, "console", "labelled as the widget's own logging");
  assertEq(faults[0]!.message, "tado call failed Error: 401", "arguments joined into one line");
  // Wrapped, not replaced: devtools on the frame must still show it.
  assertEq(seen.length, 1, "the original console.error still runs");
}

// --- a resource that did not load --------------------------------------------
{
  const h = harness();
  h.emitCapture("error", { target: { src: "http://kavibay-ext.localhost/test123/chart.js" } });
  assertEq(h.faults.length, 1, "a script that 404s is reported");
  assert(
    h.faults[0]!.message.includes("failed to load"),
    "and says so in words, since the event carries no message",
  );
}
{
  // A real runtime error reaches the capture listener too, targeted at the
  // window — which has no src or href. Reporting it twice would double every
  // throw in the panel.
  const h = harness();
  h.emitCapture("error", { target: { location: { href: "x" } }, message: "boom" });
  assertEq(h.faults.length, 0, "a window-targeted error is not mistaken for a resource");
}

// --- it cannot take itself down ----------------------------------------------
{
  // The reporter throws, and the guest's own console.error is the wrapped one.
  // Without the reentrancy guard this recurses until the stack gives out.
  const target = fakeTarget();
  const consoleObject = { error: (..._args: unknown[]) => {} };
  let attempts = 0;
  installFaultReporting(target.target, consoleObject, () => {
    attempts += 1;
    consoleObject.error("reporting failed");
    throw new Error("postMessage failed");
  });

  target.emit("error", { message: "the original problem" });
  assertEq(attempts, 1, "a throwing reporter does not become the thing being reported");
}
{
  // A widget with a throwing setInterval produces one of these every frame.
  const h = harness();
  for (let i = 0; i < FAULT_LIMIT + 25; i++) h.emit("error", { message: `boom ${i}` });
  assertEq(h.faults.length, FAULT_LIMIT, "the flood stops at the cap");
  assert(
    h.faults[FAULT_LIMIT - 1]!.message.includes("further faults are not reported"),
    "and the last one says why it went quiet, rather than just stopping",
  );
}
{
  const h = harness();
  h.emit("error", { message: "x".repeat(5000) });
  assert(h.faults[0]!.message.length < 500, "a huge message is clipped before it is posted");
}

// --- the wire ----------------------------------------------------------------
{
  const fault: GuestFault = { source: "rejection", message: "boom", where: "widget.js:1", stack: "at x" };
  const round = readFault(faultMessage(fault));
  assertEq(round?.message, "boom", "survives the wire");
  assertEq(round?.source, "rejection", "with its source");
  assertEq(round?.where, "widget.js:1", "and where it happened");
}
assertEq(readFault({ kind: "kavibay.widget.mounted" }), undefined, "another message is not a fault");
assertEq(readFault({ kind: "kavibay.widget.fault", payload: "{" }), undefined, "malformed JSON is not a fault");
assertEq(
  readFault({ kind: "kavibay.widget.fault", payload: '{"source":"error"}' }),
  undefined,
  "a fault with no message has nothing to show",
);
{
  // Shaped rather than trusted: this reaches a panel that switches on `source`,
  // from a document running unreviewed code.
  const odd = readFault({ kind: "kavibay.widget.fault", payload: '{"source":"nonsense","message":"boom"}' });
  assertEq(odd?.source, "error", "an unknown source is read as a throw, not passed through");
  const wrong = readFault({
    kind: "kavibay.widget.fault",
    payload: '{"source":"error","message":"boom","where":42,"stack":{}}',
  });
  assertEq(wrong?.where, undefined, "a non-string where is dropped");
  assertEq(wrong?.stack, undefined, "a non-string stack is dropped");
}

console.log("guest-fault.assert.ts ok");
