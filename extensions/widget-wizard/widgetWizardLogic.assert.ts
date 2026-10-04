/**
 * Run: npx tsx extensions/widget-wizard/widgetWizardLogic.assert.ts
 */
import {
  attachmentProblem,
  autoApprovedGrant,
  buildWizardPermissionRequest,
  askedNothingNew as wizardAskedNothingNew,
  canAutoApprove,
  unmetProviders,
  unselectedNamedProviders,
  applyDraftPresence,
  base64FromDataUrl,
  consentPreviewFor,
  buildProjectRows,
  fileKind,
  fileTreeRows,
  highlightLanguage,
  argSignature,
  describeResultShape,
  providersUsedBy,
  providerCallsIn,
  actionUses,
  queryUses,
  providerUseState,
  conversationIsWorthKeeping,
  conversationLabel,
  declaredDisplayName,
  declaredPackageId,
  freePackageId,
  isValidPackageId,
  isPlainNote,
  conversationTitle,
  describeAge,
  describeDraftAuthor,
  describeDraftClient,
  describeDraftPresence,
  draftClientFromName,
  draftAuthorWithClientName,
  presenceForWidget,
  describeDraftUpdate,
  draftAuthorOf,
  describeDraftOpen,
  describeProjectChange,
  projectTime,
  orderProjects,
  nextProjectOrder,
  moveProject,
  dropProject,
  describeProjectStatus,
  projectIsLive,
  projectState,
  defaultWizardModel,
  sortWizardModels,
  emptyWizardSession,
  packageIdFor,
  parseWizardSession,
  trimWizardSession,
  wizardSessionKey,
  describeDraftError,
  describeExportError,
  describeWizardError,
  fileSetProblem,
  renderReachesForCtx,
  lintGeneratedFiles,
  applyReplyEdits,
  REPAIR_BUDGET,
  SAMPLE_MAX,
  VERSION_LIMIT,
  NO_USAGE,
  addCost,
  addUsage,
  describeReply,
  effortForModel,
  effortLabel,
  endpointsToProbe,
  estimateCost,
  faultProblem,
  formatCost,
  formatTokens,
  freshInput,
  mergeGeneratedFiles,
  appendNote,
  withoutOtherFormat,
  readCost,
  readUsage,
  recordVersion,
  repairTurnFor,
  sampleBody,
  updateLiveVersion,
  manifestSize,
  manifestIconSvg,
  parseGeneratedFiles,
  previewPermissionsFor,
  renderFilesForPrompt,
  replyProblem,
  slugifyPackageId,
  turnForPackage,
  withDefaultSize,
  withPackageId,
  type GeneratedFile,
  type ProjectRow,
  type WizardModelOption,
  isContractPackageFiles,
  applyDraftSnapshot,
  draftSyncDecision,
  keepMineExpectedRevision,
  queueDraftConflict,
  type DraftConflict,
  type WizardDraftSnapshot,
  type WizardDraftPresence,
  splitProviderMentions,
  wizardPlatforms,
  wizardHasAnyKey,
} from "./widgetWizardLogic";
import type { WizardBubble } from "./widgetWizardLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
  );
}

// --- ids -------------------------------------------------------------------

assertEq(slugifyPackageId("Trink-Tracker"), "trink-tracker", "keeps dashes");
assertEq(slugifyPackageId("Wasser Zähler"), "wasser-zaehler", "German umlaut");
assertEq(slugifyPackageId("  spaces   here  "), "spaces-here", "collapses spaces");
assertEq(slugifyPackageId("!!!"), "my-widget", "unusable input falls back");
assertEq(slugifyPackageId(""), "my-widget", "empty falls back");
// Leading non-alphanumerics would produce an id the backend refuses outright.
assertEq(slugifyPackageId("-leading"), "leading", "no leading dash");
assertEq(slugifyPackageId("_x"), "x", "no leading underscore");
assert(slugifyPackageId("a".repeat(200)).length <= 40, "length is bounded");
// The id is a directory name and a url host, and it is permanent — so a cut
// that lands mid-word names a folder `…einfach-nur-he` forever.
assertEq(
  slugifyPackageId("erstelle ein hello widget einfach nur hello world"),
  "erstelle-ein-hello-widget-einfach-nur",
  "long input is cut at a word, not at the fortieth character",
);
assert(
  !slugifyPackageId("erstelle ein hello widget einfach nur hello world").endsWith("-"),
  "and never ends on the separator it cut at",
);
// One word longer than the whole budget has no boundary to find, so the hard
// cut is still the fallback rather than an empty id.
assertEq(slugifyPackageId("a".repeat(60)), "a".repeat(40), "a single long word is still clipped");
assertEq(
  slugifyPackageId("counter"),
  "counter",
  "anything inside the budget is untouched",
);
// The generated id must satisfy the same rule the Rust side enforces.
for (const input of ["Trink-Tracker", "!!!", "Wasser Zähler", "9 Lives", "-leading"]) {
  assert(
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(slugifyPackageId(input)),
    `slug of "${input}" must be a valid package id`,
  );
}

// --- parsing ---------------------------------------------------------------

const reply = [
  "Here is a simple counter.",
  "",
  "```json path=manifest.json",
  '{ "id": "counter" }',
  "```",
  "",
  "```html path=ui/index.html",
  "<!doctype html>",
  "",
  '<p class="x">hi</p>',
  "```",
].join("\n");

const parsed = parseGeneratedFiles(reply);
assertEq(parsed.prose, "Here is a simple counter.", "prose excludes file blocks");
assertEq(
  parsed.files.map((f) => f.path),
  ["manifest.json", "ui/index.html"],
  "both files found",
);
assertEq(
  parsed.files[1].contents,
  '<!doctype html>\n\n<p class="x">hi</p>',
  "blank lines inside a file survive",
);

// A fence without a path is an example, not a file — it belongs in the prose.
const withExample = ["Like this:", "```js", "const x = 1;", "```"].join("\n");
assertEq(parseGeneratedFiles(withExample).files, [], "plain fence is not a file");
assert(
  parseGeneratedFiles(withExample).prose.includes("const x = 1;"),
  "plain fence stays in the prose",
);

// A cut-off reply must not yield a half file: writing it would produce a broken
// widget and blame the person for it.
const truncated = ["```json path=manifest.json", '{ "id": "x"'].join("\n");
assertEq(parseGeneratedFiles(truncated).files, [], "unterminated block is dropped");
assertEq(
  parseGeneratedFiles(truncated).unterminated,
  "manifest.json",
  "an unterminated block names itself, so it is not reported as an empty answer",
);
assertEq(parseGeneratedFiles(reply).unterminated, null, "a complete reply has nothing open");

assertEq(parseGeneratedFiles("").files, [], "empty reply");

// --- fence spellings -------------------------------------------------------
//
// Each of these used to be dropped as "no files". A model that writes the fence
// unusually is not asking for a different outcome, and being strict cost the
// whole answer rather than one block.

function onlyPath(text: string): string[] {
  return parseGeneratedFiles(text).files.map((f) => f.path);
}

assertEq(onlyPath("```path=manifest.json\n{}\n```"), ["manifest.json"], "no space before path=");
assertEq(onlyPath("``` path=manifest.json\n{}\n```"), ["manifest.json"], "no language");
assertEq(
  onlyPath('```json path="manifest.json"\n{}\n```'),
  ["manifest.json"],
  "a quoted path is unquoted, not carried into the file name",
);
assertEq(
  onlyPath("```json path=manifest.json showLineNumbers\n{}\n```"),
  ["manifest.json"],
  "trailing attributes are ignored",
);

// Four backticks are how a model fences a file that itself contains a fence —
// so the inner three must not be mistaken for the end of the block.
const fourTicks = ["````md path=README.md", "```js", "const x = 1;", "```", "````"].join("\n");
assertEq(onlyPath(fourTicks), ["README.md"], "four backticks open a block");
assertEq(
  parseGeneratedFiles(fourTicks).files[0].contents,
  "```js\nconst x = 1;\n```",
  "an inner fence survives inside a four-backtick block",
);

// An indented block indents its contents too; writing that through verbatim
// would put the indentation in front of every line of the file.
const indented = ["  ```json path=manifest.json", '  { "id": "x" }', "  ```"].join("\n");
assertEq(onlyPath(indented), ["manifest.json"], "an indented fence is still a file");
assertEq(
  parseGeneratedFiles(indented).files[0].contents,
  '{ "id": "x" }',
  "the fence's own indentation is removed from the body",
);

assertEq(
  onlyPath("```json path=./manifest.json\n{}\n```"),
  ["manifest.json"],
  "a leading ./ is dropped, or the manifest check looks for the wrong name",
);
// Traversal is not a spelling variant — it must survive to be refused later.
assertEq(
  onlyPath("```json path=../evil.json\n{}\n```"),
  ["../evil.json"],
  "../ is left intact for safe_join to refuse",
);

// Tolerance must not go so far that an illustrative block becomes a file.
assertEq(onlyPath("```json title=manifest.json\n{}\n```"), [], "title= is not path=");
assertEq(onlyPath("```json\n{}\n```"), [], "a fence without path= stays an example");

// --- consent preview -------------------------------------------------------
//
// Shown before the package exists, so it is derived from the files rather than
// from a scan row. It may be lenient about malformed input, but it may never
// understate what a grant would allow.

const netFiles = [
  file("manifest.json", '{"id":"pr","permissions":["network.declared"]}'),
  file(
    "api.json",
    JSON.stringify({
      schemaVersion: 1,
      endpoints: [
        {
          id: "pulls",
          description: "Reads the open pull requests.",
          method: "GET",
          url: "https://api.github.com/repos/{owner}/{repo}/pulls",
          credential: "githubPat",
        },
      ],
    }),
  ),
];
const netLines = consentPreviewFor(netFiles);
assert(netLines.length === 2, "one line per permission plus one per endpoint");
assert(netLines[1].includes("api.github.com"), "the host is read out of the url");
assert(
  !netLines[1].includes("{owner}"),
  "a placeholder is part of the path, not the host, and must not leak into the line",
);
assert(netLines[1].includes("githubPat"), "the credential is named");

// A fallback url is another reachable host, so it belongs in the same line.
assertEq(
  consentPreviewFor([
    file("manifest.json", '{"permissions":[]}'),
    file(
      "api.json",
      JSON.stringify({
        endpoints: [
          {
            description: "Quote.",
            method: "GET",
            url: "https://one.example/a",
            fallbackUrls: ["https://two.example/a", "https://one.example/b"],
          },
        ],
      }),
    ),
  ]),
  ["Quote. (GET one.example, two.example)"],
  "every distinct fallback host is listed, without repeats",
);

// Malformed input must degrade, never throw and never hide an endpoint.
assertEq(consentPreviewFor([]), [], "no files, nothing claimed");
assertEq(
  consentPreviewFor([file("manifest.json", "{ broken")]),
  [],
  "a manifest that does not parse yields no claims",
);
const noDescription = consentPreviewFor([
  file("manifest.json", '{"permissions":[]}'),
  file("api.json", '{"endpoints":[{"method":"GET","url":"https://x.example/a"}]}'),
]);
assert(
  noDescription.length === 1 && noDescription[0].includes("x.example"),
  "an endpoint without a description is still shown — silence would understate the grant",
);
const badUrl = consentPreviewFor([
  file("manifest.json", '{"permissions":[]}'),
  file("api.json", '{"endpoints":[{"description":"Odd.","method":"GET","url":"not a url"}]}'),
]);
assert(badUrl.length === 1, "an unreadable url drops the host, not the endpoint");

// --- reply problems --------------------------------------------------------

const nothing = { prose: "", files: [], removed: [], unterminated: null };

assertEq(
  replyProblem(nothing, [], "counter"),
  'The answer contained no files. Reply "Emit the files now." to ask for them.',
  "an answer with no blocks says what to do next",
);
// Even against a perfectly good package: the merged set is fine, the *answer*
// did nothing, and that is still the "wrote its explanation and stopped" case.
assertEq(
  replyProblem(nothing, parseGeneratedFiles(reply).files, "counter"),
  'The answer contained no files. Reply "Emit the files now." to ask for them.',
  "an empty answer is a problem even when the package it applies to is valid",
);
assert(
  replyProblem({ ...nothing, unterminated: "app.js" }, [], "counter")?.includes("app.js"),
  "an unterminated block is named, not reported as an empty answer",
);
assertEq(
  replyProblem(parseGeneratedFiles(reply), parseGeneratedFiles(reply).files, "counter"),
  null,
  "a complete reply with a matching manifest has no problem",
);
// The case the partial form exists for: one file, no manifest in the answer.
// Checking the reply alone would reject exactly what it is meant to allow.
{
  const partial = parseGeneratedFiles("```js path=ui/app.js\nconst x = 2;\n```");
  const merged = mergeGeneratedFiles(parseGeneratedFiles(reply).files, partial);
  assertEq(
    replyProblem(partial, merged, "counter"),
    null,
    "a partial answer is judged on the package it produces, not on itself",
  );
}

// --- file set checks -------------------------------------------------------

function file(path: string, contents: string): GeneratedFile {
  return { path, contents };
}

assert(fileSetProblem([], "counter") !== null, "no files is a problem");

// --- ctx inside render -----------------------------------------------------

/**
 * `render(model, root)` has no `ctx`. Reaching for one throws inside a handler,
 * where nothing surfaces it: the widget paints and the button is simply dead.
 *
 * This is checked rather than documented because documenting it was tried. A
 * model writing a *new* handler follows the rule; the same model editing a
 * widget carries the old broken line over without reading it, and prose has no
 * purchase on a line nobody rewrote.
 */
const contractManifest = file("manifest.json", '{ "name": "counter", "widget": {} }');

const brokenWidget = `kavibayWidget.define({
  async setup(ctx) { return { rows: await ctx.providers["p"].query("q", {}) }; },
  render(model, root) {
    root.addEventListener("click", async () => {
      const tracks = await ctx.providers["p"].query("items", {});
    });
  },
});`;
assert(renderReachesForCtx(brokenWidget), "ctx used inside render is found");
assert(
  fileSetProblem(
    [contractManifest, file("widget.js", brokenWidget)],
    "counter",
    "contract-package",
  )?.includes("`ctx`"),
  "a contract package whose render reaches for ctx is refused before it is written",
);

