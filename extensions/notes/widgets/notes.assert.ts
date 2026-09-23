import { computed, effectScope } from "vue";
import type { WidgetContext } from "@sdk/contract/sdk";
import notesExtension from "../extension";
import {
  NOTES_STATE_KEY,
  notesSearchText,
  notesWidget,
  runNewNoteAction,
  type NotesModel,
} from "./notes";
import { normalizeState } from "../notesLogic";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(notesExtension.name === "notes", "the port keeps the notes extension id");
const cells = new Map<string, unknown>();
const data = {
  get: async <T>(key: string) => cells.get(key) as T | undefined,
  set: async <T>(key: string, value: T) => { cells.set(key, value); },
  delete: async (key: string) => { cells.delete(key); },
};
const context = {
  instanceId: "notes-assert",
  config: {},
  data,
} satisfies WidgetContext<Record<string, never>>;

await runNewNoteAction({ ctx: context, args: { text: "Capture the release notes" }, setConfig: () => undefined });
assert(
  normalizeState(cells.get(NOTES_STATE_KEY)).markdown === "Capture the release notes",
  "palette action persists a new note",
);

// The palette can ask before the widget mounts; its cached text must hydrate later.
const searchText = computed(() => notesSearchText(context.instanceId));
assert(searchText.value === "", "unmounted note starts with no search text");
const scope = effectScope();
const model = await scope.run(() => notesWidget.component.setup(context)) as NotesModel;
assert(model.state.value.markdown === "Capture the release notes", "setup restores persisted markdown");
assert(notesSearchText("notes-assert") === "Capture the release notes", "palette search reads plain text");
assert(searchText.value === "Capture the release notes", "cached search text follows the first mount and hydration");

model.setToolbarVisible(true);
await model.flush();
assert(normalizeState(cells.get(NOTES_STATE_KEY)).toolbarVisible, "toolbar preference persists through ctx.data");

model.setMarkdown("Updated note");
assert(searchText.value === "Updated note", "cached search text follows edits before persistence");
await model.flush();
assert(normalizeState(cells.get(NOTES_STATE_KEY)).markdown === "Updated note", "editor changes persist through ctx.data");
scope.stop();
assert(searchText.value === "Updated note", "hidden note keeps its searchable snapshot");

await data.set(NOTES_STATE_KEY, normalizeState({ markdown: "Reopened note" }));
const reopenedScope = effectScope();
const reopened = await reopenedScope.run(() => notesWidget.component.setup(context)) as NotesModel;
assert(searchText.value === "Reopened note", "cached search text follows a replacement instance state");
reopened.setMarkdown("Edited after reopening");
assert(searchText.value === "Edited after reopening", "cached search text subscribes to the replacement state");
await reopened.flush();
reopenedScope.stop();

console.log("notes contract assertions passed");
