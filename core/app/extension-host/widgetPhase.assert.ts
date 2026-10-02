/**
 * When a widget body shows a skeleton.
 * Run: npx tsx core/app/extension-host/widgetPhase.assert.ts
 */
import { resolveBodyPhase } from "./widgetPhase";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const loading = { status: "loading" } as const;
const ok = { status: "success", data: 1, isStale: false, updatedAt: 0 } as const;
const failed = { status: "error", error: { kind: "offline", message: "x" } } as const;

assert(
  resolveBodyPhase({ mounting: false, queryStates: [ok, loading] }) === "loading",
  "a query still loading before the body was shown holds the skeleton",
);
assert(
  resolveBodyPhase({ mounting: false, queryStates: [ok, loading], shown: true }) === "ready",
  "a refresh after the body was shown keeps it on screen",
);
assert(
  resolveBodyPhase({ mounting: false, queryStates: [failed], shown: true }) === "error",
  "a failure still shows, shown or not",
);
assert(
  resolveBodyPhase({ mounting: true, queryStates: [], shown: true }) === "loading",
  "a remount starts over",
);

console.log("widgetPhase.assert: ok");
