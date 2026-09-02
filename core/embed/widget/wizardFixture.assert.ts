/**
 * The Wizard fixture answers the way the real draft service answers.
 * Run: npx tsx core/embed/widget/wizardFixture.assert.ts
 *
 * WHY THIS FILE EXISTS:
 *
 * A fixture that returns *plausible* values is not the same as one that
 * returns the *contracted* ones, and the difference is invisible until the
 * product acts on it. Measured, in the browser, twice:
 *
 *  1. A missing draft answered `null` instead of refusing. `expectedDraftRevision`
 *     treats a successful read as "somebody else holds this id" and told the
 *     visitor a draft already existed — on a page where none did.
 *  2. Before that, a manifest in the wrong format sent the Wizard into a repair
 *     loop. That one is covered by `scripts/wizardPreviewDocument.assert.ts`.
 *
 * Both were silent in every check that existed at the time. These are the
 * semantics, written down.
 */
import { wizardFixture } from "./wizardFixture";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function rejectsWith(fn: () => Promise<unknown>, needle: string): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (error) {
    return String(error).includes(needle);
  }
}

const ID = "assert-widget";

await (async () => {
  assert(
    await rejectsWith(() => wizardFixture.wizardDraftRead(ID), "draft_not_found"),
    "reading a draft that does not exist is refused with draft_not_found",
  );

  const files = [
    { path: "manifest.json", contents: "{}" },
    { path: "index.html", contents: "<div></div>" },
  ];
  const written = (await wizardFixture.wizardDraftWrite(ID, files)) as {
    id: string;
    files: string[];
    revision: string;
  };
  assert(written.id === ID, "a write answers about the draft it was sent to");
  assert(
    written.files.join(",") === "manifest.json,index.html",
    "the summary lists the paths that were written",
  );

  const read = (await wizardFixture.wizardDraftRead(ID)) as { files: { path: string }[] };
  assert(read.files.length === 2, "what was written can be read back");

  const second = (await wizardFixture.wizardDraftWrite(ID, files)) as { revision: string };
  assert(second.revision !== written.revision, "every write gets a new revision");

  await wizardFixture.wizardDraftDiscard(ID);
  assert(
    await rejectsWith(() => wizardFixture.wizardDraftRead(ID), "draft_not_found"),
    "a discarded draft is gone",
  );

  /**
   * The two writes a demo must refuse rather than fake. Both would install
   * into a desktop app that this page does not have; a success reply would
   * leave somebody looking for a widget that was never created.
   */
  assert(
    await rejectsWith(() => wizardFixture.wizardDraftPromote(ID), "not part of this demo"),
    "saving a widget is refused, not faked",
  );
  assert(
    await rejectsWith(
      () => wizardFixture.wizardRuntimeSetEnabled(ID, true, [], []),
      "not part of this demo",
    ),
    "enabling a widget is refused, not faked",
  );

  /**
   * The preview stage is gated on this being truthy. Returning "" made the
   * Wizard render its empty state regardless of what the draft held — the
   * files were there, the preview was not.
   */
  const url = wizardFixture.wizardRuntimeEntryUrl("__draft__" + ID, "index.html");
  assert(url.length > 0, "an entry url is non-empty, or no preview renders at all");
  assert(url.includes(ID), "the url names the draft it stands for");

  /** Nothing is installed on a web page, so these are empty rather than absent. */
  assert(
    ((await wizardFixture.wizardRuntimeInstalls()) as unknown[]).length === 0,
    "no widget is installed here",
  );
  assert(
    ((await wizardFixture.wizardConversationsList()) as unknown[]).length === 0,
    "the tab starts with no conversations",
  );

  console.log("core/embed/widget/wizardFixture.assert.ts: ok");
})();