/** The repair the message asks for must pass. Otherwise the round never ends. */
const fixedWidget = `kavibayWidget.define({
  async setup(ctx) {
    const p = ctx.providers["p"];
    return { load: (id) => p.query("items", { id }) };
  },
  render(model, root) {
    root.addEventListener("click", () => model.load("1").then(fill).catch(show));
  },
});`;
assert(!renderReachesForCtx(fixedWidget), "going through the model is not flagged");
assertEq(
  fileSetProblem([contractManifest, file("widget.js", fixedWidget)], "counter", "contract-package"),
  null,
  "the shape the refusal asks for is accepted",
);

// `ctx` in setup is the whole point of setup, and setup is where it belongs.
assert(
  !renderReachesForCtx(`kavibayWidget.define({
  async setup(ctx) { return { a: await ctx.data.get("a") }; },
  render(model, root) { root.textContent = model.a; },
});`),
  "ctx in setup is not the mistake",
);

/**
 * The three ways a correct widget says "ctx" without making this mistake. Each
 * one refused would cost a repair round on a package that already worked, which
 * is worse than the bug: the person watches a good answer be rejected.
 */
assert(
  !renderReachesForCtx(`kavibayWidget.define({
  render(model, root) {
    // ctx.providers is not available here — see model.load instead.
    root.textContent = "ok";
  },
});`),
  "a comment naming ctx is not a call",
);
assert(
  !renderReachesForCtx(`kavibayWidget.define({
  render(model, root) { root.textContent = "use ctx.data in setup"; },
});`),
  "ctx inside a string is not a call",
);
assert(
  !renderReachesForCtx(`kavibayWidget.define({
  render(model, root) {
    const canvas = root.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    ctx.fillRect(0, 0, 10, 10);
  },
});`),
  "a 2d drawing context named ctx is somebody's own variable, not the host's",
);

// A template literal is code, not text: `${ctx.x}` must still be seen.
assert(
  renderReachesForCtx(`kavibayWidget.define({
  render(model, root) { root.textContent = \`${"$"}{ctx.config.city}\`; },
});`),
  "ctx inside a template placeholder is still a call",
);

// A runtime package has neither shape; scanning it could only refuse good work.
assertEq(
  fileSetProblem(
    [file("manifest.json", '{ "id": "counter" }'), file("widget.js", brokenWidget)],
    "counter",
  ),
  null,
  "the scan is contract-format only",
);

assert(
  fileSetProblem([file("ui/index.html", "x")], "counter")?.includes("manifest.json"),
  "missing manifest is named",
);
assert(
  fileSetProblem([file("manifest.json", "{ oops")], "counter")?.includes("valid JSON"),
  "broken manifest json is named",
);
assert(
  fileSetProblem([file("manifest.json", '{ "id": "other" }')], "counter")?.includes("other"),
  "a manifest for a different widget is refused",
);

/**
 * The two formats identify a package with differently named fields: a runtime
 * package has `id`, a contract package has `name`.
 *
 * Checking the wrong one refuses a correct package before a byte is written,
 * and reports that the manifest says `undefined` — which reads like the model
 * failed. That is what the contract format hit on its first real run.
 */
assertEq(
  fileSetProblem(
    [file("manifest.json", '{ "name": "counter", "widget": {} }')],
    "counter",
    "contract-package",
  ),
  null,
  "a contract manifest identifies itself with name",
);
assert(
  fileSetProblem(
    [file("manifest.json", '{ "id": "counter" }')],
    "counter",
    "contract-package",
  )?.includes("name"),
  "and a contract manifest using the other format's field is refused, by name",
);
assert(
  fileSetProblem(
    [file("manifest.json", '{ "name": "counter" }')],
    "counter",
    "runtime-package",
  )?.includes("id"),
  "the check does not run backwards either",
);
assertEq(
  fileSetProblem([file("manifest.json", '{ "id": "counter" }')], "counter"),
  null,
  "a matching manifest passes",
);

// --- turn construction -----------------------------------------------------

const turn = turnForPackage("Build me a water tracker", "water-tracker");
assert(turn.startsWith("Build me a water tracker"), "the person's words come first");
assert(turn.includes("Package id to use: water-tracker"), "the host assigns the id");

// --- editing an existing widget ---

const existing: GeneratedFile[] = [
  // Multi-line contents on purpose: the round trip has to survive real files,
  // not one-liners.
  file("manifest.json", '{\n  "id": "counter"\n}'),
  file("ui/index.html", "<!doctype html>\n<p>0</p>"),
  file("ui/app.js", "const n = 0;"),
];

// The round trip is the whole point: what we render for the model must parse
// back identically, or an edit turn would silently corrupt the widget it is
// meant to change.
assertEq(
  parseGeneratedFiles(renderFilesForPrompt(existing)).files,
  existing,
  "render then parse is lossless",
);

const editTurn = turnForPackage("make it red", "counter", { currentFiles: existing });
assert(editTurn.startsWith("make it red"), "the person's words still come first");
assert(editTurn.includes("Package id to use: counter"), "the id is still assigned");
assert(editTurn.includes("path=ui/app.js"), "current files ride along");
// The rule inverted with the partial form: an omitted file used to be a
// deleted one, and is now a kept one. Both halves have to be said, because a
// model carrying the old habit would repeat the whole package for nothing, and
// one carrying only half of the new one would drop a file by leaving it out.
assert(
  /only the files you change/i.test(editTurn),
  "a follow-up turn asks for the change, not the package",
);
assert(
  /kept exactly as it is/i.test(editTurn),
  "and says what happens to the rest, or omitting a file reads as deleting it",
);
assert(/deleted=true/.test(editTurn), "with the one way to actually remove one");
// Not on the first turn: there is no package to be partial against, and a model
// told it may omit files before one exists omits them.
assert(
  !/only the files you change/i.test(turnForPackage("build a clock", "clock")),
  "the first turn is not offered the partial form",
);
assertEq(
  turnForPackage("new one", "counter", { currentFiles: [] }),
  turnForPackage("new one", "counter"),
  "an empty file set is the same as none",
);

// --- the package is not sent twice per round --------------------------------
// The model returns the complete set every turn, so its own last answer already
// holds the files verbatim. Repeating them in the next question doubled the
// package in every round — and, since the whole history is replayed on every
// request, kept paying for the duplicate on every later round too.
{
  const files = [file("manifest.json", "{}"), file("ui/app.js", "let x = 1;")];

  const known = turnForPackage("make it red", "counter", {
    currentFiles: files,
    knownFiles: files,
  });
  assert(!known.includes("path=ui/app.js"), "the model is not handed back its own answer");
  assert(known.startsWith("make it red"), "the question itself is untouched");
  assert(known.includes("Package id to use: counter"), "and so is the id");

  // Anything the model could not know about has to ride along: a hand edit, a
  // restored version, a save that rewrote ui.defaultSize.
  const edited = [file("manifest.json", "{}"), file("ui/app.js", "let x = 2;")];
  assert(
    turnForPackage("now what", "counter", { currentFiles: edited, knownFiles: files }).includes(
      "path=ui/app.js",
    ),
    "an edited file set is sent, which is what the duplication was protecting",
  );

  // Absent means send them. A conversation stored before this existed, or a
  // freshly opened widget, has no record of what the model has seen — and an
  // extra copy costs tokens while a missing one costs a widget.
  assert(
    turnForPackage("go", "counter", { currentFiles: files }).includes("path=ui/app.js"),
    "with nothing known, the files are sent",
  );

  // Order does not make it a different package: the model returns the whole set
  // each turn and is free to reorder it.
  assert(
    !turnForPackage("go", "counter", {
      currentFiles: [files[1], files[0]],
      knownFiles: files,
    }).includes("path=ui/app.js"),
    "the same files in another order still count as known",
  );
}

// --- the sample in the turn --------------------------------------------------
{
  const sample = { endpointId: "search", status: 200, body: '{"data":[{"uid":6189}]}' };

  const withSample = turnForPackage("show the station", "aqi", { samples: [sample] });
  assert(withSample.includes('"uid"'), "the real response travels with the message");
  assert(withSample.includes("search"), "named, so the model knows which endpoint answered");
  assert(
    /do not guess/i.test(withSample),
    "and is stated as ground truth — a model handed a sample still invents fields otherwise",
  );

  // Once, like the files. A sample resent every turn is the same tokens billed
  // again for a fact the model already has.
  assertEq(
    turnForPackage("again", "aqi", { samples: [{ ...sample, sent: true }] }),
    turnForPackage("again", "aqi", { samples: [] }),
    "an already-sent sample is not sent again",
  );

  // Both at once: the response is the ground truth, the files are the thing
  // being fixed, so the response comes first.
  const both = turnForPackage("fix it", "aqi", {
    currentFiles: [file("manifest.json", "{}")],
    samples: [sample],
  });
  assert(
    both.indexOf('"uid"') < both.indexOf("manifest.json"),
    "the response is read before the code it is about",
  );
}

// --- error messages --------------------------------------------------------

assert(
  describeWizardError("not_configured").includes("Settings"),
  "a missing key points at where to fix it",
);
assert(
  describeWizardError("provider_error:400:bad model").includes("bad model"),
  "the provider's own detail survives",
);
assert(
  describeWizardError("provider_error:500").includes("error"),
  "a detail-free provider error still reads as a sentence",
);
assert(describeWizardError("weird_code").includes("weird_code"), "unknown codes are shown");
assert(
  describeDraftError("id_already_installed").includes("already exists"),
  "a name clash is explained",
);
assert(
  describeDraftError("unsafe_path:../x").includes("outside"),
  "an escape attempt is explained without the raw path",
);
assert(describeDraftError("odd").includes("odd"), "unknown draft codes are shown");

// Export codes are not validation codes. The check that matters is the one the
// shared fallback got wrong: a failed write must not be reported as a package
// that failed validation.
assert(
  describeExportError("target_folder_missing").includes("Pick another folder"),
  "an unusable destination says what to do about it",
);
assert(
  describeExportError("write_failed:disk full").includes("disk full"),
  "the OS's own reason for a failed write survives",
);
assert(
  !describeExportError("write_failed:disk full").includes("validation"),
  "a write failure is not reported as a validation failure",
);
assert(
  describeExportError("Error: package_empty").includes("no files"),
  "a code that arrived as a thrown Error is still recognised",
);
assert(describeExportError("odd").includes("odd"), "unknown export codes are shown");

// api.json codes arrive prefixed (`api:{code}` from the Rust side). The raw code
// told the person nothing they could act on — kebab-case in an endpoint id is
// the single most likely way a generated package fails.
assert(
  describeDraftError("api:invalid_endpoint_id").includes("no dashes"),
  "the endpoint id rule is spelled out, not left as a code",
);
assert(
  !describeDraftError("api:invalid_endpoint_id").includes("api:"),
  "a code that was translated does not also leak the code",
);
assert(
  describeDraftError("api:header_not_allowed:Authorization").includes("credential"),
  "the Authorization header points at the mechanism that replaces it",
);
assert(
  describeDraftError("api:header_not_allowed:X-Weird").includes("X-Weird"),
  "any other refused header is named",
);
assert(
  describeDraftError("api:unknown_credential_type:githubPatt").includes("githubPatt"),
  "a mistyped credential type is quoted back",
);
assert(
  describeDraftError("api:undeclared_placeholder:owner").includes("owner"),
  "an undeclared placeholder is named",
);
// An api code with no sentence of its own must still survive intact.
assert(
  describeDraftError("api:too_many_endpoints").includes("api:too_many_endpoints"),
  "untranslated api codes keep their code so they can be searched for",
);
assert(
  describeDraftError("package_not_found").includes("not there"),
  "deleting something already gone reads as a fact, not an error",
);

// --- the session survives an unmount ---------------------------------------

// Widgets are unmounted whenever Kavibay is hidden, so this is what stands
// between a Ctrl+Space and a lost conversation.
{
  const fresh = emptyWizardSession();
  assertEq(parseWizardSession(null), fresh, "nothing stored starts fresh");
  assertEq(parseWizardSession("not json"), fresh, "garbage starts fresh");
  assertEq(parseWizardSession("null"), fresh, "a stored null starts fresh");

  const live = {
    ...fresh,
    model: "gpt-4o",
    draft: "half a sentence",
    packageId: "counter",
    bubbles: [{ role: "user" as const, text: "hi" }],
    turns: [{ role: "user" as const, content: "hi" }],
  };
  assertEq(
    parseWizardSession(JSON.stringify(live)),
    live,
    "a real session round-trips",
  );
  const oldSession = parseWizardSession(
    JSON.stringify({ ...fresh, packageId: "counter", draftFiles: [file("manifest.json", "{}")] }),
  );
  assertEq(
    oldSession.draftRevision,
    undefined,
    "sessions from before revisions still parse and can reconcile on open",
  );

  // A corrupted payload must not throw on first render.
  const broken = parseWizardSession('{"bubbles":"nope","turns":5,"model":7}');
  assertEq(broken.bubbles, [], "a non-array transcript becomes empty");
  assertEq(broken.turns, [], "non-array turns become empty");
  assertEq(broken.model, "", "a non-string model falls back to the default");

  assert(
    wizardSessionKey("abc") !== wizardSessionKey("def"),
    "each widget instance has its own conversation",
  );
}

// One long conversation must not fill storage, and what survives must still be
// coherent — a reply with no question is worse than no history. The cap is a
// parameter so this runs against a small one instead of building megabytes.
{
  const long = emptyWizardSession("trim");
  for (let i = 0; i < 40; i += 1) {
    long.turns.push({ role: "user", content: `ask ${i} ${"x".repeat(200)}` });
    long.turns.push({ role: "assistant", content: `answer ${i} ${"y".repeat(200)}` });
    long.bubbles.push({ role: "user", text: `ask ${i}` });
    long.bubbles.push({ role: "assistant", text: `answer ${i}` });
  }

  const cap = 4000;
  const trimmed = trimWizardSession(long, cap);
  assert(JSON.stringify(trimmed).length <= cap, "trimmed within the cap");
  assert(trimmed.turns.length < long.turns.length, "something was dropped");
  assertEq(trimmed.turns[0].role, "user", "history still starts with a question");
  assertEq(
    trimmed.turns[trimmed.turns.length - 1].content,
    long.turns[long.turns.length - 1].content,
    "the newest turn is always kept",
  );
  assertEq(
    trimmed.bubbles.length,
    trimmed.turns.length,
    "the transcript and the history stay aligned",
  );

  // Never trim below one exchange: an empty history would silently restart the
  // conversation rather than shorten it.
  const tiny = trimWizardSession(long, 1);
  assertEq(tiny.turns.length, 2, "one exchange always survives");

  const short = emptyWizardSession("short");
  assertEq(trimWizardSession(short), short, "a small session is untouched");
}

