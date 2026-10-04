// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, shallowReactive, type Ref } from "vue";
import {
  defineWidget,
  type WidgetActionContext,
  type WidgetContext,
} from "@sdk/contract/sdk";
import {
  type NotesWidgetState,
  markdownToSearchText,
  normalizeState,
} from "../notesLogic";

export const NOTES_STATE_KEY = "state";
const DEBOUNCE_MS = 300;

export interface NotesModel {
  state: Ref<NotesWidgetState>;
  setMarkdown(markdown: string): void;
  setToolbarVisible(visible: boolean): void;
  openUrl(url: string): Promise<void>;
  flush(): Promise<void>;
}

// Palette computations must also notice the first mount and replacement on remount.
const liveStates = shallowReactive(new Map<string, Ref<NotesWidgetState>>());
const menuActions = new Map<string, { toggleToolbar(): void; copyMarkdown(): Promise<void> }>();

/** Search text is supplied by the extension, so the host stays type-agnostic. */
export function notesSearchText(instanceId: string): string {
  return markdownToSearchText(liveStates.get(instanceId)?.value.markdown ?? "");
}

export function notesStateForInstance(instanceId: string) {
  return liveStates.get(instanceId);
}

export function notesMenuAction(instanceId: string) {
  return menuActions.get(instanceId);
}

/** Palette action; it also updates a mounted editor immediately when present. */
export async function runNewNoteAction({
  ctx,
  args,
}: WidgetActionContext<Record<string, never>>): Promise<void> {
  const next = normalizeState({
    ...(await ctx.data.get<NotesWidgetState>(NOTES_STATE_KEY)),
    markdown: args.text ?? "",
  });
  await ctx.data.set(NOTES_STATE_KEY, next);
  const live = liveStates.get(ctx.instanceId);
  if (live) live.value = next;
}

export const notesWidget = defineWidget<Record<string, never>>({
  name: "notes",
  displayName: "Notes",
  description: "Sticky notes with rich text.",
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 2, h: 2 },
  mode: "both",
  capabilities: { clipboard: true, openExternal: true },
  duplicateData: true,
  palette: { searchText: notesSearchText },
  actions: { "new-note": runNewNoteAction },
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>): Promise<NotesModel> {
      const state = ref<NotesWidgetState>(normalizeState(undefined));
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
        const snapshot = normalizeState(state.value);
        persistence = persistence
          .catch(() => undefined)
          .then(() => ctx.data.set(NOTES_STATE_KEY, snapshot));
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

      const setMarkdown = (markdown: string) => {
        state.value = normalizeState({ ...state.value, markdown });
        schedulePersist();
      };

      const setToolbarVisible = (visible: boolean) => {
        state.value = normalizeState({ ...state.value, toolbarVisible: visible });
        void persistNow();
      };

      menuActions.set(ctx.instanceId, {
        toggleToolbar: () => setToolbarVisible(!state.value.toolbarVisible),
        copyMarkdown: () => ctx.clipboard!.writeText(state.value.markdown),
      });

      onScopeDispose(() => {
        if (saveTimer !== undefined) clearTimeout(saveTimer);
        void persistNow();
        menuActions.delete(ctx.instanceId);
        // Keep the last snapshot available to palette search while a hidden
        // instance is unmounted; host disposal evicts its canonical data.
      });

      state.value = normalizeState(await ctx.data.get<NotesWidgetState>(NOTES_STATE_KEY));
      hydrated = true;

      return {
        state,
        setMarkdown,
        setToolbarVisible,
        openUrl: (url) => ctx.openExternal!.open(url),
        flush: persistNow,
      };
    },
  },
});
