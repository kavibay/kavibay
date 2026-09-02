// SPDX-License-Identifier: MIT
/**
 * Quick checks for the widget focus-request matcher.
 * Run: npx tsx sdk/extension/widgetFocusRequest.assert.ts
 */
import {
  WIDGET_FOCUS_EVENT,
  widgetFocusRequestMatches,
  type WidgetFocusRequestDetail,
} from "./widgetFocusRequest";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Stand-in for CustomEvent so this runs under plain node. */
function focusEvent(detail: WidgetFocusRequestDetail | undefined): Event {
  return { type: WIDGET_FOCUS_EVENT, detail } as unknown as Event;
}

// --- instance addressing -----------------------------------------------------
assert(
  widgetFocusRequestMatches(focusEvent({ instanceId: "a", surface: "desk" }), "a"),
  "the addressed instance on the default surface matches",
);
assert(
  !widgetFocusRequestMatches(focusEvent({ instanceId: "b", surface: "desk" }), "a"),
  "another instance does not match",
);
assert(
  !widgetFocusRequestMatches(focusEvent(undefined), "a"),
  "an event without a payload matches nothing",
);
assert(
  !widgetFocusRequestMatches(focusEvent({ surface: "desk" }), "a"),
  "a payload without an instance matches nothing",
);

// --- surface addressing ------------------------------------------------------
// The point of the surface: one instance mounted twice must not fight over the
// caret, so each copy answers only for where it is.
{
  const inline = focusEvent({ instanceId: "a", surface: "inline" });
  assert(widgetFocusRequestMatches(inline, "a", "inline"), "the inline copy takes inline requests");
  assert(
    !widgetFocusRequestMatches(inline, "a", "desk"),
    "the desk card ignores an inline request for the same instance",
  );

  const desk = focusEvent({ instanceId: "a", surface: "desk" });
  assert(widgetFocusRequestMatches(desk, "a", "desk"), "the desk card takes desk requests");
  assert(
    !widgetFocusRequestMatches(desk, "a", "inline"),
    "the inline copy ignores a desk request for the same instance",
  );
}

// An omitted surface means the desk, so hosts and widgets written before inline
// views existed keep their old behaviour.
{
  const legacy = focusEvent({ instanceId: "a" });
  assert(widgetFocusRequestMatches(legacy, "a"), "no surface defaults to desk on both sides");
  assert(widgetFocusRequestMatches(legacy, "a", "desk"), "an explicit desk reader agrees");
  assert(!widgetFocusRequestMatches(legacy, "a", "inline"), "but the inline copy stays out of it");
}

console.log("widgetFocusRequest.assert.ts: ok");
