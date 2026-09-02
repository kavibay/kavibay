import { effectScope } from "vue";
import type { WidgetContext } from "@sdk/contract/sdk";
import emojiPickerExtension from "../extension";
import {
  duplicateEmojiPickerData,
  emojiPickerWidget,
  runSearchEmojisAction,
  type EmojiPickerModel,
} from "./emojiPicker";
import { normalizeEmojiPickerState } from "../emojiPickerLogic";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(emojiPickerExtension.name === "emoji-picker", "the port keeps the emoji picker id");
const cells = new Map<string, unknown>();
const data = {
  get: async <T>(key: string) => cells.get(key) as T | undefined,
  set: async <T>(key: string, value: T) => { cells.set(key, value); },
  delete: async (key: string) => { cells.delete(key); },
};
const context = {
  instanceId: "emoji-picker-assert",
  config: {},
  data,
  sharedData: data,
} satisfies WidgetContext<Record<string, never>>;

const scope = effectScope();
const model = await scope.run(() => emojiPickerWidget.component.setup(context)) as EmojiPickerModel;
model.remember("😀");
await Promise.resolve();
assert(model.recent.value[0] === "😀", "remember prepends a recent emoji");
assert(normalizeEmojiPickerState(cells.get("state")).recent[0] === "😀", "recent emoji persists in the ledger");

await runSearchEmojisAction({ ctx: context, args: { search: "rocket" }, setConfig: () => undefined });
assert(model.search.value === "rocket", "palette action updates the widget search");
assert(
  normalizeEmojiPickerState(duplicateEmojiPickerData("state", { recent: ["😀", "😀", "🎉"] })).recent.length === 2,
  "duplicate normalizes recent entries",
);

scope.stop();
console.log("emoji picker contract assertions passed");
