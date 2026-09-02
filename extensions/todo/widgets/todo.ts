// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import {
  defineWidget,
  type WidgetActionContext,
  type WidgetContext,
} from "@sdk/contract/sdk";
import {
  type DropPlacement,
  type TodoItem,
  type TodoWidgetState,
  addRootItem,
  addSiblingAfter,
  clearCompleted,
  emptyState,
  indentItem,
  itemsToSearchText,
  moveAmongSiblings,
  moveItem,
  normalizeState,
  outdentItem,
  removeItem,
  setItemText,
  toggleCollapsed,
  toggleDone,
  todoItemCounts,
  visibleRows,
} from "../todoLogic";

export const TODO_STATE_KEY = "state";
const DEBOUNCE_MS = 300;

export interface TodoModel {
  state: Ref<TodoWidgetState>;
  rows: ComputedRef<ReturnType<typeof visibleRows>>;
  itemById: ComputedRef<ReadonlyMap<string, TodoItem>>;
  setText(id: string, text: string): void;
  setDoneToggle(id: string): void;
  setCollapsedToggle(id: string): void;
  indent(id: string): void;
  outdent(id: string): void;
  move(dragId: string, targetId: string, placement: DropPlacement): void;
  moveSibling(id: string, direction: -1 | 1): void;
  remove(id: string): void;
  addAfter(id: string): string;
  addRoot(): string;
  clearDone(): void;
  flush(): Promise<void>;
}

const liveStates = new Map<string, Ref<TodoWidgetState>>();
const menuActions = new Map<string, { clearCompleted(): void }>();

/** Read by the host's generic palette adapter; reactive state keeps rows live. */
export function todoInlineView(instanceId: string) {
  const state = liveStates.get(instanceId);
  if (!state) return null;
  const { done, open } = todoItemCounts(state.value.items);
  if (done === 0 && open === 0) return null;
  return { value: `${done} done`, label: `${open} open`, placement: "detail" as const };
}

/** Menu components use the same model action without reaching into the host. */
export function todoMenuAction(instanceId: string) {
  return menuActions.get(instanceId);
}

export function todoStateForInstance(instanceId: string) {
  return liveStates.get(instanceId);
}

export function todoSearchText(instanceId: string): string {
  return itemsToSearchText(liveStates.get(instanceId)?.value.items ?? []);
}

function patchState(
  state: Ref<TodoWidgetState>,
  updater: (items: TodoItem[]) => TodoItem[],
): void {
  state.value = normalizeState({ ...state.value, items: updater(state.value.items) });
}

/**
 * Palette action; works before the widget is mounted, and on a mounted card.
 *
 * A MOUNTED CARD MUST BE WRITTEN THROUGH, not around. It hydrates its list once
 * at setup and holds it in `state` from then on, so a cell-only write is
 * invisible to it — and its own debounced save then puts the pre-action list
 * back over the new task, which is why the task looked like it was never added.
 * The live ref is therefore both the base to append to (the cell lags it by up
 * to the debounce) and the second place the result goes.
 */
export async function runTodoAddAction({ ctx, args }: WidgetActionContext<Record<string, never>>): Promise<void> {
  const text = args.item?.trim();
  if (!text) return;
  const live = liveStates.get(ctx.instanceId);
  const state = normalizeState(
    live ? live.value : await ctx.data.get<TodoWidgetState>(TODO_STATE_KEY),
  );
  const added = addRootItem(state.items);
  const next = normalizeState({ ...state, items: setItemText(added.items, added.newId, text) });
  await ctx.data.set(TODO_STATE_KEY, next);
  if (live) live.value = next;
}

export const todoWidget = defineWidget<Record<string, never>>({
  name: "todo",
  displayName: "Todo",
  description: "Nestable checklist with drag reorder and inline editing.",
  defaultSize: { w: 3, h: 3 },
  minSize: { w: 2, h: 2 },
  mode: "both",
  duplicateData: true,
  palette: { inlineView: todoInlineView },
  actions: { "todo-add": runTodoAddAction },
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>): Promise<TodoModel> {
      const state = ref<TodoWidgetState>(emptyState());
      liveStates.set(ctx.instanceId, state);
      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      let hydrated = false;
      let persistence = Promise.resolve();

      const persistNow = (): Promise<void> => {
        if (!hydrated) return Promise.resolve();
        if (saveTimer !== undefined) {
          clearTimeout(saveTimer);
          saveTimer = undefined;
        }
        persistence = persistence
          .catch(() => undefined)
          .then(() => ctx.data.set(TODO_STATE_KEY, normalizeState(state.value)));
        return persistence;
      };

      const schedulePersist = () => {
        if (!hydrated) return;
        if (saveTimer !== undefined) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = undefined;
          void persistNow();
        }, DEBOUNCE_MS);
      };

      const patchItems = (updater: (items: TodoItem[]) => TodoItem[]) => {
        patchState(state, updater);
        schedulePersist();
      };

      const clearDone = () => patchItems(clearCompleted);
      menuActions.set(ctx.instanceId, { clearCompleted: clearDone });

      onScopeDispose(() => {
        if (saveTimer !== undefined) clearTimeout(saveTimer);
        void persistNow();
        menuActions.delete(ctx.instanceId);
        // Keep the last reactive snapshot available to the palette while a
        // hidden instance is not mounted; disposal evicts canonical data.
      });

      state.value = normalizeState(await ctx.data.get<TodoWidgetState>(TODO_STATE_KEY));
      hydrated = true;

      const setText = (id: string, text: string) => patchItems((items) => setItemText(items, id, text));
      const setDoneToggle = (id: string) => patchItems((items) => toggleDone(items, id));
      const setCollapsedToggle = (id: string) => patchItems((items) => toggleCollapsed(items, id));
      const indent = (id: string) => patchItems((items) => indentItem(items, id));
      const outdent = (id: string) => patchItems((items) => outdentItem(items, id));
      const move = (dragId: string, targetId: string, placement: DropPlacement) =>
        patchItems((items) => moveItem(items, dragId, targetId, placement));
      const moveSibling = (id: string, direction: -1 | 1) =>
        patchItems((items) => moveAmongSiblings(items, id, direction));
      const remove = (id: string) => patchItems((items) => removeItem(items, id));
      const addAfter = (id: string): string => {
        let newId = "";
        patchItems((items) => {
          const result = addSiblingAfter(items, id);
          newId = result.newId;
          return result.items;
        });
        return newId;
      };
      const addRoot = (): string => {
        let newId = "";
        patchItems((items) => {
          const result = addRootItem(items);
          newId = result.newId;
          return result.items;
        });
        return newId;
      };

      return {
        state,
        rows: computed(() => visibleRows(state.value.items)),
        itemById: computed(() => new Map(state.value.items.map((item) => [item.id, item]))),
        setText,
        setDoneToggle,
        setCollapsedToggle,
        indent,
        outdent,
        move,
        moveSibling,
        remove,
        addAfter,
        addRoot,
        clearDone,
        flush: persistNow,
      };
    },
  },
});