// --- conversation titles and ids -------------------------------------------

{
  const named = { ...emptyWizardSession("c1"), widgetName: "  Water Tracker  " };
  assertEq(conversationTitle(named), "Water Tracker", "the widget name wins");

  const asked = emptyWizardSession("c2");
  asked.bubbles.push({ role: "system", text: "a host note" });
  asked.bubbles.push({ role: "user", text: "a tracker for water\nsecond line" });
  assertEq(
    conversationTitle(asked),
    "a tracker for water",
    "the first thing the person said, not a host note",
  );

  const long = emptyWizardSession("c3");
  long.bubbles.push({ role: "user", text: "x".repeat(200) });
  assert(conversationTitle(long).length <= 60, "titles stay short");
  assertEq(conversationTitle(emptyWizardSession("c4")), "New project", "empty falls back");

  // The name the person typed decides the id; before that, their first request
  // is the best guess available. Both go through the same slug rule.
  const unnamed = emptyWizardSession("c5");
  assertEq(packageIdFor(unnamed, "A Water Tracker"), "a-water-tracker", "falls back to the ask");
  assertEq(
    packageIdFor({ ...unnamed, widgetName: "M\u00fcsli Z\u00e4hler" }, "ignored"),
    "muesli-zaehler",
    "the name wins and is still a valid id",
  );
}

// --- one row per widget ----------------------------------------------------

{
  // The ordinary case: a saved widget, a conversation about it, and an MCP
  // client that has just changed its draft. Three sources, one widget, one row.
  const rows = buildProjectRows({
    widgets: [
      { id: "water-tracker", name: "Water Tracker" },
      { id: "clock", name: "Clock" },
    ],
    drafts: [{ id: "water-tracker", error: null, lastWriter: "mcp", updatedAt: 400 }],
    conversations: [
      { id: "c1", title: "Water Tracker", updatedAt: 300, packageId: "water-tracker" },
      { id: "c9", title: "something I never finished", updatedAt: 100 },
    ],
  });

  assertEq(rows.length, 3, "two widgets and one unfinished idea, not five rows");

  const tracker = rows[0];
  assertEq(tracker.key, "water-tracker", "the most recently edited widget is first");
  assertEq(tracker.saved && tracker.draft, true, "saved and changed at the same time");
  assertEq(projectState(tracker), "changed", "which is what Save would replace");
  assertEq(tracker.author, "mcp", "and the byline says who changed it");
  assertEq(tracker.conversationIds, ["c1"], "the conversation travels with the widget");
  assertEq(tracker.title, "Water Tracker", "named by the installed manifest");

  const idea = rows.find((row) => row.key === "conversation:c9")!;
  assertEq(projectState(idea), "idea", "an idea is neither saved nor a draft");
  assertEq(idea.title, "something I never finished", "named by what was said");

  const clock = rows.find((row) => row.key === "clock")!;
  assertEq(projectState(clock), "saved", "nothing to decide about it");
}

{
  // Saving is an edit, and the most recent one there is. The row used to fall
  // out of the top of the list at exactly that moment, because a kept package
  // had no time at all and fell through to alphabetical.
  const now = 1_000_000_000;
  const rows = buildProjectRows({
    widgets: [
      { id: "zebra", name: "Zebra", updatedAt: now },
      { id: "apple", name: "Apple", updatedAt: now - 86_400_000 },
    ],
    drafts: [{ id: "apple", error: null, lastWriter: "mcp", updatedAt: now - 3_600_000 }],
    conversations: [],
  });
  assertEq(
    rows.map((row) => row.key),
    ["zebra", "apple"],
    "just saved outranks a draft written an hour ago",
  );
  assertEq(projectTime(rows[0]), now, "a saved widget's time is its Save");
  assertEq(
    projectTime(rows[1]),
    now - 3_600_000,
    "a widget with both takes the later of Save and draft write",
  );
}

{
  // Opening a row saves its conversation, so a conversation timestamp is a
  // record of clicking rather than of work. A draft sorts by when it was
  // written — otherwise the row jumps to the top of the list the moment it is
  // selected, out from under the pointer that selected it.
  const rows = buildProjectRows({
    widgets: [],
    drafts: [
      { id: "old-draft", error: null, lastWriter: "mcp", updatedAt: 100 },
      { id: "new-draft", error: null, lastWriter: "mcp", updatedAt: 900 },
    ],
    conversations: [
      // Just opened: newest conversation, oldest draft.
      { id: "c1", title: "old", updatedAt: 5_000, packageId: "old-draft" },
      { id: "c2", title: "new", updatedAt: 10, packageId: "new-draft" },
    ],
  });
  assertEq(
    rows.map((row) => row.key),
    ["new-draft", "old-draft"],
    "the draft that changed last is first, whatever was clicked last",
  );
  assertEq(projectTime(rows[0]), 900, "a draft's time is its own write");
}

{
  // Two folders, one display name. They cannot be merged, so the row says which.
  const rows = buildProjectRows({
    widgets: [
      { id: "pr-inbox", name: "PR Inbox" },
      { id: "pr-inbox-2", name: "PR Inbox" },
      { id: "clock", name: "Clock" },
    ],
    drafts: [],
    conversations: [],
  });
  assertEq(
    rows.filter((row) => row.ambiguous).map((row) => row.packageId),
    ["pr-inbox", "pr-inbox-2"],
    "both of the colliding rows name their folder",
  );
  assertEq(rows.find((row) => row.key === "clock")!.ambiguous, false, "the unique one does not");
}

{
  // A draft nobody has opened in the Wizard. This is the case the old sidebar
  // called "external", and the only thing that distinguishes it is that no
  // conversation points at it.
  const [row] = buildProjectRows({
    widgets: [],
    drafts: [{ id: "tadoweather", error: null, lastWriter: "mcp", updatedAt: 900 }],
    conversations: [],
  });
  assertEq(projectState(row), "new", "an unsaved widget that does not exist on the desk yet");
  assertEq(row.conversationIds, [], "with no transcript behind it");
  assertEq(row.title, "tadoweather", "the folder name is the only name there is");
}

{
  // Editing the same widget five times used to leave five identical rows. They
  // are one widget, and the newest transcript is the one the row opens.
  const [row] = buildProjectRows({
    widgets: [{ id: "clock", name: "Clock" }],
    drafts: [],
    conversations: [
      { id: "old", title: "Clock", updatedAt: 100, packageId: "clock" },
      { id: "newest", title: "Clock", updatedAt: 500, packageId: "clock" },
      { id: "middle", title: "Clock", updatedAt: 200, packageId: "clock" },
    ],
  });
  assertEq(
    row.conversationIds,
    ["newest", "middle", "old"],
    "newest first, and none of them lost",
  );
}

{
  // A draft the host has no note for — written before the note existed, or by a
  // write whose sidecar could not be stored. It is still a draft; it just has
  // no byline, and saying "you" for it would be a guess.
  const [row] = buildProjectRows({
    widgets: [],
    drafts: [{ id: "mystery", error: "invalid_package_id", lastWriter: null }],
    conversations: [],
  });
  assertEq(row.author, null, "unattributed stays unattributed");
  assertEq(row.invalid, true, "and a draft that does not validate says so");
  assertEq(describeDraftAuthor(row.author), "somebody", "which reads as somebody, not as you");
}

// A name another client is already using is not a validation failure and not a
// conflict — it is somebody else's work, and the fix is to open it.
assert(
  describeDraftError("draft_exists:clock").includes('Open it from the list'),
  "the message says what to do instead of retrying",
);
assert(
  describeDraftError("Error: draft_exists:clock").includes('"clock"'),
  "a frontend throw carries the same code as a Tauri rejection",
);

// --- the order is the person's, not the activity's -------------------------

{
  const project = (key: string, changedAt: number): ProjectRow => ({
    key,
    packageId: key,
    title: key,
    conversationIds: [],
    saved: false,
    savedAt: null,
    draft: true,
    author: "wizard",
    changedAt,
    invalid: false,
    ambiguous: false,
    talkedAt: 0,
  });

  // Arrived sorted by time; the stored order wins over all of it.
  const byTime = [project("c", 300), project("b", 200), project("a", 100)];
  assertEq(
    orderProjects(byTime, ["a", "b", "c"]).map((row) => row.key),
    ["a", "b", "c"],
    "a project stays where it was put, whatever was written since",
  );

  // A project the order has never seen is new, and new work goes to the top.
  const withNew = [project("fresh", 900), ...byTime];
  assertEq(
    orderProjects(withNew, ["a", "b", "c"]).map((row) => row.key),
    ["fresh", "a", "b", "c"],
    "a project created a second ago is not filed at the bottom of forty rows",
  );

  // Everything the order has not placed keeps the time order it arrived in,
  // above everything it has.
  const twoNew = [project("newer", 900), project("older", 800), ...byTime];
  assertEq(
    orderProjects(twoNew, ["a"]).map((row) => row.key),
    ["newer", "older", "c", "b", "a"],
    "newest first among the ones nobody has placed",
  );
}

{
  // Written back on every rebuild: a project only *displayed* at the top would
  // move again the moment the next one was created.
  const rows = [
    { key: "fresh" } as ProjectRow,
    { key: "a" } as ProjectRow,
  ];
  assertEq(nextProjectOrder(rows, ["a"]), ["fresh", "a"], "the new key is recorded");
  assertEq(nextProjectOrder(rows, ["fresh", "a"]), null, "and an unchanged order writes nothing");
  assertEq(
    nextProjectOrder([{ key: "a" } as ProjectRow], ["a", "deleted"]),
    ["a"],
    "a deleted project does not keep a hole in the list",
  );
}

{
  const order = ["a", "b", "c"];
  assertEq(moveProject(order, "c", -1), ["a", "c", "b"], "one place up");
  assertEq(moveProject(order, "a", -1), order, "the top does not wrap to the bottom");
  assertEq(moveProject(order, "c", 1), order, "and neither does the bottom");
  assertEq(moveProject(order, "a", 5), ["b", "c", "a"], "a long move clamps to the end");
  assertEq(moveProject(order, "gone", -1), order, "a key that is not there moves nothing");

  assertEq(dropProject(order, "a", "c"), ["b", "c", "a"], "dropped where the target sits");
  assertEq(dropProject(order, "c", "a"), ["c", "a", "b"], "in either direction");
  assertEq(dropProject(order, "a", "a"), order, "dropping on itself is not a move");
}

{
  // Inside a project every conversation carries the same title. What tells them
  // apart is what was asked.
  const header = { id: "c1", title: "Raumklima", updatedAt: 5, preview: "mach es grün" };
  assertEq(conversationLabel(header), "mach es grün", "the request, not the widget's name");
  assertEq(
    conversationLabel({ ...header, preview: "   " }),
    "No request yet",
    "whitespace is not a request",
  );
  assertEq(
    conversationLabel({ ...header, preview: null }),
    "No request yet",
    "an empty transcript says so instead of repeating the widget's name",
  );
}

{
  // Opening a project records a checkpoint and a system note. That is not
  // content, and treating it as content is what left eight identical rows
  // behind a project somebody had opened eight times.
  const opened = {
    bubbles: [{ role: "system" as const, text: 'Editing "clock".' }],
    draft: "",
    versions: [{ id: "v1", label: "Opened", at: 1, files: [] }],
  };
  assertEq(conversationIsWorthKeeping(opened), false, "an opened-and-left project is not a file");
  assertEq(
    conversationIsWorthKeeping({
      ...opened,
      bubbles: [...opened.bubbles, { role: "user" as const, text: "make it green" }],
    }),
    true,
    "a request is",
  );
  assertEq(
    conversationIsWorthKeeping({ ...opened, draft: "  half a sentence" }),
    true,
    "and so is one that was typed but not sent",
  );
  assertEq(
    conversationIsWorthKeeping({
      ...opened,
      versions: [...opened.versions, { id: "v2", label: "Edited widget.js", at: 2, files: [] }],
    }),
    true,
    "a hand edit produced a version to go back to, which is worth keeping",
  );
}

{
  // A note reports; a decision has to be answered. Only the first is furniture.
  const note = { role: "system" as const, text: "Updated via MCP" };
  assertEq(isPlainNote(note), true, "a report of what happened is a note");
  assertEq(
    isPlainNote({ ...note, run: { id: "clock" } }),
    true,
    "one optional button does not make a report into a dialog",
  );
  assertEq(
    isPlainNote({ ...note, repair: { problems: ["boom"] } }),
    true,
    "and neither does an offer to fix a fault",
  );
  assertEq(
    isPlainNote({ ...note, enable: { id: "clock", lines: [] } }),
    false,
    "and neither is a consent screen, however it is worded",
  );
  assertEq(
    isPlainNote({ ...note, approve: { id: "clock" } }),
    false,
    "a provider grant is a question, and questions get a message's width",
  );
  assertEq(
    isPlainNote({ role: "assistant", text: "here you go" }),
    false,
    "and an answer is a turn, not a note about one",
  );
}

{
  // Skipping the click grants what was asked for, not more.
  const request = {
    choices: [
      { provider: "kavibay.github/github", providerName: "GitHub", summary: "", granted: false },
      { provider: "kavibay.tado/tado", providerName: "tado°", summary: "", granted: true },
    ],
    refused: ["kavibay.spotify/spotify"],
  };
  assertEq(
    autoApprovedGrant(request).providers,
    ["kavibay.github/github", "kavibay.tado/tado"],
    "every provider the package declared and this machine has",
  );
  assertEq(
    autoApprovedGrant({ choices: [], refused: ["kavibay.tado/tado"] }).providers,
    [],
    "and nothing for one it named but this machine does not have",
  );
}

