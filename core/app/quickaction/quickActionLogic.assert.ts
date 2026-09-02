/**
 * Run: npx tsx core/app/quickaction/quickActionLogic.assert.ts
 */
import {
  appendStreamChunk,
  errorMessage,
  finishStream,
  isBusy,
  moveSelection,
  outputText,
  previewText,
  runningActionId,
} from "./quickActionLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// --- keyboard selection wraps in both directions ---
{
  assert(moveSelection(0, 4, 1) === 1, "down");
  assert(moveSelection(3, 4, 1) === 0, "down wraps to the top");
  assert(moveSelection(0, 4, -1) === 3, "up wraps to the bottom");
  assert(moveSelection(2, 4, -1) === 1, "up");
  assert(moveSelection(2, 0, 1) === 0, "an empty menu has no selection to move");
  assert(moveSelection(-5, 4, 0) === 3, "a stale index is brought back in range");
}

// --- preview line ---
{
  assert(previewText("  hello   world \n again ") === "hello world again", "whitespace collapses");
  assert(previewText("short", 64) === "short", "short text is untouched");

  const long = "Der Text ist deutlich laenger als die erlaubte Vorschau und muss gekuerzt werden";
  const preview = previewText(long, 40);
  assert(preview.endsWith("…"), "long text is elided");
  assert(preview.length <= 41, `preview too long: ${preview.length}`);
  assert(!preview.slice(0, -1).endsWith(" "), "no space before the ellipsis");

  // A single word longer than the limit has no boundary to cut on.
  const wall = "x".repeat(80);
  assert(previewText(wall, 20) === `${"x".repeat(20)}…`, "hard cut when there is no space");
}

// --- errors from three different worlds all become a string ---
{
  assert(errorMessage("no quick action is pending") === "no quick action is pending", "string");
  assert(errorMessage(new Error("  boom  ")) === "boom", "Error");
  assert(errorMessage(undefined) === "Something went wrong", "fallback");
  assert(errorMessage(new Error("")) === "Something went wrong", "empty message falls back");
  assert(errorMessage(null, "nope") === "nope", "custom fallback");
}

// --- phase helpers ---
{
  assert(!isBusy({ kind: "menu" }), "menu is idle");
  assert(isBusy({ kind: "running", actionId: "translate" }), "running is busy");
  assert(isBusy({ kind: "streaming", actionId: "translate", text: "Hi" }), "streaming is busy");
  assert(!isBusy({ kind: "error", message: "x" }), "error is idle again");
  assert(!isBusy({ kind: "result", actionId: "translate", text: "Hello" }), "result is idle");
  assert(runningActionId({ kind: "running", actionId: "translate" }) === "translate", "id");
  assert(runningActionId({ kind: "streaming", actionId: "translate", text: "" }) === "translate", "streaming id");
  assert(runningActionId({ kind: "menu" }) === undefined, "no id when idle");
}

// --- streamed output grows from running → streaming, then settles as result ---
{
  const started = { kind: "running" as const, actionId: "translate" };
  const first = appendStreamChunk(started, "translate", "Hel");
  assert(first.kind === "streaming" && first.text === "Hel", "first chunk opens the stream");
  const next = appendStreamChunk(first, "translate", "lo");
  assert(next.kind === "streaming" && next.text === "Hello", "later chunks append");
  assert(appendStreamChunk(next, "other", "x") === next, "chunks from another run are ignored");
  assert(appendStreamChunk(next, "translate", "") === next, "empty chunks do not rewrite");
  assert(outputText(next) === "Hello", "output while streaming");

  const done = finishStream(next, "translate", "Hello!");
  assert(done.kind === "result" && done.text === "Hello!", "done becomes a result");
  assert(outputText(done) === "Hello!", "output after done");
  assert(finishStream(done, "translate", "nope") === done, "a finished result is left alone");
  assert(!isBusy(done), "result is no longer busy");
}

console.log("quickActionLogic.assert.ts: ok");
