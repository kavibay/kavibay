import { effectScope } from "vue";
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

const scope = effectScope();
const model = await scope.run(() => notesWidget.component.setup(context)) as NotesModel;
assert(model.state.value.markdown === "Capture the release notes", "setup restores persisted markdown");
assert(notesSearchText("notes-assert") === "Capture the release notes", "palette search reads plain text");

model.setToolbarVisible(true);
await model.flush();
assert(normalizeState(cells.get(NOTES_STATE_KEY)).toolbarVisible, "toolbar preference persists through ctx.data");

model.setMarkdown("Updated note");
await model.flush();
assert(normalizeState(cells.get(NOTES_STATE_KEY)).markdown === "Updated note", "editor changes persist through ctx.data");
scope.stop();

console.log("notes contract assertions passed");
