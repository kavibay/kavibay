// SPDX-License-Identifier: MIT
/**
 * The "New Widget" palette action asks the host for a card and leaves a request
 * for whichever card the host chose.
 *
 * Worth pinning because the failure is silent in both directions. Without the
 * dispatch the action does nothing visible at all — which is exactly what the
 * first version of this did, since a widget action attached to a *type* row is
 * never run by the palette. Without the expiry, a request that never found a
 * card would sit there and turn the next deliberate open into a new project.
 *
 * Run: npx tsx extensions/widget-wizard/newWidgetAction.assert.ts
 */
import { runNewWidgetAction, takeNewProjectRequest } from "./widgets/widgetWizard";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const dispatched: { type: string; detail: unknown }[] = [];
(globalThis as { window?: unknown }).window = {
  dispatchEvent: (event: CustomEvent) => {
    dispatched.push({ type: event.type, detail: event.detail });
    return true;
  },
};

// --- it asks the host to open the Wizard -------------------------------------
{
  await runNewWidgetAction();
  assert(dispatched.length === 1, "the action asks for a card exactly once");
  assert(
    dispatched[0]!.type === "kavibay:run-runtime-widget",
    "through the host's own open-a-widget event, not by reaching into the desk",
  );
  assert(
    (dispatched[0]!.detail as { typeId?: string }).typeId === "widget-wizard",
    "naming the catalog id the manifest's `replaces` gives this widget",
  );
}

// --- the request is redeemed once, by one card -------------------------------
{
  assert(takeNewProjectRequest(), "the card the host focuses finds the request");
  assert(
    !takeNewProjectRequest(),
    "and a second card focused afterwards does not start a project of its own",
  );
}

// --- a request nobody came for expires ---------------------------------------
{
  const at = Date.now();
  await runNewWidgetAction();
  assert(
    !takeNewProjectRequest(at + 60_000),
    "a request no card ever answered does not ambush the next deliberate open",
  );
}

// --- and there is nothing to redeem without one ------------------------------
assert(!takeNewProjectRequest(), "an ordinary focus starts no project");

console.log("newWidgetAction.assert.ts: ok");