{
  // Skipping the click must reach the same result as answering the dialog.
  const ask = (choices: string[], refused: string[] = []) => ({
    choices: choices.map((provider) => ({ provider, providerName: provider, summary: "", granted: false })),
    refused,
  });

  assertEq(canAutoApprove(ask(["gh"])), true, "everything asked for is available");
  assertEq(
    canAutoApprove(ask(["gh"], ["spotify"])),
    false,
    "a provider this machine does not have cannot be granted, so it is not skipped past",
  );
  assertEq(
    canAutoApprove(ask([], ["gh"])),
    false,
    "and neither is a request where nothing at all resolved",
  );
  assertEq(canAutoApprove(ask([])), false, "nothing to grant is not an approval");
  assertEq(wizardAskedNothingNew(ask([]), null), true, "nothing asked on a first save is no question either");
  assertEq(wizardAskedNothingNew(ask([], ["gh"]), null), false, "a missing provider still asks");
}

{
  const request = {
    choices: [
      { provider: "gh", providerName: "GitHub", summary: "", granted: false },
      { provider: "tado", providerName: "tado°", summary: "", granted: true },
    ],
    refused: ["kavibay.spotify/spotify"],
  };
  assertEq(
    unmetProviders(request, ["tado"]),
    ["GitHub", "kavibay.spotify/spotify"],
    "not granted and not installed are both things the widget cannot read",
  );
  assertEq(
    unmetProviders({ choices: request.choices, refused: [] }, ["gh", "tado"]),
    [],
    "and a fully granted widget has nothing outstanding",
  );
}

{
  // Changes are asked per account, only for actions the provider has.
  const spotify = {
    id: "kavibay.spotify/spotify",
    displayName: "Spotify",
    requiresCredential: true,
    queries: [],
    actions: [{ name: "play", effect: "write" as const, description: "Start playing a playlist" }],
  };
  const manifest = {
    widget: {
      requires: {
        providers: [{ id: "kavibay.spotify/spotify", actions: ["play", "rewind"] }],
      },
    },
  };

  const request = buildWizardPermissionRequest(manifest, [spotify]);
  assertEq(
    request.choices[0]?.actions,
    { names: ["play"], summary: "Start playing a playlist", granted: false },
    "a declared action is offered in the provider's words, never pre-ticked",
  );
  assertEq(request.refused, ["kavibay.spotify/spotify.rewind"], "and one the provider lacks is refused");
  assertEq(
    autoApprovedGrant(request),
    { providers: ["kavibay.spotify/spotify"], actions: { "kavibay.spotify/spotify": ["play"] } },
    "skipping the click grants the changes it asked for, and no others",
  );

  const reading = { providers: ["kavibay.spotify/spotify"], actions: {} };
  assertEq(wizardAskedNothingNew(buildWizardPermissionRequest(manifest, [spotify], reading), reading), false,
    "reading approved earlier does not settle a change");
  const both = { providers: ["kavibay.spotify/spotify"], actions: { "kavibay.spotify/spotify": ["play"] } };
  const carried = buildWizardPermissionRequest(manifest, [spotify], both);
  assertEq(carried.choices[0]?.actions?.granted, true, "an approved change comes back ticked");
  assertEq(wizardAskedNothingNew(carried, both), true, "and asks nothing new");
}

{
  const files = [
    {
      path: "widget.js",
      contents: [
        'const el = document.querySelector("div");',
        'const now = await ctx.providers[W].query("current", { location });',
        "ctx.providers[W].subscribe('forecast', {}, render);",
        "button.onclick = () => ctx.providers[S].action(`play`, { id });",
        "const dynamic = ctx.providers[W].query(name, {});",
      ].join("\n"),
    },
    { path: "ui/index.html", contents: '<script>ctx.providers[S].action("pause", {})</script>' },
    { path: "notes.md", contents: 'ctx.providers[S].action("skip", {})' },
  ];
  assertEq(
    providerCallsIn(files),
    { queries: ["current", "forecast"], actions: ["pause", "play"] },
    "literal names in scripts and inline html count; querySelector, runtime names and prose do not",
  );

  const spotify = {
    id: "kavibay.spotify/spotify",
    displayName: "Spotify",
    requiresCredential: true,
    queries: [],
    actions: [
      { name: "play", description: "Start playing a playlist" },
      { name: "pause" },
      { name: "next" },
    ],
  };
  assertEq(
    actionUses(
      { id: spotify.id, schema: spotify, declaredActions: ["play", "next"], declaredQueries: [] },
      { queries: [], actions: ["play", "pause", "rewind"] },
    ).map((use) => [use.name, use.declared, use.called]),
    [
      ["play", true, true],
      ["next", true, false],
      ["pause", false, true],
    ],
    "declared ones first, then a called one the provider has but the manifest does not declare",
  );
}

{
  const weather = {
    id: "kavibay.weather/weather",
    displayName: "Weather",
    requiresCredential: false,
    queries: [
      { name: "current", description: "Current conditions" },
      { name: "forecast", description: "The next days" },
      { name: "places", description: "Places by name" },
    ],
  };
  const manifest = (queries: string[]) => ({
    widget: { requires: { providers: [{ id: weather.id, queries }] } },
  });
  assertEq(
    providersUsedBy(
      [{ path: "manifest.json", contents: JSON.stringify({ widget: { requires: { providers: [weather.id] } } }) }],
      [weather],
    ).map((use) => [use.id, use.declaredQueries]),
    [[weather.id, []]],
    "a bare id still names the provider, and states nothing about what it reads",
  );
  assertEq(
    buildWizardPermissionRequest(manifest(["current", "nope"]), [weather]).choices[0]?.summary,
    "Current conditions",
    "the dialog describes the declared queries the provider has",
  );
  assertEq(
    buildWizardPermissionRequest(manifest([]), [weather]).choices[0]?.summary,
    "Current conditions; The next days, and 1 more",
    "and the account, the way the host dialog does, without a declaration",
  );

  const [use] = providersUsedBy(
    [{ path: "manifest.json", contents: JSON.stringify(manifest(["current", "places", "nope"])) }],
    [weather],
  );
  assertEq(
    queryUses(use!, { queries: ["current", "forecast"], actions: [] }).map((query) => [
      query.name,
      query.declared,
      query.called,
      query.known,
    ]),
    [
      ["current", true, true, true],
      ["forecast", false, true, true],
      ["places", true, false, true],
      ["nope", true, false, false],
    ],
    "every offered query with its marks, then a declared name the provider does not have",
  );
}

assertEq(describeDraftAuthor("mcp"), "an MCP client", "the other client is named");
assertEq(
  describeDraftClient("mcp", "codex-cli"),
  "Codex (clientInfo: codex-cli)",
  "an exact persisted Codex name recovers the branded hover label",
);
assertEq(
  describeDraftClient("codex", "codex-cli"),
  "Codex (clientInfo: codex-cli)",
  "a known client keeps its brand and exact handshake name",
);
assertEq(draftClientFromName("codex-mcp-client"), "codex", "Codex MCP client is branded");
assertEq(
  draftAuthorWithClientName("mcp", "codex-mcp-client"),
  "codex",
  "old MCP bubbles can recover the Codex mark from their stored name",
);

{
  const active: WizardDraftPresence = {
    id: "clock",
    client: "codex",
    clientName: "codex-mcp-client",
    tool: "write_draft",
    active: true,
    lastSeen: 1_000,
    expiresAt: 61_000,
  };
  let rows = applyDraftPresence([], active);
  assertEq(
    describeDraftPresence(active),
    "Codex is working on this widget right now",
    "a running tool call is stated exactly",
  );
  assertEq(presenceForWidget(rows, "clock", 2_000), active, "active presence is selected");

  const finished = { ...active, active: false, lastSeen: 2_000, expiresAt: 62_000 };
  rows = applyDraftPresence(rows, finished);
  assertEq(rows.length, 1, "one client's finish replaces its active entry");
  assertEq(
    describeDraftPresence(finished),
    "Codex was active on this widget just now",
    "between calls the copy is explicitly recent rather than exact",
  );
  assertEq(presenceForWidget(rows, "clock", 62_000), null, "recent presence expires");
}
assertEq(describeDraftAuthor("wizard"), "you", "and this one is not a third party");
assertEq(draftAuthorOf("mcp", "codex"), "codex", "Codex handshake identity is retained");
assertEq(draftAuthorOf("mcp", "claude"), "claude", "Claude handshake identity is retained");
assertEq(describeDraftUpdate("codex"), "Updated via Codex", "Codex checkpoint label");
assertEq(describeDraftUpdate("claude"), "Updated via Claude Code", "Claude checkpoint label");

{
  const now = 1_000_000_000;
  assertEq(describeAge(now - 5_000, now), "just now", "seconds are not a number worth printing");
  assertEq(describeAge(now - 130_000, now), "2 min ago", "rounded down, never up");
  assertEq(describeAge(now - 3 * 3_600_000, now), "3 h ago", "hours inside a day");
  assertEq(describeAge(now - 26 * 3_600_000, now), "yesterday", "and a word once it is one");
  assertEq(describeAge(null, now), "", "a draft with no note claims no time");

  const row = {
    key: "clock",
    packageId: "clock",
    title: "Clock",
    conversationIds: [],
    saved: true,
    savedAt: null,
    draft: true,
    author: "mcp" as const,
    changedAt: now - 120_000,
    invalid: false,
    ambiguous: false,
    talkedAt: now - 120_000,
  };
  // One bit, and it is the one a list is read for: can the palette run this.
  assertEq(projectIsLive(row), true, "a saved widget is in the palette, draft or no draft");
  assertEq(projectIsLive({ ...row, saved: false }), false, "a draft is not");
  assert(
    describeProjectStatus(row, now).startsWith("Saved — you can add it"),
    "and the detail moves to the tooltip rather than being deleted",
  );
  assert(
    describeProjectStatus({ ...row, saved: false }, now).startsWith("Draft — not in the palette"),
    "which says the same thing the dot does, in words",
  );

  assertEq(
    describeProjectChange(row, now),
    "Unsaved changes · MCP · 2 min ago",
    "a saved widget with a draft has changes to something that exists",
  );
  assertEq(
    describeProjectChange({ ...row, author: null }, now),
    "Unsaved changes · 2 min ago",
    "an unattributed change says nothing about who, rather than 'unknown'",
  );
  assertEq(
    describeProjectChange({ ...row, saved: false }, now),
    "Draft · MCP · 2 min ago",
    "one that was never kept is only a draft",
  );
  assertEq(
    describeProjectChange({ ...row, draft: false, savedAt: now - 3_600_000 }, now),
    "Saved · 1 h ago",
    "a kept widget says when it was kept",
  );
  assertEq(
    describeProjectChange(
      { ...row, draft: false, saved: false, talkedAt: now - 120_000 },
      now,
    ),
    "Conversation · 2 min ago",
    "and a conversation says it is one, rather than drawing as a bare name",
  );
}

// Opening says which of the three situations the person is looking at.
assertEq(
  describeDraftOpen("clock", false, null),
  'Editing "clock". Describe what you want changed.',
  "a checkout shows the widget on the desk",
);
assertEq(
  describeDraftOpen("clock", true, "wizard"),
  'Continuing your unsaved changes to "clock".',
  "your own draft is where you left off",
);
assert(
  describeDraftOpen("clock", true, "mcp").includes("from an MCP client"),
  "somebody else's draft names them",
);
assert(
  describeDraftOpen("clock", true, "mcp").includes("saved widget is unchanged"),
  "and says the widget on the desk has not moved",
);

// --- the model names the widget --------------------------------------------

{
  const runtime = (id: string, name?: string) => [
    {
      path: "manifest.json",
      contents: JSON.stringify({ id, ...(name ? { name } : {}) }),
    },
  ];

  assertEq(
    declaredPackageId(runtime("water-tracker"), "runtime-package"),
    "water-tracker",
    "a runtime package names itself in `id`",
  );
  assertEq(
    declaredPackageId(
      [{ path: "manifest.json", contents: JSON.stringify({ name: "room-climate", widget: {} }) }],
      "contract-package",
    ),
    "room-climate",
    "a contract package names itself in `name`",
  );
  assertEq(
    declaredPackageId(runtime("Water Tracker!"), "runtime-package"),
    null,
    "a name a folder cannot carry is not an id",
  );
  assertEq(
    declaredPackageId([{ path: "manifest.json", contents: "{" }], "runtime-package"),
    null,
    "and neither is a manifest that does not parse",
  );

  assertEq(isValidPackageId("water-tracker"), true, "the folder rule, as Rust states it");
  assertEq(isValidPackageId("-leading-dash"), false, "must start with a letter or digit");
  assertEq(isValidPackageId("has space"), false, "no spaces");
  assertEq(isValidPackageId("x".repeat(65)), false, "and a length a file name can hold");

  assertEq(
    declaredDisplayName(runtime("water-tracker", "Water Tracker")),
    "Water Tracker",
    "the human name, for the field the person left empty",
  );
  assertEq(declaredDisplayName(runtime("water-tracker")), null, "absent when it named none");
}

{
  // A name the model chose can already be taken here. That is not a problem
  // with its answer, so it is not sent back as one.
  assertEq(freePackageId("water-tracker", []), "water-tracker", "a free name is kept");
  assertEq(
    freePackageId("water-tracker", ["water-tracker"]),
    "water-tracker-2",
    "the one already there is the first, so the next is 2",
  );
  assertEq(
    freePackageId("water-tracker", ["water-tracker", "water-tracker-2", "water-tracker-3"]),
    "water-tracker-4",
    "and it counts past every taken one",
  );

  // Drafts and saved widgets are one namespace: promoting onto a saved id is
  // refused, so a name that is only free among drafts is not free.
  assertEq(
    freePackageId("clock", ["clock"]),
    "clock-2",
    "a saved widget's name is taken too",
  );

  // Appended to the whole id, never counting up through a number inside it.
  assertEq(
    freePackageId("gpt-5", ["gpt-5"]),
    "gpt-5-2",
    "a number that is part of the name is not incremented into another name",
  );

  const long = "w".repeat(64);
  const suffixed = freePackageId(long, [long]);
  assertEq(suffixed.length <= 64, true, "the host's 64-character cap is respected");
  assertEq(suffixed.endsWith("-2"), true, "by giving up the tail, not the number");
}

