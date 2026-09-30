/**
 * Both demo packages become documents a sandboxed frame can run.
 * Run: npx tsx core/web/packageDocument.assert.ts
 *
 * A mistake here is silent on the page: a host script left as a `src` tag is a
 * fetch from an opaque origin that never loads, and the preview card is empty
 * with nothing in the console. The host scripts are stand-ins with a marker;
 * which file they are is the caller's business, that they arrive is this one's.
 */
import { parseGeneratedFiles } from "../../extensions/widget-wizard/widgetWizardLogic";
import { INBOX_DEMO } from "../embed/widget/wizardInboxScript";
import { WATER_DEMO } from "../embed/widget/wizardScript";
import { assemblePackageDocument } from "./packageDocument";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const scripts = {
  runtime: "/* RUNTIME */ window.kavibay = {};",
  // A `$&` in the source must survive: String.replace would expand it.
  contract: "/* CONTRACT */ const tail = '$&'; '</script>';",
};

const lastReply = (replies: string[]) => parseGeneratedFiles(replies[replies.length - 1]!).files;

// The contract package: the Linear/GitHub inbox.
const inbox = assemblePackageDocument(lastReply(INBOX_DEMO.replies), scripts);
assert(inbox !== null, "the inbox has a document");
assert(!inbox.includes('src="@kavibay/contract.js"'), "the contract runtime is inlined, not fetched");
assert(!inbox.includes('src="widget.js"'), "widget.js is inlined, not fetched");
assert(inbox.includes("/* CONTRACT */ const tail = '$&';"), "the contract runtime arrives byte for byte");
assert(inbox.includes("<\\/script>"), "a closing tag inside a script is escaped");
assert(!inbox.includes("/* RUNTIME */"), "a contract package does not get the runtime-package SDK");
assert(inbox.includes(INBOX_DEMO.finalMarker), "the widget's code is in the document");
assert(
  inbox.indexOf("/* CONTRACT */") < inbox.indexOf("kavibayWidget.define"),
  "the runtime defines kavibayWidget before widget.js uses it",
);
assert(/^<!doctype html>/i.test(inbox.trim()), "the package's own document stays a whole document");

const picked = assemblePackageDocument(lastReply(INBOX_DEMO.replies), { ...scripts, picker: "/* PICKER */" });
assert(picked !== null && picked.indexOf("/* PICKER */") < picked.indexOf("/* CONTRACT */"), "the picker loads first");

// The runtime package: the water tracker, through the embed's builder.
const water = assemblePackageDocument(lastReply(WATER_DEMO.replies), scripts);
assert(water !== null, "the water tracker has a document");
assert(water.includes("/* RUNTIME */"), "a runtime package gets the runtime SDK");
assert(!water.includes("/* CONTRACT */"), "and not the contract runtime");
assert(water.includes(WATER_DEMO.finalMarker), "the water tracker's code is in the document");

assert(assemblePackageDocument([], scripts) === null, "no index.html, no document");

console.log("packageDocument.assert.ts: ok");
