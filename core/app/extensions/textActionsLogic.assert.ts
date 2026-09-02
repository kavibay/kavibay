/**
 * Run: npx tsx core/app/extensions/textActionsLogic.assert.ts
 */
import {
  folderFromManifestPath,
  normalizeTextActions,
  sortTextActions,
  type ResolvedTextAction,
} from "./textActionsLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Collect warnings instead of printing them, so the run stays readable. */
function collect(): { warn: (m: string) => void; messages: string[] } {
  const messages: string[] = [];
  return { warn: (m: string) => messages.push(m), messages };
}

// --- the happy path keeps declaration order ---
{
  const { warn, messages } = collect();
  const actions = normalizeTextActions(
    "one-purpose-llm",
    {
      id: "one-purpose-llm",
      textActions: [
        {
          id: "translate",
          title: "Translate",
          subtitle: "German ↔ English",
          widgetAction: { id: "use-template", args: { template: "Translate" } },
        },
        { id: "correct-grammar", title: "Correct grammar" },
      ],
    },
    warn,
  );
  assert(actions.length === 2, "both actions kept");
  assert(actions[0].actionId === "translate", "declaration order kept");
  assert(actions[0].extensionId === "one-purpose-llm", "extension id carried");
  assert(actions[0].subtitle === "German ↔ English", "subtitle kept");
  assert(actions[0].widgetAction?.args.template === "Translate", "widget hand-off kept");
  assert(actions[1].subtitle === undefined, "missing subtitle stays absent");
  assert(messages.length === 0, "no warnings on a clean manifest");
}

// --- an invalid hand-off does not remove the primary quick action ---
{
  const { warn } = collect();
  const [action] = normalizeTextActions(
    "broken",
    { textActions: [{ id: "translate", title: "Translate", widgetAction: { id: "use", args: { n: 1 } } }] },
    warn,
  );
  assert(action?.widgetAction === undefined, "invalid hand-off ignored");
}

// --- an extension without the field is simply not in the menu ---
{
  const { warn, messages } = collect();
  assert(normalizeTextActions("clock", { id: "clock" }, warn).length === 0, "no field, no rows");
  assert(messages.length === 0, "omitting textActions is not a mistake");
  assert(normalizeTextActions("clock", null, warn).length === 0, "no manifest, no rows");
}

// --- malformed entries drop one row, never the whole menu ---
{
  const { warn, messages } = collect();
  const actions = normalizeTextActions(
    "broken",
    {
      textActions: [
        { title: "No id" },
        { id: "  ", title: "Blank id" },
        { id: "no-title" },
        { id: "ok", title: "Fine" },
        { id: "ok", title: "Duplicate" },
      ],
    },
    warn,
  );
  assert(actions.length === 1 && actions[0].actionId === "ok", "only the valid row survives");
  assert(messages.length === 4, "every dropped row is explained");
}

// --- a non-array field is a manifest bug, not a crash ---
{
  const { warn, messages } = collect();
  assert(normalizeTextActions("broken", { textActions: "translate" }, warn).length === 0, "no rows");
  assert(messages.length === 1, "warned once");
}

// --- the folder wins over a mismatching manifest id ---
{
  const actions = normalizeTextActions("real-folder", {
    id: "claimed-id",
    textActions: [{ id: "a", title: "A" }],
  });
  assert(actions[0].extensionId === "real-folder", "handler lookup follows the folder");
}

// --- sorting: extensions alphabetical, rows in declaration order ---
{
  const rows: ResolvedTextAction[] = [
    { extensionId: "zeta", actionId: "z1", title: "Z1" },
    { extensionId: "alpha", actionId: "a2", title: "A2" },
    { extensionId: "zeta", actionId: "z2", title: "Z2" },
    { extensionId: "alpha", actionId: "a1", title: "A1" },
  ];
  const sorted = sortTextActions(rows).map((row) => `${row.extensionId}/${row.actionId}`);
  assert(
    sorted.join(",") === "alpha/a2,alpha/a1,zeta/z1,zeta/z2",
    `unexpected order: ${sorted.join(",")}`,
  );
}

// --- glob paths ---
{
  assert(
    folderFromManifestPath("/extensions/one-purpose-llm/manifest.json") === "one-purpose-llm",
    "folder parsed",
  );
  assert(folderFromManifestPath("/extensions/nested/x/manifest.json") === undefined, "nested rejected");
  assert(folderFromManifestPath("/extensions/x/index.ts") === undefined, "non-manifest rejected");
}

console.log("textActionsLogic.assert.ts: ok");