{
  // On the first turn nothing is named yet, so there is nothing to compare the
  // manifest against — only something to check it *is* a usable name.
  const files = [
    { path: "manifest.json", contents: JSON.stringify({ id: "water-tracker" }) },
    { path: "ui/index.html", contents: "<!doctype html>" },
  ];
  assertEq(fileSetProblem(files, "", "runtime-package"), null, "a name it chose itself is fine");
  assert(
    (fileSetProblem(
      [{ path: "manifest.json", contents: JSON.stringify({ id: "Water Tracker" }) }],
      "",
      "runtime-package",
    ) ?? "").includes("water-tracker"),
    "and one a folder cannot carry is refused with an example",
  );

  // From the second turn on the id is settled and the manifest must agree.
  assertEq(fileSetProblem(files, "water-tracker", "runtime-package"), null, "matching id passes");
  assert(
    (fileSetProblem(files, "something-else", "runtime-package") ?? "").includes("something-else"),
    "a manifest that renamed itself mid-conversation is refused",
  );
}

{
  // The first turn asks; every later turn dictates. Renaming is the person's
  // act, not a side effect of asking for a change.
  const first = turnForPackage("a tracker for how much water I drink today", "");
  assert(first.includes("Name this widget yourself"), "turn one asks the model to name it");
  assert(!first.includes("Package id to use"), "and does not hand it a sentence to use as an id");

  const later = turnForPackage("make it green", "water-tracker");
  assert(later.includes("Package id to use: water-tracker"), "later turns state the settled id");
  assert(!later.includes("Name this widget yourself"), "and do not reopen the question");
}

// --- model selection -------------------------------------------------------

{
  const model = (id: string, configured: boolean): WizardModelOption => ({
    id,
    label: id,
    note: "",
    provider: "anthropic",
    credentialType: "anthropicApiKey",
    configured,
  });

  const mixed = [
    model("opus", false),
    model("sonnet", true),
    model("haiku", false),
    model("gpt", true),
  ];

  assertEq(
    sortWizardModels(mixed).map((entry) => entry.id),
    ["sonnet", "gpt", "opus", "haiku"],
    "usable first, capability order kept inside each group",
  );

  // The whole point: never open on a model that cannot run.
  assertEq(defaultWizardModel(mixed), "sonnet", "the best usable model is chosen");
  assertEq(defaultWizardModel(mixed, "gpt"), "gpt", "a working choice is kept");
  assertEq(
    defaultWizardModel(mixed, "opus"),
    "sonnet",
    "a choice that lost its key falls back to one that works",
  );
  assertEq(
    defaultWizardModel(mixed, "deleted-model"),
    "sonnet",
    "a model that no longer exists falls back",
  );

  // The catalog's own preference beats catalog order, but only where it can
  // run: an unconfigured favourite is not a model, it is a setup screen.
  const withDefault = [
    model("sol", true),
    { ...model("luna", true), authoringDefault: true },
    model("terra", true),
  ];
  assertEq(defaultWizardModel(withDefault), "luna", "the catalog names the model to open on");
  assertEq(
    defaultWizardModel([model("sol", true), { ...model("luna", false), authoringDefault: true }]),
    "sol",
    "a preferred model with no key falls back to one that works",
  );
  assertEq(
    defaultWizardModel(withDefault, "terra"),
    "terra",
    "and it never overrides a choice somebody already made",
  );

  const none = [model("opus", false), model("gpt", false)];
  assertEq(
    defaultWizardModel(none),
    "opus",
    "with nothing configured, the first is named so the hint is about it",
  );
  assertEq(defaultWizardModel([]), "", "no models at all");
}

// --- attachments -----------------------------------------------------------

{
  const png = { type: "image/png", size: 1000 };
  assertEq(attachmentProblem(png, 0), null, "a small png attaches");
  assertEq(attachmentProblem({ type: "image/jpeg", size: 1 }, 5), null, "the sixth still fits");

  // The mirror of the Rust checks: refusing on the drop beats refusing after a
  // generation has been paid for.
  assert(
    attachmentProblem(png, 6)?.includes("6 images"),
    "the seventh image is refused with the limit named",
  );
  assert(
    attachmentProblem({ type: "application/pdf", size: 10 }, 0)?.includes("not an image"),
    "a non-image says so",
  );
  assert(
    attachmentProblem({ type: "", size: 10 }, 0)?.includes("That file"),
    "a file with no type still gets a readable sentence",
  );
  assert(
    attachmentProblem({ type: "image/png", size: 5 * 1024 * 1024 }, 0)?.includes("4 MB"),
    "an oversized image names the limit",
  );

  // The prefix is provider-specific, so it is stripped once rather than in each
  // request builder — and Anthropic rejects the URL form outright.
  assertEq(
    base64FromDataUrl("data:image/png;base64,QUJD"),
    "QUJD",
    "the data: prefix is stripped",
  );
  assertEq(base64FromDataUrl("QUJD"), "QUJD", "already-bare data is left alone");
  assertEq(base64FromDataUrl(""), "", "empty stays empty");
}

// --- generated package lint ------------------------------------------------

// The two ways a widget passes validation, renders correctly, and still does
// nothing. Silence here is the same as telling someone their widget is fine.
{
  const good = [
    file("manifest.json", '{"id":"w","permissions":["storage.instance"]}'),
    file("ui/index.html", '<script src="@kavibay/runtime.js"></script>'),
    file("ui/app.js", "kavibay.storage.set({ a: 1 });"),
  ];
  assertEq(lintGeneratedFiles(good), [], "a correct package says nothing");

  const browserStorage = [
    file("manifest.json", '{"id":"w","permissions":[]}'),
    file("ui/app.js", "localStorage.setItem('a', '1');"),
  ];
  // The failure that shipped: a widget that renders and whose every click
  // throws, because the bridge it calls was never loaded.
  const noBridge = [
    file("manifest.json", '{"id":"w","permissions":["storage.instance"]}'),
    file("ui/index.html", '<script src="app.js"></script>'),
    file("ui/app.js", "await kavibay.storage.get();"),
  ];
  assert(
    lintGeneratedFiles(noBridge)[0].includes("@kavibay/runtime.js"),
    "a missing bridge is named with the fix",
  );

  // The exact shape the model produced: a stub under the SDK's name.
  const ownSdk = [
    file("manifest.json", '{"id":"w","permissions":["storage.instance"]}'),
    file("ui/index.html", '<script src="@kavibay/runtime.js"></script>'),
    file("ui/kavibay-runtime.js", "/* the host supplies window.kavibay */"),
    file("ui/app.js", "kavibay.storage.get();"),
  ];
  assert(
    lintGeneratedFiles(ownSdk).some((note) => note.includes("ships its own")),
    "a package carrying its own SDK is called out",
  );
  assert(
    lintGeneratedFiles(browserStorage)[0].includes("localStorage"),
    "browser storage is named, since it throws in the sandbox",
  );

  const undeclared = [
    file("manifest.json", '{"id":"w","permissions":[]}'),
    file("ui/index.html", '<script src="@kavibay/runtime.js"></script>'),
    file("ui/app.js", "await kavibay.storage.get();"),
  ];
  assert(
    lintGeneratedFiles(undeclared)[0].includes("storage.instance"),
    "saving without the permission is named",
  );

  // A broken manifest is already reported by fileSetProblem; the lint must not
  // throw on it as well.
  const brokenManifest = [
    file("manifest.json", "{ not json"),
    file("ui/index.html", '<script src="@kavibay/runtime.js"></script>'),
    file("ui/app.js", "kavibay.storage.get();"),
  ];
  assert(
    lintGeneratedFiles(brokenManifest).length === 1,
    "an unparsable manifest still yields the storage note, and no crash",
  );

  // Only code files are read: the word in an explanation is not a call.
  const proseOnly = [
    file("manifest.json", '{"id":"w","permissions":[]}'),
    file("README.md", "does not use localStorage"),
  ];
  assertEq(lintGeneratedFiles(proseOnly), [], "prose is not code");
}

// --- what the preview may do -----------------------------------------------

// The preview must match the installed widget in both directions. Too little
// and it looks broken; too much and it hides the missing-permission mistake.
{
  const withStorage = [file("manifest.json", '{"permissions":["storage.instance"]}')];
  assertEq(
    previewPermissionsFor(withStorage),
    ["storage.instance"],
    "a package that asks for storage gets it in the preview",
  );

  const withNetwork = [
    file("manifest.json", '{"permissions":["storage.instance","network.declared"]}'),
  ];
  assertEq(
    previewPermissionsFor(withNetwork),
    ["storage.instance"],
    "the network is never granted to a draft, whatever it asks for",
  );

  const withPop = [
    file("manifest.json", '{"permissions":["background.pop","storage.instance"]}'),
  ];
  assertEq(
    previewPermissionsFor(withPop),
    ["storage.instance", "background.pop"],
    "a draft that pops can be heard in the preview",
  );

  assertEq(
    previewPermissionsFor([file("manifest.json", '{"permissions":[]}')]),
    [],
    "a package that asks for nothing gets nothing, so the mistake stays visible",
  );
  assertEq(previewPermissionsFor([file("manifest.json", "{ broken")]), [], "broken manifest");
  assertEq(previewPermissionsFor([]), [], "no manifest at all");
}

// --- saving the size you dragged to ----------------------------------------

{
  const base = [
    file("manifest.json", '{"id":"w","ui":{"entry":"ui/index.html"}}'),
    file("ui/app.js", "x"),
  ];
  const sized = withDefaultSize(base, { w: 320, h: 240 });
  const manifest = JSON.parse(sized[0].contents) as {
    id: string;
    ui: { entry: string; defaultSize: { w: number; h: number } };
  };
  assertEq(manifest.ui.defaultSize, { w: 320, h: 240 }, "the size is written in");
  assertEq(manifest.ui.entry, "ui/index.html", "the rest of ui survives");
  assertEq(manifest.id, "w", "and so does everything else");
  assertEq(sized[1], base[1], "other files are untouched");

  // Identity when nothing changes, so the caller can skip a needless rewrite.
  const already = [file("manifest.json", '{"ui":{"defaultSize":{"w":320,"h":240}}}')];
  assert(withDefaultSize(already, { w: 320, h: 240 }) === already, "no change, no copy");

  const broken = [file("manifest.json", "{ not json")];
  assert(withDefaultSize(broken, { w: 1, h: 1 }) === broken, "a broken manifest is left alone");
  assertEq(withDefaultSize([], { w: 1, h: 1 }), [], "no manifest at all");
}

// --- renaming a package ----------------------------------------------------

// The manifest is the identity, so this patch *is* the rename: the host moves
// the folder to whatever it names.
{
  const runtime = [
    file("manifest.json", '{"id":"dssd","name":"Innen & Außen"}'),
    file("ui/app.js", "x"),
  ];
  const renamed = withPackageId(runtime, "tadoweather");
  const manifest = JSON.parse(renamed[0].contents) as { id: string; name: string };
  assertEq(manifest.id, "tadoweather", "a runtime package renames its id");
  assertEq(
    manifest.name,
    "Innen & Außen",
    "and never its display name, which is what `name` means in this format",
  );
  assertEq(renamed[1], runtime[1], "other files are untouched");

  const contract = [
    file("manifest.json", '{"name":"dssd","displayName":"Innen & Außen","widget":{"name":"tile"}}'),
  ];
  const movedContract = JSON.parse(withPackageId(contract, "tadoweather")[0].contents) as {
    name: string;
    displayName: string;
  };
  assertEq(movedContract.name, "tadoweather", "a contract package renames its name");
  assertEq(movedContract.displayName, "Innen & Außen", "its display name is a different field");

  const already = [file("manifest.json", '{"id":"w"}')];
  assert(withPackageId(already, "w") === already, "no change, no copy");
  const broken = [file("manifest.json", "{ not json")];
  assert(withPackageId(broken, "x") === broken, "a broken manifest is left alone");
  assertEq(withPackageId([], "x"), [], "no manifest at all");
}

// --- the size a package declares -------------------------------------------

// Read back so reopening a conversation shows the widget at the size it will
// actually open at, instead of the stage's own default.
{
  assertEq(
    manifestSize([file("manifest.json", '{"ui":{"defaultSize":{"w":320,"h":240}}}')]),
    { w: 320, h: 240 },
    "a declared size is read",
  );
  assertEq(manifestSize([file("manifest.json", '{"ui":{}}')]), null, "no size declared");
  assertEq(
    manifestSize([file("manifest.json", '{"ui":{"defaultSize":{"w":"wide"}}}')]),
    null,
    "a size that is not numbers is refused rather than half-applied",
  );
  assertEq(manifestSize([file("manifest.json", "{ broken")]), null, "broken manifest");
  assertEq(manifestSize([]), null, "no manifest");

  // Round trip with the writer, since the two must agree on the shape.
  const written = withDefaultSize(
    [file("manifest.json", '{"id":"w","ui":{"entry":"ui/index.html"}}')],
    { w: 300, h: 220 },
  );
  assertEq(manifestSize(written), { w: 300, h: 220 }, "what we write, we read back");
}

// --- which format a draft is, decided once ---
/**
 * The manifest's `widget` object, and nothing else. The wizard used to answer
 * this inline in `uiEntryOf`, which meant the preview and the enable path could
 * have drifted into two answers — finding 24 is what that costs when it happens
 * across the Rust/TS line, and it is no cheaper inside one file.
 */
{
  const files = (manifest: string) => [{ path: "manifest.json", contents: manifest }];

  assert(
    isContractPackageFiles(files('{"name":"x","widget":{"name":"tile"}}')),
    "a widget block makes it a contract package",
  );
  assert(
    !isContractPackageFiles(files('{"id":"x","ui":{"entry":"ui/index.html"}}')),
    "a runtime package is not one",
  );
  assert(
    !isContractPackageFiles(files("{ not json")),
    "an unreadable manifest is a broken runtime package, not a different format",
  );
  assert(
    !isContractPackageFiles([]),
    "and neither is a file set with no manifest at all",
  );
  assert(
    !isContractPackageFiles(files('{"id":"x","widget":"tile"}')),
    "the discriminator is an object, so a string named widget does not qualify",
  );
}

// --- lint reports each problem once -----------------------------------------
// Two rules were written twice in `lintGeneratedFiles`, so an affected package
// got each complaint twice. Harmless on screen; not harmless once the notes are
// what gets handed back to the model, where a repeated complaint reads as two
// separate problems.
{
  const noBridge = [
    file("manifest.json", '{"id":"w","permissions":["storage.instance"]}'),
    file("ui/index.html", '<script src="app.js"></script>'),
    file("ui/app.js", "await kavibay.storage.get();"),
  ];
  const ownSdk = [
    file("manifest.json", '{"id":"w","permissions":["storage.instance"]}'),
    file("ui/index.html", '<script src="@kavibay/runtime.js"></script>'),
    file("ui/kavibay-runtime.js", "/* the host supplies window.kavibay */"),
    file("ui/app.js", "kavibay.storage.get();"),
  ];
  assertEq(lintGeneratedFiles(noBridge).length, 1, "each problem is reported once");
  assertEq(
    lintGeneratedFiles(ownSdk).filter((note) => note.includes("ships its own")).length,
    1,
    "and the same for the package that carries its own SDK",
  );
}

