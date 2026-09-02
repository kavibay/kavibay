import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const vite = await createServer({
  appType: "custom",
  server: { middlewareMode: true },
});

try {
  const {
    clearNotesState,
    disposeNotesState,
    useNotesState,
  } = await vite.ssrLoadModule("/src/widgets/useNotesState.ts");
  const { storageKey } = await vite.ssrLoadModule("/src/widgets/notesLogic.ts");

  const instanceId = "notes-final-fix-dispose";
  const { setMarkdown, flush } = useNotesState(instanceId);
  setMarkdown("pending markdown");
  disposeNotesState(instanceId);
  clearNotesState(instanceId);
  flush();
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    storage.get(storageKey(instanceId)),
    undefined,
    "disposing and clearing notes must prevent both flush and debounce persistence",
  );

  const notesWidget = await readFile("src/widgets/NotesWidget.vue", "utf8");
  assert.match(
    notesWidget,
    /StarterKit\.configure\(\{[\s\S]*?link:\s*false,[\s\S]*?underline:\s*false,/,
    "StarterKit must disable its bundled Link and Underline extensions",
  );

  if (typeof globalThis.document === "undefined") {
    console.log(
      "TipTap markdown round-trip was not run: this Node environment has no DOM implementation.",
    );
  }

  console.log("Notes disposal regression and extension configuration checks passed.");
} finally {
  await vite.close();
}
