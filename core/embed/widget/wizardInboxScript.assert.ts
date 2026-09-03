/**
 * Both Wizard recordings parse as packages the host would actually write.
 * Run: npx tsx core/embed/widget/wizardInboxScript.assert.ts
 */
import {
  fileSetProblem,
  isContractPackageFiles,
  parseGeneratedFiles,
} from "../../../extensions/widget-wizard/widgetWizardLogic";
import { isMentionPart } from "./wizardDemoScript";
import { INBOX_DEMO, INBOX_FINAL_MARKER } from "./wizardInboxScript";
import { WIZARD_DEMOS } from "./wizardDemos";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(WIZARD_DEMOS["linear-github-todos"] === INBOX_DEMO, "the inbox is the Linear/GitHub case");
assert(
  INBOX_DEMO.prompts.length === INBOX_DEMO.replies.length,
  "every scripted prompt has a reply, and no reply is unreachable",
);

const prompt = INBOX_DEMO.prompts[0]!;
const mentions = prompt.filter(isMentionPart);
assert(mentions.length === 2, "the ask names two accounts");
assert(mentions[0]!.mention === "Linear", "Linear is picked first, as the sentence says");
assert(mentions[1]!.mention === "GitHub", "GitHub is picked second");
assert(
  prompt.filter((part) => typeof part === "string").join("").includes("tasks that should be taken care of"),
  "the rest of the sentence is still there around the mentions",
);

const parsed = parseGeneratedFiles(INBOX_DEMO.replies[0]!);
assert(parsed.unterminated === null, "no file block is left open");
assert(parsed.prose.trim().length > 0, "the reply says something besides code");

const NEWLINE = String.fromCharCode(10);
for (const paragraph of parsed.prose.split(NEWLINE + NEWLINE)) {
  const line = paragraph.trim();
  if (line.length === 0) continue;
  assert(
    !line.includes(NEWLINE),
    "a paragraph carries a hard line break; let the client wrap it",
  );
}

const paths = parsed.files.map((file) => file.path).sort();
assert(
  paths.join(",") === "index.html,manifest.json,widget.js",
  `expected a package's three files, got: ${paths.join(", ") || "(none)"}`,
);

assert(isContractPackageFiles(parsed.files), "naming two accounts makes this a contract package");
assertEq(
  fileSetProblem(parsed.files, "", "contract-package"),
  null,
  "the host would accept the manifest's name on the first turn",
);
assertEq(
  fileSetProblem(parsed.files, "inbox", "contract-package"),
  null,
  "and the name it chose is the draft the desk card opens",
);

const manifest = JSON.parse(parsed.files.find((file) => file.path === "manifest.json")!.contents) as {
  name?: string;
  widget?: { requires?: { providers?: string[] } };
};
assert(manifest.name === "inbox", "the contract field is name, not id");
assert(
  JSON.stringify(manifest.widget?.requires?.providers) ===
    JSON.stringify(["kavibay.linear/linear", "kavibay.github/github"]),
  "the package asks for the two accounts the prompt named",
);

const html = parsed.files.find((file) => file.path === "index.html")!.contents;
assert(html.includes("@kavibay/runtime.js"), "the embed preview can inline the runtime");
assert(html.includes("kavibay-widget"), "the script mounts into the host node");

const script = parsed.files.find((file) => file.path === "widget.js")!.contents;
assert(script.includes(INBOX_FINAL_MARKER), "the tour's finished-package marker is in the widget");
assert(!script.includes('textContent = "Inbox"'), "the list does not repeat the card title");
assert(script.includes("review requested"), "GitHub rows are pull-request review requests");
assert(script.includes("ENG-"), "Linear rows carry issue identifiers");
assert(script.includes("LINEAR_MARK") && script.includes("GITHUB_MARK"), "each row carries that account's mark");
assert(!script.includes("ctx.providers"), "the preview has no provider bridge, so the rows are fixtures");

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

console.log("core/embed/widget/wizardInboxScript.assert.ts: ok");