// --- the automatic repair ---------------------------------------------------
// The wizard already knows, in exact words, what is wrong with a package it
// just received. Printing that to a person so they can paraphrase it back is
// asking them to be a courier between two parties that both have the words.
{
  const one = repairTurnFor(["This widget uses localStorage, which throws in the sandbox."]);
  assert(one.includes("localStorage"), "the problem is quoted verbatim, not summarised");
  assert(one.includes("a problem"), "one problem is singular");
  assert(
    /change\s+only what is needed/i.test(one),
    "the model is told to fix rather than rewrite — a one-line complaint otherwise comes back as a new widget",
  );
  assert(/same format/i.test(one), "and to return the whole package again");

  const many = repairTurnFor(["first problem", "second problem"]);
  assert(many.includes("2 problems"), "several are counted");
  assert(
    many.includes("- first problem") && many.includes("- second problem"),
    "and listed one per line, so none of them reads as a subordinate clause",
  );

  // One retry, not a loop. A second is a different bet: the model has already
  // seen the problem, failed at it, and been told again — and nothing on
  // screen would distinguish that from still thinking.
  assertEq(REPAIR_BUDGET, 1, "exactly one automatic retry");
}

// --- a runtime fault, phrased as something to fix ---------------------------
{
  assertEq(
    faultProblem({ source: "error", message: "rooms.map is not a function", where: "widget.js:42:9" }),
    "The widget threw at widget.js:42:9: rooms.map is not a function",
    "a throw carries the place, which is most of the fix",
  );
  assertEq(
    faultProblem({ source: "error", message: "boom" }),
    "The widget threw: boom",
    "and reads properly when the browser did not say where",
  );
  assert(
    faultProblem({ source: "rejection", message: "401" }).includes("promise"),
    "a rejection is described as one, since the fix is a missing catch",
  );
  assert(
    faultProblem({ source: "console", message: "tado failed" }).includes("logged"),
    "the widget's own logging is not dressed up as a crash",
  );
}

// --- endpoints, as something to try -----------------------------------------
// The wizard reads api.json only to know what to put on screen. Rust holds the
// authority over what a declaration means, so nothing here is a check — which
// is exactly why it must never throw on a file the model wrote seconds ago.
{
  const api = (contents: string) => [file("api.json", contents)];

  assertEq(endpointsToProbe([]), [], "no api.json, nothing to try");
  assertEq(endpointsToProbe(api("{ not json")), [], "a malformed declaration is not a crash");
  assertEq(endpointsToProbe(api('{"endpoints":"nope"}')), [], "and neither is a wrong shape");
  assertEq(
    endpointsToProbe(api('{"endpoints":[{"description":"no id"}]}')),
    [],
    "an endpoint without an id cannot be called, so it is not offered",
  );

  const declared = endpointsToProbe(
    api(
      JSON.stringify({
        schemaVersion: 1,
        endpoints: [
          {
            id: "search",
            description: "Finds stations.",
            method: "get",
            url: "https://api.waqi.info/v2/search/",
            query: {
              keyword: { type: "string", required: true },
              token: { type: "string", required: true },
              format: { type: "const", value: "json" },
              unit: { type: "enum", values: ["c", "f"] },
            },
          },
          {
            id: "feed",
            method: "GET",
            url: "https://api.waqi.info/feed/@{uid}/",
            path: { uid: { type: "string", required: true } },
            credential: "waqiToken",
          },
        ],
      }),
    ),
  );

  assertEq(declared.length, 2, "both endpoints are offered");
  assertEq(declared[0].method, "GET", "the method is normalised for display");
  assertEq(declared[0].host, "api.waqi.info", "the host is shown, so a person knows where it goes");
  assertEq(declared[1].credential, "waqiToken", "an endpoint that wants an account says so");

  const names = declared[0].inputs.map((input) => input.name);
  assert(names.includes("keyword") && names.includes("token"), "declared parameters become boxes");
  // A const is fixed by the declaration and the caller cannot set it. A field
  // nobody may fill only teaches people that the form is lying.
  assert(!names.includes("format"), "a const is not a box");
  assertEq(
    declared[0].inputs.find((input) => input.name === "unit")?.values?.length,
    2,
    "an enum carries its values, so the box can be a list",
  );
  assertEq(
    declared[1].inputs[0].where,
    "path",
    "a path placeholder is a parameter too — it is what makes /feed/@{uid}/ callable",
  );
}

// --- what a response looks like on its way to the model ---------------------
{
  assert(
    sampleBody({ a: 1 }).split("\n").length > 1,
    "JSON is pretty-printed, since a person reads it too",
  );
  assertEq(sampleBody("already text"), "already text", "a string is left alone");

  const huge = sampleBody({ rows: Array.from({ length: 5000 }, (_, at) => at) });
  assert(huge.length < SAMPLE_MAX + 200, "a large response is clipped");
  assert(huge.includes("more characters"), "and says that it was, rather than ending mid-value");
  // The shape is the whole point; the two hundredth hourly reading teaches the
  // model nothing and is billed by the token.
  assert(huge.startsWith("{"), "the clip keeps the beginning, which is where the shape is");
}

// --- versions ---------------------------------------------------------------
// Every generation rewrites the complete file set, so the version before this
// one exists nowhere else: not on disk, not usably in the transcript, and not
// with the model, which reasons from what it was last sent.
{
  const v1 = [file("widget.js", "one")];
  const v2 = [file("widget.js", "two")];

  const first = recordVersion(undefined, undefined, v1, "Generated", 1000);
  assertEq(first.versions.length, 1, "the first write starts the history");
  assertEq(first.current, first.versions[0].id, "and is what is live");

  const second = recordVersion(first.versions, first.current, v2, "Generated", 2000);
  assertEq(second.versions.length, 2, "the second is kept beside it");

  // A write that changes nothing is not a step.
  const again = recordVersion(second.versions, second.current, v2, "Generated", 3000);
  assertEq(again.versions.length, 2, "an identical package adds nothing");
  assertEq(again.current, second.current, "and does not move what is live");

  // Order is not identity: the model returns the whole set every turn and is
  // free to reorder it.
  const ordered = recordVersion(undefined, undefined, [file("a.js", "1"), file("b.js", "2")], "x", 1);
  assertEq(
    recordVersion(ordered.versions, ordered.current, [file("b.js", "2"), file("a.js", "1")], "x", 2)
      .versions.length,
    1,
    "the same files in another order are the same package",
  );

  // THE CASE THIS EXISTS FOR. Go back to an older version, then write again.
  // Comparing against the newest rather than the live one would call this
  // unchanged and silently drop the write.
  const afterBack = recordVersion(second.versions, second.versions[0].id, v2, "Generated", 4000);
  assertEq(afterBack.versions.length, 3, "writing v2 while v1 is live is a change");
  assert(
    afterBack.versions.some((version) => version.id === second.versions[1].id),
    "the version you left is still reachable — going back is not a one-way door",
  );

  let capped = recordVersion(undefined, undefined, [file("f", "0")], "Generated", 0);
  for (let at = 1; at <= VERSION_LIMIT + 3; at++) {
    capped = recordVersion(capped.versions, capped.current, [file("f", String(at))], "Generated", at);
  }
  assertEq(capped.versions.length, VERSION_LIMIT, "the list is capped");
  assert(
    capped.versions.some((version) => version.id === capped.current),
    "an id still identifies its entry after the list has been sliced, which an index would not",
  );

  // Saving rewrites ui.defaultSize to whatever the preview was left at: a real
  // change to the bytes, but not a step anybody took.
  const patched = updateLiveVersion(second.versions, second.current, v1);
  assertEq(patched.length, 2, "patching the live snapshot adds no entry");
  assertEq(patched[1].files[0].contents, "one", "and does change what it holds");
}

// --- live MCP draft synchronization -----------------------------------------
{
  const local = [file("manifest.json", '{"id":"counter"}'), file("ui/app.js", "one")];
  const external: WizardDraftSnapshot = {
    id: "counter",
    files: [file("manifest.json", '{"id":"counter"}'), file("ui/app.js", "two")],
    revision: "rev-2",
    error: null,
  };
  const written = {
    id: "counter",
    revision: "rev-2",
    kind: "written" as const,
    origin: "mcp" as const,
  };

  assertEq(
    draftSyncDecision(written, {
      activeId: "counter",
      activeRevision: "rev-1",
      busy: false,
      editorDirty: false,
    }),
    "apply",
    "a clean external update applies immediately",
  );
  assertEq(
    draftSyncDecision(written, {
      activeId: "counter",
      activeRevision: undefined,
      busy: false,
      editorDirty: false,
    }),
    "apply",
    "a saved conversation recovers a draft written while its card was closed",
  );
  assertEq(
    draftSyncDecision(written, {
      activeId: "counter",
      activeRevision: "rev-1",
      busy: true,
      editorDirty: false,
    }),
    "conflict",
    "a running generation queues a conflict",
  );
  assertEq(
    draftSyncDecision(written, {
      activeId: "counter",
      activeRevision: "rev-1",
      busy: false,
      editorDirty: true,
    }),
    "conflict",
    "a dirty editor queues a conflict",
  );
  assertEq(
    draftSyncDecision(written, {
      activeId: "counter",
      activeRevision: "rev-2",
      busy: false,
      editorDirty: false,
    }),
    "ignore",
    "an already applied revision is ignored",
  );
  // A rename arrives under the new id. Matching on that alone filed it as
  // somebody else's draft and left the conversation on a folder that had moved.
  assertEq(
    draftSyncDecision(
      { ...written, id: "tadoweather", renamedFrom: "counter" },
      { activeId: "counter", activeRevision: "rev-1", busy: false, editorDirty: false },
    ),
    "apply",
    "a rename of the open draft is still about the open draft",
  );
  assertEq(
    draftSyncDecision(
      { ...written, id: "tadoweather", renamedFrom: "somebody-else" },
      { activeId: "counter", activeRevision: "rev-1", busy: false, editorDirty: false },
    ),
    "other",
    "and a rename of another draft is not",
  );
  assertEq(
    draftSyncDecision({ ...written, id: "other" }, {
      activeId: "counter",
      activeRevision: "rev-1",
      busy: false,
      editorDirty: false,
    }),
    "other",
    "another draft never disturbs the active conversation",
  );

  const applied = applyDraftSnapshot(external);
  assertEq(applied.draftRevision, "rev-2", "apply adopts the external revision");
  assertEq(applied.draftFiles, external.files, "apply adopts every file");
  assertEq(applied.knownFiles, undefined, "apply clears model-known files");
  applied.draftFiles[0]!.contents = "changed locally";
  assertEq(external.files[0]!.contents, '{"id":"counter"}', "apply clones file objects");

  const conflict: DraftConflict = {
    id: "counter",
    external,
    externalRevision: external.revision,
    localFiles: local,
    reason: "dirty",
  };
  const queued = queueDraftConflict(null, conflict);
  assertEq(queued.externalRevision, "rev-2", "queued conflict keeps the MCP revision");
  assertEq(
    keepMineExpectedRevision(queued),
    "rev-2",
    "Keep mine writes against the external revision",
  );
  const sameQueued = queueDraftConflict(queued, {
    ...conflict,
    localFiles: [file("manifest.json", '{"id":"counter"}')],
  });
  assertEq(sameQueued.externalRevision, "rev-2", "queued conflict survives until resolution");
  assertEq(sameQueued.localFiles.length, 1, "the latest local snapshot is retained");
  assertEq(
    queueDraftConflict(queued, { ...conflict, externalRevision: "rev-3" }).externalRevision,
    "rev-3",
    "a newer stale revision replaces the queued external snapshot",
  );
}

// --- applying a partial answer ----------------------------------------------
// The model used to rewrite every file to change one line, and output is billed
// at five times input. A follow-up turn is now told to send only what changed.
{
  const current = [
    file("manifest.json", '{"id":"c"}'),
    file("ui/app.js", "let x = 1;"),
    file("api.json", '{"endpoints":[]}'),
  ];
  const parse = (text: string) => parseGeneratedFiles(text);

  const changed = mergeGeneratedFiles(current, parse("```js path=ui/app.js\nlet x = 2;\n```"));
  assertEq(changed.length, 3, "the files the answer did not mention are kept");
  assertEq(changed[1].contents, "let x = 2;", "and the one it did is replaced");
  assertEq(
    changed.map((f) => f.path),
    ["manifest.json", "ui/app.js", "api.json"],
    "order follows the package, so a file does not move because a turn touched it",
  );

  const added = mergeGeneratedFiles(current, parse("```css path=ui/extra.css\nb{}\n```"));
  assertEq(added.length, 4, "a new file is appended");
  assertEq(added[3].path, "ui/extra.css", "at the end, not in the middle");

  // Silence stopped meaning deletion the moment an answer could be partial.
  assert(
    changed.some((f) => f.path === "api.json"),
    "an omitted file is kept — the host cannot tell 'not touched' from 'remove it'",
  );

  const dropped = mergeGeneratedFiles(current, parse("```json path=api.json deleted=true\n```"));
  assertEq(dropped.length, 2, "an explicit deletion removes the file");
  assert(!dropped.some((f) => f.path === "api.json"), "and it is the named one");
  assertEq(
    parse("```json path=api.json deleted=true\n```").files.length,
    0,
    "a deleted block is not also written as an empty file",
  );
  // A model that writes the attribute bare means the same thing, and being
  // strict would turn a deletion into a mysteriously empty file.
  assertEq(
    mergeGeneratedFiles(current, parse("```json path=api.json deleted\n```")).length,
    2,
    "bare `deleted` counts too",
  );

  // A complete answer merges to itself, so nothing downstream has to know which
  // kind of answer arrived.
  assertEq(
    mergeGeneratedFiles(
      [],
      parse("```json path=manifest.json\n{}\n```\n\n```js path=ui/app.js\nlet x = 3;\n```"),
    ).map((f) => f.path),
    ["manifest.json", "ui/app.js"],
    "against an empty package a complete answer is the package",
  );

  // Contradictory instructions: written and deleted in the same answer. Keeping
  // a file somebody wrote is recoverable; deleting one is not.
  const both = parse(
    "```js path=ui/app.js\nlet x = 9;\n```\n\n```js path=ui/app.js deleted=true\n```",
  );
  assertEq(
    mergeGeneratedFiles(current, both).find((f) => f.path === "ui/app.js")?.contents,
    "let x = 9;",
    "a file both written and deleted survives, with what was written",
  );
}

