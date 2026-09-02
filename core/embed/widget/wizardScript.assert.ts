/**
 * Every scripted Wizard reply is parsed by the product's own parser.
 * Run: npx tsx core/embed/widget/wizardScript.assert.ts
 *
 * This is the whole reason the demo cannot quietly rot. The replies are hand
 * written, and a hand-written reply in the wrong format shows up in the browser
 * as a Wizard that answers and produces nothing — a failure that looks like a
 * bug in the Wizard rather than a typo in a fixture. Checking them here against
 * `parseGeneratedFiles` means the fixture fails in CI instead.
 *
 * Whether a manifest is *valid* is checked by
 * `scripts/wizardPreviewDocument.assert.ts` with the host's own validator.
 * Duplicating a schema by hand here is what once let a reply pass while the
 * product rejected it.
 */
import { parseGeneratedFiles } from "../../../extensions/widget-wizard/widgetWizardLogic";
import { DEMO_MODELS, DEMO_PROMPTS, DEMO_REPLIES } from "./wizardScript";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const NEWLINE = String.fromCharCode(10);

assert(
  DEMO_REPLIES.length === DEMO_PROMPTS.length,
  "every scripted prompt has a reply, and no reply is unreachable",
);

DEMO_REPLIES.forEach((text, index) => {
  const where = `reply ${index + 1}`;
  const parsed = parseGeneratedFiles(text);

  assert(parsed.unterminated === null, `${where}: no file block is left open`);
  assert(parsed.prose.trim().length > 0, `${where}: says something besides code`);

  /**
   * Paragraphs, not lines. The prose was once hard-wrapped at ~72 characters
   * like the comments around it; the transcript wraps at its own width and
   * keeps the author's breaks too, so the message rendered ragged. Nothing
   * failed — it just looked like a bug in the chat.
   */
  for (const paragraph of parsed.prose.split(NEWLINE + NEWLINE)) {
    const line = paragraph.trim();
    if (line.length === 0) continue;
    assert(
      !line.includes(NEWLINE),
      `${where}: a paragraph carries a hard line break; let the client wrap it`,
    );
  }

  const paths = parsed.files.map((file) => file.path).sort();
  assert(
    paths.join(",") === "index.html,manifest.json,widget.js",
    `${where}: expected a runtime package's three files, got: ${paths.join(", ") || "(none)"}`,
  );

  /**
   * Every turn writes the complete set. The Wizard's draft write replaces the
   * file list, so a reply that mentions only what changed deletes the rest.
   */
  const manifest = parsed.files.find((file) => file.path === "manifest.json");
  const parsedManifest = JSON.parse(manifest!.contents) as { ui?: { entry?: string } };
  assert(
    parsedManifest.ui?.entry === "index.html",
    `${where}: the manifest's entry is one of the files the reply carries`,
  );

  const script = parsed.files.find((file) => file.path === "widget.js");
  assert(
    script && script.contents.includes("kavibay-widget"),
    `${where}: the script mounts into the host node`,
  );
});

/**
 * The two turns differ in exactly the way the follow-up asks for.
 *
 * This is what makes the second turn worth showing: the visitor asks for a
 * percentage and the widget gains one. If both replies were identical the demo
 * would look like a model that ignored the request.
 */
const first = parseGeneratedFiles(DEMO_REPLIES[0]!);
const second = parseGeneratedFiles(DEMO_REPLIES[1]!);
const scriptOf = (reply: typeof first) =>
  reply.files.find((file) => file.path === "widget.js")!.contents;

assert(
  scriptOf(first).includes("SHOW_PERCENT = false"),
  "the first turn's widget shows no percentage",
);
assert(
  scriptOf(second).includes("SHOW_PERCENT = true"),
  "the second turn's widget shows the percentage the follow-up asked for",
);
assert(
  DEMO_PROMPTS[1]!.includes("percentage"),
  "the follow-up prompt is what asked for it",
);

/**
 * The picker reads `configured`; a model that is not configured shows as an
 * account to connect, which this page cannot offer.
 */
assert(DEMO_MODELS.length > 0, "the picker has models to show");
assert(
  DEMO_MODELS.every((model) => model.configured && model.enabled),
  "every demo model is presented as ready to use",
);
assert(
  DEMO_MODELS.filter((model) => model.authoringDefault).length === 1,
  "exactly one model is the authoring default the Wizard opens on",
);

console.log("core/embed/widget/wizardScript.assert.ts: ok");
