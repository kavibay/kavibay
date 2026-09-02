import { reactive } from "vue";
import { defineExtension, defineWidget, type WidgetContext } from "@sdk/contract/sdk";

/**
 * FALSIFICATION CASE 1
 * No provider, no capability, no configuration. Needs persisted per-instance
 * data. Two Todo widgets on the canvas must not see each other's items.
 *
 * Ported from docs/extension-sdk-reference/.../todo. `engines.kavibay` moved
 * from "^0.4" to "^0.1": the reference ran against a fictional app version
 * 0.4.2, this app is at 0.1.0, and an extension must declare a range the host
 * it ships in actually satisfies. See registry.ts for the full note.
 */

interface Todo { id: string; text: string; done: boolean }

const todoWidget = defineWidget<Record<string, never>>({
  name: "list",
  displayName: "Todo",
  defaultSize: { w: 3, h: 4 },
  minSize: { w: 2, h: 2 },
  mode: "both",
  // no requires, no permissions, no capabilities, no configuration
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>) {
      // `reactive` rather than `ref` so the view can iterate `model.todos`
      // directly and the headless suite can still read `.length` — a proxied
      // array behaves like an array in both.
      const todos = reactive((await ctx.data.get<Todo[]>("items")) ?? []);

      const persist = (next: Todo[]) => ctx.data.set("items", next);

      return {
        todos,
        async add(text: string) {
          todos.push({ id: crypto.randomUUID(), text, done: false });
          await persist(todos);
          return todos.length;
        },
        async toggle(id: string) {
          const t = todos.find((x) => x.id === id);
          if (t) { t.done = !t.done; await persist(todos); }
        },
        /** Ephemeral UI state stays local; it is neither config nor data. */
        editingId: null as string | null,
      };
    },
  },
});

export const todoExtension = defineExtension({
  name: "todo",
  version: "1.0.0",
  displayName: "Todo",
  engines: { kavibay: "^0.1" },
  contributes: { widgets: [todoWidget] },
});
