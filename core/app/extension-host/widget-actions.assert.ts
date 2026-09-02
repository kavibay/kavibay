/**
 * Run: npx tsx core/app/extension-host/widget-actions.assert.ts
 *
 * Pairing a manifest's action declaration with the definition's handler fails
 * silently in both directions if it is not checked: a declaration without a
 * handler puts a row in the palette that does nothing when pressed, and a
 * handler without a declaration is code no one can reach and no reviewer
 * reading the manifest would know exists. The old loader only warned about the
 * second, and dropped it.
 */
import { toActionDeclarations } from "./widgetActions";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function refuses(what: string, raw: unknown, handlers: Record<string, unknown> | undefined, expect: string) {
  try {
    toActionDeclarations("demo", "tile", raw, handlers);
  } catch (error) {
    assert(
      String((error as Error).message).includes(expect),
      `${what}: refused, but the message does not say why — got "${(error as Error).message}"`,
    );
    return;
  }
  throw new Error(`${what}: was accepted, and should not have been`);
}

const search = {
  id: "search-emojis",
  title: "Search Emoji",
  subtitle: "Search the emoji picker",
  keywords: ["search", "find"],
  params: [{ name: "search", type: "text", required: true, placeholder: "Emoji name or keyword" }],
};
const handler = () => {};

// --- the ordinary case ------------------------------------------------------
{
  const out = toActionDeclarations("emoji-picker", "emoji-picker", [search], { "search-emojis": handler });
  assert(out.length === 1, "one declaration in, one out");
  assert(out[0].title === "Search Emoji", "the title survives");
  assert(out[0].subtitle === "Search the emoji picker", "so does the subtitle");
  assert(out[0].keywords?.join(",") === "search,find", "and the keywords the palette matches on");
  assert(out[0].params?.[0].placeholder === "Emoji name or keyword", "and the prompt the person reads");
}

// --- both halves are required ----------------------------------------------
refuses(
  "a declaration with no handler",
  [search],
  {},
  "does not implement",
);
refuses(
  "a handler with no declaration",
  [],
  { "search-emojis": handler },
  "manifest.json does not declare",
);
refuses(
  "a handler under a different id than the declaration",
  [search],
  { "search-emoji": handler },
  "does not implement",
);
refuses("an action without an id", [{ title: "No id" }], { x: handler }, "without an id or a title");
refuses("an action without a title", [{ id: "x" }], { x: handler }, "without an id or a title");

// --- a widget with no actions at all is not an error ------------------------
{
  assert(toActionDeclarations("clock", "clock", undefined, undefined).length === 0, "no actions is fine");
  assert(toActionDeclarations("clock", "clock", [], {}).length === 0, "and so are two empty halves");
}

/** The message has to name the extension and widget — a bare id is unsearchable. */
try {
  toActionDeclarations("notes", "notes", [search], {});
} catch (error) {
  const message = String((error as Error).message);
  assert(message.includes("notes"), `the message must name the extension, got "${message}"`);
  assert(message.includes("search-emojis"), `and the action, got "${message}"`);
}

console.log("widget-actions.assert.ts: ok");
