/**
 * Widget close undo stack.
 * Run: npx tsx core/app/host/widgetCloseHistory.assert.ts
 */
import {
  WIDGET_CLOSE_UNDO_LIMIT,
  WidgetCloseHistory,
} from "./widgetCloseHistory";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const hist = new WidgetCloseHistory();
assert(!hist.canUndo, "empty");
hist.push({ kind: "hide", instanceId: "a" });
hist.push({
  kind: "remove",
  instanceId: "b",
  mode: "everywhere",
  disposed: true,
  catalog: { instanceId: "b", typeId: "notes" },
  placements: [
    { deskId: "1", placement: { instanceId: "b", offset: { x: 1, y: 2 } } },
  ],
});
assert(hist.peek()?.kind === "remove", "peek newest");
const first = hist.pop();
assert(first?.kind === "remove" && first.instanceId === "b", "LIFO remove");
const second = hist.pop();
assert(second?.kind === "hide" && second.instanceId === "a", "LIFO hide");
assert(!hist.canUndo, "drained");

const capped = new WidgetCloseHistory(WIDGET_CLOSE_UNDO_LIMIT);
for (let i = 0; i < WIDGET_CLOSE_UNDO_LIMIT + 3; i++) {
  capped.push({ kind: "hide", instanceId: `id-${i}` });
}
assert(capped.canUndo, "capped still has entries");
const ids: string[] = [];
while (capped.canUndo) {
  const e = capped.pop();
  if (e?.kind === "hide") ids.push(e.instanceId);
}
assert(ids.length === WIDGET_CLOSE_UNDO_LIMIT, "cap at 5");
assert(ids[ids.length - 1] === "id-3", "oldest of remaining is id-3");
assert(ids[0] === `id-${WIDGET_CLOSE_UNDO_LIMIT + 2}`, "newest popped first");

console.log("widgetCloseHistory.assert.ts: ok");
