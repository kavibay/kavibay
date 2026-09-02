/**
 * Quick checks for todo tree ops (run: npx tsx src/extensions/todo/todoLogic.assert.ts).
 */
import {
  type TodoItem,
  addSiblingAfter,
  childrenOf,
  clearCompleted,
  createItem,
  depthOf,
  descendantIds,
  hasCompleted,
  indentItem,
  moveAmongSiblings,
  moveItem,
  normalizeState,
  outdentItem,
  placementFromYRatio,
  removeItem,
  todoItemCounts,
  toggleDone,
  visibleRows,
} from "./todoLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function item(partial: Partial<TodoItem> & Pick<TodoItem, "id" | "parentId" | "order">): TodoItem {
  return {
    text: partial.text ?? partial.id,
    done: partial.done ?? false,
    collapsed: partial.collapsed ?? false,
    ...partial,
  };
}

const base: TodoItem[] = [
  item({ id: "a", parentId: null, order: 0 }),
  item({ id: "b", parentId: null, order: 1 }),
  item({ id: "c", parentId: null, order: 2 }),
];

{
  const counts = todoItemCounts([
    item({ id: "open", parentId: null, order: 0 }),
    item({ id: "done", parentId: null, order: 1, done: true }),
    item({ id: "blank", parentId: null, order: 2, text: "  " }),
  ]);
  assert(counts.open === 1 && counts.done === 1, "counts open and completed todos");
}

// Indent b under a
const indented = indentItem(base, "b");
assert(indented.find((i) => i.id === "b")?.parentId === "a", "indent parent");
assert(depthOf(indented, "b") === 1, "indent depth");
assert(
  visibleRows(indented).map((r) => r.id).join(",") === "a,b,c",
  "visible after indent",
);

// Collapse a hides b
const collapsed = indented.map((i) => (i.id === "a" ? { ...i, collapsed: true } : i));
assert(
  visibleRows(collapsed).map((r) => r.id).join(",") === "a,c",
  "collapse hides children",
);

// Outdent b back to root after a
const out = outdentItem(indented, "b");
assert(out.find((i) => i.id === "b")?.parentId === null, "outdent root");
assert(
  childrenOf(out, null).map((i) => i.id).join(",") === "a,b,c",
  "outdent sibling order",
);

// Complete parent cascades
const tree = [
  item({ id: "p", parentId: null, order: 0 }),
  item({ id: "k1", parentId: "p", order: 0 }),
  item({ id: "k2", parentId: "p", order: 1 }),
];
const done = toggleDone(tree, "p");
assert(done.every((i) => i.done), "complete cascades");
const undone = toggleDone(done, "p");
assert(undone.find((i) => i.id === "p")?.done === false, "uncheck parent only");
assert(undone.find((i) => i.id === "k1")?.done === true, "child stays done");

// Move into
const moved = moveItem(base, "c", "a", "into");
assert(moved.find((i) => i.id === "c")?.parentId === "a", "move into parent");
assert(descendantIds(moved, "a").includes("c"), "descendant after into");

// Move before
const before = moveItem(base, "c", "a", "before");
assert(
  childrenOf(before, null).map((i) => i.id).join(",") === "c,a,b",
  "move before",
);

// Remove subtree
const withKids = [
  item({ id: "p", parentId: null, order: 0 }),
  item({ id: "k", parentId: "p", order: 0 }),
  item({ id: "z", parentId: null, order: 1 }),
];
const removed = removeItem(withKids, "p");
assert(removed.map((i) => i.id).join(",") === "z", "remove subtree");

// Add sibling
const added = addSiblingAfter(base, "a");
assert(added.items.length === 4, "add sibling size");
assert(added.items.find((i) => i.id === added.newId)?.parentId === null, "sibling parent");

// Normalize repairs
const normalized = normalizeState({
  width: 9999,
  height: 10,
  items: [{ id: "x", text: "hi", parentId: "missing", order: 0 }],
});
assert(normalized.width <= 480, "clamp width");
assert(normalized.height >= 140, "clamp height");
assert(normalized.items[0]?.parentId === null, "orphan to root");

assert(placementFromYRatio(0.1) === "before", "placement before");
assert(placementFromYRatio(0.5) === "into", "placement into");
assert(placementFromYRatio(0.9) === "after", "placement after");

// createItem shape
const fresh = createItem(null, 0);
assert(fresh.id.length > 0 && fresh.text === "" && !fresh.done, "createItem");

// Sibling reorder
const reordered = moveAmongSiblings(base, "a", 1);
assert(
  childrenOf(reordered, null).map((i) => i.id).join(",") === "b,a,c",
  "move sibling down",
);

// Clear completed (orphans become roots)
const mixed = [
  item({ id: "keep", parentId: null, order: 0, done: false }),
  item({ id: "gone", parentId: null, order: 1, done: true }),
  item({ id: "child", parentId: "gone", order: 0, done: true }),
  item({ id: "alive", parentId: "gone", order: 1, done: false }),
];
assert(hasCompleted(mixed), "has completed");
const cleared = clearCompleted(mixed);
assert(cleared.every((i) => !i.done), "cleared all done");
assert(cleared.find((i) => i.id === "alive")?.parentId === null, "orphan to root");
assert(!cleared.some((i) => i.id === "gone" || i.id === "child"), "done removed");

console.log("ok");