// --- an answer that did not say what it did ---------------------------------
// "(no explanation)" is a complaint about the model dressed up as a message: it
// says nothing about the widget and cannot be acted on. The files are right
// there, and naming them is the sentence the missing prose would have been.
{
  const before = [file("manifest.json", "{}"), file("widget.js", "one")];
  const parse = (text: string) => parseGeneratedFiles(text);

  assertEq(
    describeReply(parse("```js path=widget.js\ntwo\n```"), before),
    "Changed widget.js.",
    "the usual case: one file, touched",
  );
  assertEq(
    describeReply(parse("```css path=extra.css\nb{}\n```"), before),
    "Added extra.css.",
    "a file that was not there is added, not changed",
  );
  assertEq(
    describeReply(parse("```json path=api.json deleted=true\n```"), before),
    "Removed api.json.",
    "and a deletion is named as one",
  );
  assertEq(
    describeReply(
      parse("```js path=widget.js\ntwo\n```\n\n```css path=extra.css\nb{}\n```"),
      before,
    ),
    "Added extra.css · Changed widget.js.",
    "both halves, in the order they matter",
  );

  // A line whose whole point is to be glanceable must not become a directory
  // listing.
  const many = ["a.js", "b.js", "c.js", "d.js"]
    .map((path) => "```js path=" + path + "\nx\n```")
    .join("\n\n");
  assertEq(describeReply(parse(many), before), "Added 4 files.", "past three it is a count");
}

// --- effort -----------------------------------------------------------------
// The vocabularies do not overlap fully: `xhigh`/`max` are on both, `minimal`
// is OpenAI's alone. The host refuses a level the model does not list, so
// carrying one across a model switch would turn an innocent switch into a
// failed generation.
{
  const opus = {
    id: "claude-opus-5", label: "Opus 5", note: "", provider: "anthropic",
    credentialType: "anthropic", configured: true,
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
  };
  const astra = {
    id: "gpt-6-astra", label: "Astra", note: "", provider: "openai",
    credentialType: "openai", configured: true,
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
  };
  const haiku = {
    id: "claude-haiku-4-5", label: "Haiku", note: "", provider: "anthropic",
    credentialType: "anthropic", configured: true,
  };

  assertEq(effortForModel("max", opus), "max", "a level the model takes survives");
  assertEq(effortForModel("minimal", opus), undefined, "one it does not is dropped, not sent");
  assertEq(effortForModel("low", astra), "low", "the levels they share carry across");
  // Some models error when the parameter is present at all, so "no list" has to
  // mean "send nothing" rather than "anything goes".
  assertEq(effortForModel("high", haiku), undefined, "a model with no levels gets none");
  assertEq(effortForModel(undefined, opus), undefined, "no choice stays no choice");
  assertEq(effortForModel("max", undefined), undefined, "and an unknown model is not guessed at");

  // No "Effort:" in front of every row — the list already sits under that
  // heading, and repeating it once per item makes a short list look long.
  assertEq(effortLabel("low"), "Low", "spelled for a person, not shouted");
  assertEq(effortLabel("xhigh"), "Extra high", "the one value that is not a word");
  assertEq(effortLabel("max"), "Max", "and the rest are just capitalised");
  assertEq(effortLabel(""), "Default", "no choice has a name too");
  // The words track the API values rather than being reworded.
  assert(!/light/i.test(effortLabel("low")), "no editorial synonyms for a value we send");
}

// --- what a turn cost -------------------------------------------------------
// The counts are the provider's and exact; the money is an estimate and is
// labelled as one wherever it is shown.
{
  const spent = { input: 1000, cached: 9000, cacheWrite: 500, output: 2000 };

  assertEq(addUsage(NO_USAGE, spent), spent, "the first turn is the conversation's total");
  assertEq(addUsage(spent, spent).cached, 18000, "and a second turn adds to it");

  // Anything the backend did not send reads as zero. A `NaN` here would
  // propagate into the running total and never wash out.
  assertEq(readUsage(undefined), NO_USAGE, "a reply without usage costs nothing on screen");
  assertEq(readUsage({ input: "lots" }), NO_USAGE, "a non-number is not a token count");
  assertEq(readUsage({ input: -5 }), NO_USAGE, "and neither is a negative one");
  assertEq(readUsage({ input: 12.7 }).input, 13, "a fraction of a token is rounded, not kept");

  // WHAT WENT WRONG BEFORE. The three input buckets are billed at three rates
  // and stored apart, but a new message is largely written *into* the cache —
  // so it lands in `cacheWrite`, and a line showing only `input` read "3 in"
  // however much had been typed. The difference sat in a bucket nothing named.
  assertEq(freshInput(spent), 1500, "everything sent that did not come from cache");
  assertEq(freshInput(NO_USAGE), 0, "and nothing is nothing");
  assertEq(
    freshInput(spent) + spent.cached,
    spent.input + spent.cacheWrite + spent.cached,
    "fresh and cached together are the entire prompt",
  );

  // Sonnet 5's introductory rate, as the catalog states it.
  const pricing = { currency: "USD", unitTokens: 1_000_000, input: 2, output: 10 };
  const cost = estimateCost(spent, pricing);
  assert(cost !== null, "a model that states a price gets an estimate");
  // 1000*2 + 9000*0.2 + 500*2.5 + 2000*10 = 25,050 per million.
  assert(Math.abs(cost!.amount - 0.02505) < 1e-9, "each of the four is billed at its own rate");
  assertEq(cost!.currency, "USD", "the currency travels with the amount");

  // THE POINT OF COUNTING CACHED TOKENS SEPARATELY.
  const uncached = { input: 10500, cached: 0, cacheWrite: 0, output: 2000 };
  assert(
    estimateCost(uncached, pricing)!.amount > estimateCost(spent, pricing)!.amount * 1.5,
    "a cached turn is visibly cheaper than the same turn uncached",
  );

  const stated = { currency: "USD", unitTokens: 1_000_000, input: 5, cachedInput: 0.5, output: 30 };
  assert(estimateCost(spent, stated) !== null, "an explicit cachedInput is used");
  assertEq(estimateCost(spent, undefined), null, "a model with no price gets no invented one");
  assertEq(
    estimateCost(spent, { ...pricing, unitTokens: 0 }),
    null,
    "and neither does a catalog entry that cannot be divided by",
  );

  // THE BUG STORED COSTS REPLACED: every message was priced with whatever model
  // the picker held *now*, so switching it rewrote the cost of turns that had
  // already been paid for. A turn's cost is a fact about the past.
  const cheap = { currency: "USD", unitTokens: 1_000_000, input: 1, output: 5 };
  const dear = { currency: "USD", unitTokens: 1_000_000, input: 10, output: 50 };
  assert(
    estimateCost(spent, cheap)!.amount !== estimateCost(spent, dear)!.amount,
    "the same tokens cost different amounts on different models — hence one stored per turn",
  );

  const one = estimateCost(spent, cheap)!;
  assertEq(addCost(undefined, one), one, "the first priced turn is the total");
  assertEq(addCost(one, one)!.amount, one.amount * 2, "and a second adds to it");

  // Sticky null. A total quietly missing a turn is a wrong number, and this one
  // is money — so it is withdrawn rather than understated.
  assertEq(addCost(one, null), null, "an unpriced turn makes the total unstatable");
  assertEq(addCost(null, one), null, "and it stays that way once it is");
  assertEq(
    addCost(one, { amount: 1, currency: "EUR" }),
    null,
    "two currencies cannot be added, so they are not",
  );
  assertEq(addCost(undefined, null), null, "an unpriced first turn is not a zero total");

  // A conversation off disk: a field that is not the shape it claims does not
  // look wrong, it throws while rendering a number.
  assertEq(
    readCost({ amount: 0.25, currency: "USD" }),
    { amount: 0.25, currency: "USD" },
    "a good one survives",
  );
  assertEq(readCost(null), null, "nothing is nothing");
  assertEq(readCost({ amount: "0.25", currency: "USD" }), null, "a string is not an amount");
  assertEq(readCost({ amount: Number.NaN, currency: "USD" }), null, "and neither is NaN");
  assertEq(readCost({ amount: 0.25 }), null, "an amount without a currency cannot be shown");

  assertEq(formatTokens(340), "340", "small counts are exact");
  assertEq(formatTokens(1234), "1.2k", "a size, not an accounting figure");
  assertEq(formatTokens(18400), "18k", "and it stops pretending to precision it does not have");

  // A turn that cost three tenths of a cent must not read as free — the total
  // it belongs to is not.
  assertEq(formatCost(0.003), "<$0.01", "almost nothing is not nothing");
  assertEq(formatCost(0), "$0.00", "actually nothing is nothing");
  assertEq(formatCost(0.2505), "$0.25", "and the rest rounds normally");
}

{
  const providers = [
    { id: "kavibay.tado/tado", label: "tado°" },
    { id: "kavibay.weather/open-meteo", label: "Weather (Open-Meteo)" },
    { id: "kavibay.weather/short", label: "Weather" },
  ];

  assertEq(
    splitProviderMentions("a tracker for water", providers),
    [{ kind: "text", text: "a tracker for water" }],
    "plain text is one segment",
  );
  assertEq(
    splitProviderMentions(
      "show temp in my rooms. use @tado° also show AQI in berlin @Weather (Open-Meteo)",
      providers,
    ),
    [
      { kind: "text", text: "show temp in my rooms. use " },
      { kind: "mention", id: "kavibay.tado/tado", label: "tado°" },
      { kind: "text", text: " also show AQI in berlin " },
      {
        kind: "mention",
        id: "kavibay.weather/open-meteo",
        label: "Weather (Open-Meteo)",
      },
    ],
    "each @Name becomes the chip the composer already draws",
  );
  assertEq(
    splitProviderMentions("@tado° please", providers),
    [
      { kind: "mention", id: "kavibay.tado/tado", label: "tado°" },
      { kind: "text", text: " please" },
    ],
    "a mention may start the message",
  );
  assertEq(
    splitProviderMentions("mail me@tado° later", providers),
    [{ kind: "text", text: "mail me@tado° later" }],
    "an @ mid-word is not a mention",
  );
  assertEq(
    splitProviderMentions("use @tado°foo", providers),
    [{ kind: "text", text: "use @tado°foo" }],
    "a longer word that merely starts with the label stays text",
  );
  assertEq(
    splitProviderMentions("use @nope and go", providers),
    [{ kind: "text", text: "use @nope and go" }],
    "an unknown @stays as typed",
  );
  assertEq(
    splitProviderMentions("use @Weather please", providers),
    [
      { kind: "text", text: "use " },
      { kind: "mention", id: "kavibay.weather/short", label: "Weather" },
      { kind: "text", text: " please" },
    ],
    "the shorter name still matches when that is what was typed",
  );
  assertEq(
    splitProviderMentions("use @Weather (Open-Meteo) please", providers),
    [
      { kind: "text", text: "use " },
      {
        kind: "mention",
        id: "kavibay.weather/open-meteo",
        label: "Weather (Open-Meteo)",
      },
      { kind: "text", text: " please" },
    ],
    "the longer label wins when both would match at the same @",
  );
}


// --- platform picker for an unconfigured Wizard ---------------------------
//
// The empty conversation used to invite somebody to "describe a widget" and
// mention the missing key in a caption above it — a form that cannot be
// submitted, with the reason in the small print. It now names the platforms up
// front, so these have to come out of the catalog correctly.
{
  const model = (over: Partial<WizardModelOption> & { id: string }): WizardModelOption => ({
    label: over.id,
    note: "",
    provider: "anthropic",
    credentialType: "anthropicApi",
    configured: false,
    ...over,
  });

  const catalog: WizardModelOption[] = [
    model({ id: "cf-1", provider: "cloudflare", credentialType: "cloudflareWorkersAi" }),
    model({ id: "oa-1", provider: "openai", credentialType: "openaiApi" }),
    model({ id: "an-1" }),
    model({ id: "an-2" }),
  ];

  const platforms = wizardPlatforms(catalog);
  assertEq(
    platforms.map((p) => p.id),
    ["anthropic", "openai", "cloudflare"],
    "recommended platforms come first, catalog order inside each half",
  );
  assertEq(
    platforms.map((p) => p.recommended),
    [true, true, false],
    "anthropic and openai are the recommended pair",
  );
  assertEq(
    platforms.map((p) => p.label),
    ["Anthropic", "OpenAI", "Cloudflare Workers AI"],
    "each platform is named the way the vendor names itself",
  );
  assertEq(
    platforms.map((p) => p.modelCount),
    [2, 1, 1],
    "a platform counts every authoring model it serves",
  );
  assertEq(
    platforms.map((p) => p.credentialType),
    ["anthropicApi", "openaiApi", "cloudflareWorkersAi"],
    "the credential type is carried through so a click can open the right card",
  );

  // One configured model is enough to mark its platform connected — and must
  // not mark the others.
  const partly = wizardPlatforms([
    model({ id: "an-1", configured: false }),
    model({ id: "an-2", configured: true }),
    model({ id: "oa-1", provider: "openai", credentialType: "openaiApi" }),
  ]);
  assertEq(
    partly.map((p) => [p.id, p.configured]),
    [
      ["anthropic", true],
      ["openai", false],
    ],
    "configured is per platform, not per model",
  );

  // A platform the label map has never heard of is listed under its id rather
  // than dropped: a fourth provider in the catalog must not disappear silently.
  const unknown = wizardPlatforms([
    model({ id: "x-1", provider: "someVendor", credentialType: "someVendorApi" }),
  ]);
  assertEq(
    unknown.map((p) => [p.id, p.label, p.recommended]),
    [["someVendor", "someVendor", false]],
    "an unmapped platform still appears",
  );

  assert(wizardPlatforms([]).length === 0, "no models, no platforms");
  assert(wizardHasAnyKey([]) === false, "an empty catalog has no key");
  assert(wizardHasAnyKey(catalog) === false, "nothing configured means no key");
  assert(
    wizardHasAnyKey([...catalog, model({ id: "an-3", configured: true })]),
    "one configured model is a key",
  );
}

