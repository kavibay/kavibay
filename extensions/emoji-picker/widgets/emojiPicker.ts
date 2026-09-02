// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, type Ref } from "vue";
import {
  defineWidget,
  type WidgetActionContext,
  type WidgetContext,
  type WidgetDataStore,
  type WidgetPaletteInstanceAction,
} from "@sdk/contract/sdk";
import {
  normalizeEmojiPickerState,
  normalizeRecent,
  pushRecent,
  type EmojiPickerStoredState,
} from "../emojiPickerLogic";

export const EMOJI_PICKER_STATE_KEY = "state";

export interface EmojiPickerModel {
  instanceId: string;
  recent: Ref<string[]>;
  search: Ref<string>;
  searchFocusRequest: Ref<number>;
  requestSearchFocus(): void;
  remember(glyph: string): void;
}

const sharedRecent = ref<string[]>([]);
let sharedRecentLoaded = false;
const liveModels = new Map<string, EmojiPickerModel>();
const dataContexts = new Map<string, WidgetDataStore>();
const pendingSearches = new Map<string, string>();

async function persistSharedRecent(): Promise<void> {
  const state: EmojiPickerStoredState = { recent: normalizeRecent(sharedRecent.value) };
  await Promise.all(
    [...dataContexts.values()].map((storage) =>
      storage.set(EMOJI_PICKER_STATE_KEY, state).catch(() => undefined),
    ),
  );
}

function mergeRecent(values: string[]): void {
  sharedRecent.value = normalizeRecent([...values, ...sharedRecent.value]);
}

export function duplicateEmojiPickerData(key: string, value: unknown): unknown {
  if (key !== EMOJI_PICKER_STATE_KEY) return value;
  return normalizeEmojiPickerState(value);
}

/** Palette action; a pending query survives until the target view mounts. */
export async function runSearchEmojisAction({
  ctx,
  args,
}: WidgetActionContext<Record<string, never>>): Promise<void> {
  const search = args.search ?? "";
  const model = liveModels.get(ctx.instanceId);
  if (model) {
    model.search.value = search;
    model.requestSearchFocus();
  } else {
    pendingSearches.set(ctx.instanceId, search);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("kavibay:reveal-widget", { detail: { instanceId: ctx.instanceId } }),
    );
  }
}

export function emojiPickerInstanceActions(instanceId: string): WidgetPaletteInstanceAction[] {
  const model = liveModels.get(instanceId);
  if (!model) return [];
  return [
    {
      id: "search-emojis",
      title: "Search Emoji",
      param: {
        name: "search",
        type: "text",
        required: true,
        placeholder: "Emoji name or keyword",
      },
      run: (search: string) => {
        model.search.value = search;
        model.requestSearchFocus();
      },
    },
  ];
}

export const emojiPickerWidget = defineWidget<Record<string, never>>({
  name: "emoji-picker",
  displayName: "Emoji Picker",
  description: "Browse, search, and copy emoji.",
  defaultSize: { w: 3, h: 3 },
  minSize: { w: 2, h: 2 },
  mode: "both",
  palette: { instanceActions: emojiPickerInstanceActions },
  actions: { "search-emojis": runSearchEmojisAction },
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>): Promise<EmojiPickerModel> {
      const pendingSearch = pendingSearches.get(ctx.instanceId) ?? "";
      pendingSearches.delete(ctx.instanceId);
      const search = ref(pendingSearch);
      const searchFocusRequest = ref(pendingSearch ? 1 : 0);
      const model: EmojiPickerModel = {
        instanceId: ctx.instanceId,
        recent: sharedRecent,
        search,
        searchFocusRequest,
        requestSearchFocus: () => {
          searchFocusRequest.value += 1;
        },
        remember: (glyph) => {
          sharedRecent.value = pushRecent(sharedRecent.value, glyph);
          void persistSharedRecent();
        },
      };

      liveModels.set(ctx.instanceId, model);
      const storage = ctx.sharedData ?? ctx.data;
      dataContexts.set(ctx.instanceId, storage);

      onScopeDispose(() => {
        void persistSharedRecent();
        liveModels.delete(ctx.instanceId);
        dataContexts.delete(ctx.instanceId);
      });

      const saved = normalizeEmojiPickerState(
        await storage.get<EmojiPickerStoredState>(EMOJI_PICKER_STATE_KEY),
      );
      if (!sharedRecentLoaded) {
        sharedRecent.value = saved.recent;
        sharedRecentLoaded = true;
      } else {
        mergeRecent(saved.recent);
      }

      return model;
    },
  },
});
