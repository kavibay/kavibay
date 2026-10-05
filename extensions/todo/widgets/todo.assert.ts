import { effectScope } from "vue";
import {
  addRootItem,
  addSiblingAfter,
  normalizeState,
  setItemText,
} from "../todoLogic";
import {
  TODO_STATE_KEY,
  runTodoAddAction,
  todoWidget,
  type TodoModel,
} from "./todo";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const cells = new Map<string, unknown>();
const data = {
  get: async <T>(key: string) => cells.get(key) as T | undefined,
  set: async <T>(key: string, value: T) => { cells.set(key, value); },
  delete: async (key: string) => { cells.delete(key); },
};
const context = { instanceId: "todo-assert", config: {}, data };

await runTodoAddAction({ ctx: context, args: { item: "Buy milk" }, setConfig: () => undefined });
const added = normalizeState(cells.get(TODO_STATE_KEY));
assert(added.items.some((item) => item.text === "Buy milk"), "palette action adds a root todo");

let seeded = normalizeState(undefined);
const child = addSiblingAfter(seeded.items, seeded.items[0]!.id);
seeded = normalizeState({
  ...seeded,
  items: setItemText(child.items, child.newId, "Nested task"),
});
seeded = normalizeState({ ...seeded, items: addRootItem(seeded.items).items });
cells.set(TODO_STATE_KEY, seeded);

const scope = effectScope();
const model = await scope.run(() => todoWidget.component.setup(context)) as TodoModel;
assert(model.instanceId === context.instanceId, "focus is addressed to this model's own instance");
assert(model.rows.value.length === seeded.items.length, "contract setup restores all persisted rows");
const first = model.rows.value[0]!;
model.setDoneToggle(first.id);
await model.flush();
assert(
  normalizeState(cells.get(TODO_STATE_KEY)).items.find((item) => item.id === first.id)?.done === true,
  "tree edits persist through ctx.data",
);

// The palette action can land on a card that is already mounted. That card
// hydrated its list once, so a cell-only write is invisible to it and its next
// save puts the pre-action list back — the task looks like it was never added.
await runTodoAddAction({ ctx: context, args: { item: "dishes" }, setConfig: () => undefined });
const liveTexts = () =>
  model.rows.value.map((row) => model.itemById.value.get(row.id)?.text ?? "");
assert(liveTexts().includes("dishes"), "the action reaches a mounted widget's rows");
await model.flush();
assert(
  normalizeState(cells.get(TODO_STATE_KEY)).items.some((item) => item.text === "dishes"),
  "the mounted widget's own save keeps the added task",
);
scope.stop();

console.log("todo contract assertions passed");