{
  assertEq(
    fileTreeRows(["manifest.json", "ui/index.html", "api.json", "ui/icons/sun.svg"]).map((row) => [
      row.kind,
      row.name,
      row.depth,
    ]),
    [
      ["folder", "ui", 0],
      ["folder", "icons", 1],
      ["file", "sun.svg", 2],
      ["file", "index.html", 1],
      ["file", "api.json", 0],
      ["file", "manifest.json", 0],
    ],
    "folders come first at every level, and files sit under their folder",
  );
  assertEq(
    fileTreeRows(["ui/index.html"])[1],
    { kind: "file", key: "ui/index.html", name: "index.html", depth: 1, path: "ui/index.html" },
    "a nested file shows its name and keeps its full path for opening",
  );
  assertEq(fileTreeRows([]), [], "no files, no rows");
  assertEq(
    ["manifest.json", "ui/index.html", "widget.js", "ui/style.css", "icon.SVG", "README.md"].map(fileKind),
    ["json", "markup", "script", "style", "image", "text"],
    "a file's kind follows its extension, whatever its case",
  );
  assertEq(
    ["manifest.json", "ui/index.html", "widget.js", "ui/style.css", "icon.svg", "README.md"].map(
      highlightLanguage,
    ),
    ["script", "markup", "script", "style", "markup", null],
    "json and scripts share a scanner, svg is markup, and text stays plain",
  );
}

{
  const weather = {
    id: "kavibay.weather/weather",
    displayName: "Weather (Open-Meteo)",
    requiresCredential: false,
    queries: [],
  };
  const tado = {
    id: "kavibay.tado/tado",
    displayName: "tado°",
    requiresCredential: true,
    credentialType: "tadoOAuth2",
    queries: [],
  };
  const manifest = (providers: string[]) => ({
    path: "manifest.json",
    contents: JSON.stringify({ widget: { requires: { providers } } }),
  });

  const uses = providersUsedBy(
    [manifest(["kavibay.weather/weather", "kavibay.tado/tado", "someone.else/gone"])],
    [weather, tado],
  );
  assertEq(
    uses.map((use) => [use.id, use.schema?.displayName ?? null]),
    [
      ["kavibay.weather/weather", "Weather (Open-Meteo)"],
      ["kavibay.tado/tado", "tado°"],
      ["someone.else/gone", null],
    ],
    "the manifest's providers, in its order, with the host's schema or none",
  );
  assertEq(providersUsedBy([], [weather]), [], "no manifest, no providers");
  assertEq(
    providersUsedBy([{ path: "manifest.json", contents: "{ half" }], [weather]),
    [],
    "a manifest that does not parse names no providers",
  );
  assertEq(
    uses.map((use) => providerUseState(use, false)),
    ["free", "disconnected", "missing"],
    "a provider without an account is free, one with an account needs it, an unknown one is missing",
  );
  assertEq(providerUseState(uses[1]!, true), "connected", "a connected account");

  assertEq(
    argSignature({
      location: { type: "string", label: "Place", required: true },
      days: { type: "number", label: "Days" },
    }),
    "location, days?",
    "optional arguments are marked",
  );
  assertEq(argSignature(undefined), "", "a query without arguments");
  assertEq(
    describeResultShape({
      type: "list",
      of: { type: "object", fields: { id: { type: "string" }, name: { type: "string" } } },
    }),
    "list of { id, name }",
    "a list of objects names the fields",
  );
  assertEq(describeResultShape({ type: "number", nullable: true }), "number or null", "a nullable value");
}

// --- a package that changed format ------------------------------------------
// A water tracker moved to the contract format to read a provider. The answer
// wrote index.html and widget.js and kept ui/, which nothing loaded any more.
{
  const runtime = [
    file("manifest.json", '{"id":"water-tracker","ui":{"entry":"ui/index.html"}}'),
    file("ui/index.html", "<script src=\"app.js\"></script>"),
    file("ui/app.js", "kavibay.storage.get();"),
    file("api.json", '{"endpoints":[]}'),
  ];
  const toContract = parseGeneratedFiles(
    "```json path=manifest.json\n" +
      '{\n  "name": "water-tracker",\n  "widget": { "name": "tile" },\n  "ui": { "defaultScale": 1 }\n}\n' +
      "```\n```html path=index.html\n<div id=\"kavibay-widget\"></div>\n```\n" +
      "```js path=widget.js\nexport default {};\n```",
  );
  const switched = withoutOtherFormat(runtime, mergeGeneratedFiles(runtime, toContract));
  assertEq(
    switched.map((f) => f.path).join(","),
    "manifest.json,api.json,index.html,widget.js",
    "the old format's files go; manifest and api.json are read by both",
  );
  assertEq(
    switched[0].contents,
    '{\n  "name": "water-tracker",\n  "widget": {\n    "name": "tile"\n  }\n}\n',
    "the contract manifest loses the ui block nothing reads",
  );

  const partial = parseGeneratedFiles("```js path=ui/app.js\nkavibay.storage.set(1);\n```");
  const sameFormat = withoutOtherFormat(runtime, mergeGeneratedFiles(runtime, partial));
  assertEq(sameFormat.length, 4, "an answer inside one format keeps what it did not mention");

  const back = parseGeneratedFiles(
    '```json path=manifest.json\n{"id":"water-tracker","ui":{"entry":"ui/index.html"}}\n```\n' +
      "```html path=ui/index.html\n<p></p>\n```",
  );
  assertEq(
    withoutOtherFormat(switched, mergeGeneratedFiles(switched, back)).map((f) => f.path).join(","),
    "manifest.json,api.json,ui/index.html",
    "and back: the contract's index.html and widget.js go",
  );
}

// --- status notes do not pile up --------------------------------------------
// Opening a project three times in a row wrote three "Continuing your unsaved
// changes" notes, one under the other, with nothing said in between.
{
  const bubbles: WizardBubble[] = [{ role: "user", text: "erstelle einen tracker" }];
  appendNote(bubbles, { role: "system", text: 'Editing "w".', opened: true, version: "1" });
  appendNote(bubbles, { role: "system", text: 'Continuing your unsaved changes to "w".', opened: true, version: "2" });
  assertEq(bubbles.length, 2, "a second opening replaces the first");
  assertEq(bubbles[1].version, "2", "and points at what is open now");

  appendNote(bubbles, { role: "system", text: "Stopped." });
  appendNote(bubbles, { role: "system", text: "Stopped." });
  assertEq(bubbles.length, 3, "the same note twice in a row is written once");

  appendNote(bubbles, { role: "system", text: 'Editing "w".', opened: true });
  assertEq(bubbles.length, 4, "an opening after something else happened is its own note");

  bubbles.push({ role: "user", text: "mach es blau" });
  appendNote(bubbles, { role: "system", text: 'Saved "w".', tone: "success", run: { id: "w" } });
  appendNote(bubbles, { role: "system", text: 'Saved "w".', tone: "success", run: { id: "w" } });
  assertEq(bubbles.length, 7, "a note with a button is never merged away");
}

// --- a file block glued to the end of a sentence -----------------------------
// A model wrote "…zum Beispiel `26.677`.```json path=manifest.json" with no line
// break. The block was not recognised, and the manifest showed up in the chat.
{
  const reply = parseGeneratedFiles(
    "Die Tage stehen mit Tausenderpunkt da, zum Beispiel `26.677`.```json path=manifest.json\n" +
      '{ "id": "holiday-countdown" }\n' +
      "```\n```js path=ui/app.js\nlet days = 1;\n```",
  );
  assertEq(
    reply.prose,
    "Die Tage stehen mit Tausenderpunkt da, zum Beispiel `26.677`.",
    "the sentence stays prose",
  );
  assertEq(reply.files.map((f) => f.path).join(","), "manifest.json,ui/app.js", "and the glued block is a file");
  assertEq(reply.files[0].contents, '{ "id": "holiday-countdown" }', "with its contents intact");
}

{
  const svg = '<svg viewBox="0 0 20 20"/>';
  const manifest = (body: string) => ({ path: "manifest.json", contents: body });
  const icon = { path: "icon.svg", contents: svg };
  assertEq(manifestIconSvg([manifest('{"icon":"icon.svg"}'), icon]), svg, "the named svg is read");
  assertEq(manifestIconSvg([manifest('{"icon":"./icon.svg"}'), icon]), svg, "a ./ prefix names the same file");
  assertEq(manifestIconSvg([manifest('{"icon":"icon.svg"}')]), null, "named but not emitted");
  assertEq(manifestIconSvg([manifest('{"icon":"icon.png"}'), icon]), null, "a png is not shown inline");
  assertEq(manifestIconSvg([manifest("{}"), icon]), null, "a stray icon.svg the manifest does not name");
  assertEq(manifestIconSvg([manifest("{ broken"), icon]), null, "broken manifest");
}

// --- edit blocks -------------------------------------------------------------
// A follow-up turn may send only the change to a large file. The edit must land
// exactly once, or the whole answer is refused and goes back for repair.
{
  const reply = [
    "Made the goal bigger.",
    "```edit path=ui/app.js",
    "<<<<<<< SEARCH",
    "const GOAL = 2000;",
    "=======",
    "const GOAL = 2500;",
    ">>>>>>> REPLACE",
    "```",
  ].join("\n");
  const parsed = parseGeneratedFiles(reply);
  assertEq(parsed.files, [], "an edit block is not a file");
  assertEq(
    parsed.edits,
    [{ path: "ui/app.js", search: "const GOAL = 2000;", replace: "const GOAL = 2500;" }],
    "the pair is read",
  );
  assertEq(parsed.prose, "Made the goal bigger.", "and the prose stays prose");

  const files = [file("ui/app.js", "const GOAL = 2000;\nrender();"), file("manifest.json", "{}")];
  const applied = applyReplyEdits(files, parsed.edits ?? []);
  assertEq(applied.problems, [], "an exact, unique match applies");
  assertEq(applied.files[0].contents, "const GOAL = 2500;\nrender();", "to that text only");
  assertEq(files[0].contents, "const GOAL = 2000;\nrender();", "without touching the input");

  const twice = applyReplyEdits([file("ui/app.js", "x();\nx();")], [
    { path: "ui/app.js", search: "x();", replace: "y();" },
  ]);
  assert(twice.problems[0].includes("more than once"), "an ambiguous edit is refused");
  const nowhere = applyReplyEdits(files, [{ path: "ui/app.js", search: "nope", replace: "" }]);
  assert(nowhere.problems[0].includes("did not match"), "a missing match is refused");
  assertEq(nowhere.files, files, "and nothing is half-applied");

  const broken = parseGeneratedFiles("```edit path=ui/app.js\njust some text\n```");
  assertEq(broken.malformedEdits, ["ui/app.js"], "an edit block without markers is reported");
}

// --- scope ------------------------------------------------------------------
// Read on the first turn only: afterwards a message is a change, and "rich" on
// "make the dots grey" would invite a rebuild.
assert(turnForPackage("a habit tracker", "", { scope: "rich" }).includes("Scope: rich"), "first turn, rich");
assert(turnForPackage("a habit tracker", "", { scope: "simple" }).includes("Scope: simple"), "first turn, simple");
assertEq(
  turnForPackage("a habit tracker", "", { scope: "standard" }),
  turnForPackage("a habit tracker", ""),
  "standard adds nothing",
);
assert(!turnForPackage("make it grey", "habits", { scope: "rich" }).includes("Scope:"), "not on a change");

// --- sandbox lint -----------------------------------------------------------
{
  const html = (body: string) => file("ui/index.html", `<!doctype html><body>${body}</body>`);
  const js = (code: string) => file("ui/app.js", code);
  const notes = (...files: GeneratedFile[]) => lintGeneratedFiles([file("manifest.json", "{}"), ...files]);

  assert(notes(html("<script>go()</script>")).some((n) => n.includes("inline <script>")), "inline script");
  assertEq(notes(html('<script src="app.js"></script>')), [], "an external script is fine");
  assert(notes(html('<button onclick="go()">Go</button>')).some((n) => n.includes("onclick")), "inline handler");
  assert(notes(js('form.addEventListener("submit", go);')).some((n) => n.includes("submit")), "form submit");
  assert(notes(js("fetch(url);")).some((n) => n.includes("fetch")), "fetch");
  assertEq(notes(js("// we never fetch(url) here")), [], "a comment that mentions fetch is not a call");
  assert(notes(js("if (confirm('Sure?')) wipe();")).some((n) => n.includes("confirm")), "confirm()");
  assertEq(notes(js("dialog.confirm(); state.prompt();")), [], "methods with the same name are fine");

  assert(
    notes(html('<p id="total"></p>'), js('document.getElementById("count").textContent = 1;')).some((n) =>
      n.includes("#count"),
    ),
    "a lookup for an id nothing has",
  );
  assertEq(
    notes(html('<p id="total"></p>'), js('document.getElementById("total").textContent = 1;')),
    [],
    "an id the markup has",
  );
  assertEq(
    notes(html(""), js('el.id = "row"; document.getElementById("row");')),
    [],
    "an id the script creates",
  );
}

{
  const options = [
    { id: "kavibay.notion/notion", label: "Notion" },
    { id: "kavibay.tado/tado", label: "tado°" },
    { id: "kavibay.weather/weather", label: "Weather (Open-Meteo)" },
  ];
  const ids = (text: string, selected: string[] = []) =>
    unselectedNamedProviders(text, options, selected).map((o) => o.id);
  assertEq(ids("Zeig meine Notion-Datenbanken"), ["kavibay.notion/notion"], "a label inside a compound word");
  assertEq(ids("Zeig meine Notion-Datenbanken", ["kavibay.notion/notion"]), [], "already ticked");
  assertEq(ids("Raumtemperatur aus TADO und das Wetter"), ["kavibay.tado/tado"], "label without its degree sign");
  assertEq(ids("a weather card"), ["kavibay.weather/weather"], "label without its parenthetical");
  assertEq(ids("notional budget, tadoo"), [], "whole words only");
  assertEq(ids("Open-Meteo forecast"), [], "the parenthetical alone does not match");
}

console.log("widgetWizardLogic.assert.ts: ok");
