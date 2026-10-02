/**
 * The preview document is assembled from the package's own files.
 * Run: npx tsx scripts/wizardPreviewDocument.assert.ts
 *
 * Under `scripts/` rather than beside the module it checks, because it reads
 * the runtime file from disk and `tsconfig.json` does not give `core/**` the
 * node types. Every other assert that touches the filesystem lives here too.
 *
 * Checked here rather than in a browser because the failure mode is silent: a
 * regex that stops matching leaves the `<script src>` tag in place, the
 * sandboxed frame tries to fetch it from an opaque origin, the fetch fails,
 * and the preview renders an empty box. Nothing throws.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGeneratedFiles } from "../extensions/widget-wizard/widgetWizardLogic";
import { validateRuntimeManifest } from "../core/app/runtime/manifestValidate";
import { DEMO_REPLIES } from "../core/embed/widget/wizardScript";
import { INBOX_DEMO } from "../core/embed/widget/wizardInboxScript";
import { LISBON_REPLIES } from "../core/embed/widget/wizardLisbonScript";
import { PICK_REPLIES } from "../core/embed/widget/wizardPickScript";
import { STATUS_REPLIES } from "../core/embed/widget/wizardStatusScript";
import { buildPreviewDocument } from "../core/embed/widget/wizardPreviewDocument";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** The same file the component hands in via Vite's `?raw`. */
const runtimeSource = readFileSync(
  fileURLToPath(new URL("../sdk/runtime/kavibay-runtime.js", import.meta.url)),
  "utf8",
);

const files = parseGeneratedFiles(DEMO_REPLIES[0]!).files;

/**
 * The manifest passes the host's own validator.
 *
 * This is the check that was missing, and its absence was visible in the
 * product: the scripted answer carried a *contract* manifest under a runtime
 * package's name, the Wizard read `manifest.id` as `undefined`, reported "that
 * package has a problem" and asked the model to fix it — which replayed the
 * same answer, forever. A demo cannot fail more publicly than by looping.
 */
for (const [index, text] of [...DEMO_REPLIES, ...LISBON_REPLIES, ...STATUS_REPLIES, ...PICK_REPLIES].entries()) {
  const manifestFile = parseGeneratedFiles(text).files.find((f) => f.path === "manifest.json");
  assert(manifestFile, `reply ${index + 1} carries a manifest`);
  const manifestRaw = JSON.parse(manifestFile!.contents) as { id?: string };
  const validation = validateRuntimeManifest(manifestRaw.id ?? "", manifestRaw);
  assert(
    validation.ok,
    `reply ${index + 1}'s manifest is a valid runtime manifest (got: ${"error" in validation ? validation.error : "?"})`,
  );
}

const doc = buildPreviewDocument(files, runtimeSource);

const pickerSource = readFileSync(new URL("../core/app/extension-host/previewPickerGuest.js", import.meta.url), "utf8");
const inspected = buildPreviewDocument(files, runtimeSource, pickerSource)!;
assert(!doc?.includes("kavibay.preview.ready"), "Ordinary previews never load the picker");
assert(inspected.indexOf("kavibay.preview.ready") < inspected.indexOf("GOAL_ML"), "Opted-in previews install capture handlers before widget code");

assert(doc !== null, "the scripted package produces a document");

/**
 * Exact spellings, not a pattern.
 *
 * A looser `src=...runtime.js` matched the example tag inside the runtime's
 * own doc comment, which is now inlined in the document — the assert failed
 * on text it had itself pulled in. What matters is that the *package's* two
 * tags are gone.
 */
assert(!doc!.includes('src="widget.js"'), "widget.js is inlined, not linked");
assert(
  !doc!.includes('src="@kavibay/runtime.js"'),
  "the runtime is inlined, not linked — an opaque origin cannot fetch it",
);

/**
 * Exactly two closing script tags: the runtime's and the widget's.
 *
 * This is the check that was missing when the preview first rendered. The
 * runtime SDK's header comment contains an example `</script>`, which ended
 * the inline block early — the rest of the SDK appeared on screen as prose and
 * the runtime never loaded. Counting is what catches it: the document is still
 * valid HTML, still renders, and still looks broken.
 */
const closings = doc!.split("</script>").length - 1;
assert(
  closings === 2,
  `expected two closing script tags, found ${closings} — something inlined escaped its block`,
);

assert(doc!.includes("kavibay-widget"), "the package's own mount node survives");
assert(doc!.includes("GOAL_ML"), "the widget's own script is in the document");
assert(
  doc!.includes("kavibay.ext.ready"),
  "the real runtime is what got inlined, not a stub of it",
);

/** No entry document means nothing to show, not a broken document. */
assert(buildPreviewDocument([], runtimeSource) === null, "an empty draft previews as nothing");
assert(
  buildPreviewDocument([{ path: "widget.js", contents: "" }], runtimeSource) === null,
  "a package without index.html previews as nothing",
);

/**
 * Both turns survive the trip into a document.
 *
 * The rendered preview cannot be inspected from the page — the frame is
 * `sandbox="allow-scripts"` with no `allow-same-origin`, so its document is
 * cross-origin to its own parent, which is exactly the isolation the app
 * requires. What can be checked is what goes in, so it is checked here.
 */
const docs = DEMO_REPLIES.map((text) =>
  buildPreviewDocument(parseGeneratedFiles(text).files, runtimeSource),
);

assert(
  docs.every((each) => each !== null),
  "every turn produces a preview document",
);
assert(
  docs[0]!.includes("SHOW_PERCENT = false") && docs[1]!.includes("SHOW_PERCENT = true"),
  "the follow-up's percentage reaches the preview document, not just the file list",
);
assert(
  docs.every((each) => each!.includes("+")) && docs[1]!.includes("of 3 L today"),
  "the widget the visitor sees is the water tracker, in both turns",
);

/**
 * The Linear/GitHub recording is a real contract package: it loads the host's
 * `@kavibay/contract.js` and reads its rows from two providers. The embed
 * preview has neither a contract runtime nor a provider bridge, so it is only
 * shown where the app itself runs — the landing's web build, which assembles
 * it in core/web/packageDocument.ts (asserted there). What this file still
 * holds is that the package is not mistaken for a runtime one.
 */
const inboxFiles = parseGeneratedFiles(INBOX_DEMO.replies[0]!).files;
const inboxHtml = inboxFiles.find((file) => file.path === "index.html")!.contents;
assert(inboxHtml.includes('src="@kavibay/contract.js"'), "the inbox loads the contract runtime");
assert(!inboxHtml.includes("@kavibay/runtime.js"), "and not the runtime-package one");

console.log("scripts/wizardPreviewDocument.assert.ts: ok");
