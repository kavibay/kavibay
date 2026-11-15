// SPDX-License-Identifier: MIT
import { ref, type Ref } from "vue";
import {
  defineWidget,
  type WidgetActionContext,
  type WidgetContext,
} from "@sdk/contract/sdk";
import {
  createSnippet,
  extractPlaceholders,
  fillSnippetTemplate,
  normalizeSnippets,
  resolveSnippetTemplate,
  snippetActionParams,
  MAX_SNIPPETS,
  type Snippet,
} from "../snippetsLogic";

export const SNIPPETS_DATA_KEY = "snippets";
/** Which cards this widget shows folded: view state, so per instance, not in the shared library. */
const COLLAPSED_DATA_KEY = "collapsed";

/** One shared list for every Snippets widget and the palette action. */
const sharedSnippets: Ref<Snippet[]> = ref([]);
let sharedHydration: Promise<void> | undefined;
let sharedMutationVersion = 0;

function hydrateShared(ctx: WidgetContext): Promise<void> {
  if (!ctx.sharedData) return Promise.resolve();
  if (!sharedHydration) {
    const versionAtStart = sharedMutationVersion;
    sharedHydration = ctx.sharedData
      .get<unknown>(SNIPPETS_DATA_KEY)
      .then((raw) => {
        if (sharedMutationVersion === versionAtStart) {
          sharedSnippets.value = normalizeSnippets(raw);
        }
      })
      .catch(() => {
        if (sharedMutationVersion === versionAtStart) sharedSnippets.value = [];
      });
  }
  return sharedHydration;
}

function persistShared(ctx: WidgetContext, next: Snippet[]): void {
  sharedMutationVersion += 1;
  sharedSnippets.value = next.slice(0, MAX_SNIPPETS);
  const durable = normalizeSnippets({ snippets: sharedSnippets.value });
  void ctx.sharedData?.set(SNIPPETS_DATA_KEY, { snippets: durable });
}

/** Fill a template from the shared library and write the result to the host clipboard. */
export async function runExpandSnippetAction({
  ctx,
  args,
}: WidgetActionContext): Promise<void> {
  await hydrateShared(ctx);
  const body = resolveSnippetTemplate(sharedSnippets.value, args.template ?? "");
  if (!body.trim()) throw new Error("empty template");

  const values: Record<string, string> = {};
  for (const name of extractPlaceholders(body)) {
    if (name !== "template") values[name] = args[name] ?? "";
  }
  const text = fillSnippetTemplate(body, values);
  if (!ctx.clipboard) throw new Error("clipboard is unavailable");
  await ctx.clipboard.writeText(text);
}

export const snippetsWidget = defineWidget({
  name: "snippets",
  displayName: "Snippets",
  description: "Keep reusable text templates and expand them from the palette.",
  defaultSize: { w: 3, h: 3 },
  minSize: { w: 2, h: 2 },
  mode: "both",
  capabilities: { clipboard: true },
  dynamicActionParams: (_actionId, values) => snippetActionParams(sharedSnippets.value, values),
  actions: { expand: runExpandSnippetAction },
  component: {
    setup(ctx: WidgetContext): SnippetsModel {
      void hydrateShared(ctx);

      const collapsed = ref<string[]>([]);
      void ctx.data.get<unknown>(COLLAPSED_DATA_KEY).then((raw) => {
        if (Array.isArray(raw)) collapsed.value = raw.filter((id) => typeof id === "string");
      });

      function toggleCollapsed(id: string): void {
        collapsed.value = collapsed.value.includes(id)
          ? collapsed.value.filter((item) => item !== id)
          : [...collapsed.value, id];
        void ctx.data.set(COLLAPSED_DATA_KEY, collapsed.value);
      }

      function add(): string {
        const row = createSnippet({ name: "Snippet" });
        persistShared(ctx, [...sharedSnippets.value, row]);
        return row.id;
      }

      function update(
        id: string,
        patch: Partial<Pick<Snippet, "name" | "template">>,
      ): void {
        persistShared(
          ctx,
          sharedSnippets.value.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        );
      }

      function remove(id: string): void {
        persistShared(ctx, sharedSnippets.value.filter((item) => item.id !== id));
        if (collapsed.value.includes(id)) toggleCollapsed(id);
      }

      return { snippets: sharedSnippets, collapsed, toggleCollapsed, add, update, remove };
    },
  },
});

export interface SnippetsModel {
  snippets: Ref<Snippet[]>;
  collapsed: Ref<string[]>;
  toggleCollapsed(id: string): void;
  add(): string;
  update(id: string, patch: Partial<Pick<Snippet, "name" | "template">>): void;
  remove(id: string): void;
}
