/**
 * CI guard for the contract host's iframe boundary.
 *
 * Run: node scripts/extensionHostSandboxGuard.assert.mjs
 *
 * The sibling guard for RuntimeExtensionFrame exists because these properties
 * cannot be asserted from `tsx` — there is no window, no iframe and no second
 * origin. They are also the properties whose loss is invisible: widening the
 * sandbox attribute or dropping the source check does not break a single test,
 * it just quietly ends the isolation.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const framePath = join(root, "core", "app", "extension-host", "ui", "SandboxedWidgetFrame.vue");
const guestPath = join(root, "core", "app", "extension-host-sandbox", "main.ts");
/**
 * Comments come out first, so the guard reads code rather than prose.
 *
 * Both files document the rules by naming the exact thing that is forbidden,
 * which is what makes the comment worth reading — and would otherwise trip
 * every check below. `//` only starts a comment when it is not preceded by a
 * colon, so a url survives.
 */
const stripComments = (source) =>
  source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const frame = stripComments(readFileSync(framePath, "utf8"));
const guest = stripComments(readFileSync(guestPath, "utf8"));

// --- the opaque origin ---
assert(
  !/\ballow-same-origin\b/.test(frame),
  "SandboxedWidgetFrame.vue must not contain allow-same-origin: the guest is served from the app's own origin, so this flag would hand it the cockpit's storage and tauri's invoke",
);
assert(
  /sandbox\s*=\s*["']allow-scripts["']/.test(frame),
  'SandboxedWidgetFrame.vue must keep sandbox="allow-scripts" (exactly)',
);
assert(
  !/:sandbox\s*=/.test(frame),
  "SandboxedWidgetFrame.vue must use a static sandbox attribute, never a bound one",
);

// --- identity is the window reference, on both sides ---
assert(
  /event\.source\s*!==\s*frameWin/.test(frame),
  "SandboxedWidgetFrame.vue must accept messages only from its own iframe's contentWindow",
);
assert(
  /event\.source\s*!==\s*window\.parent/.test(guest),
  "the guest must accept messages only from its embedder",
);

/**
 * `event.origin` is "null" for an opaque origin, so comparing it proves nothing
 * and reads as though it does. Anyone reaching for it here has mistaken this
 * for an ordinary cross-origin channel.
 */
assert(
  !/event\.origin/.test(frame) && !/event\.origin/.test(guest),
  "neither side may gate on event.origin: an opaque origin reports null, so the check would pass for anyone",
);

/**
 * FINDING 16. The instance a frame speaks for comes from the host's own record.
 * A `readInit` or an instanceId read out of a message on the host side is the
 * whole finding reintroduced.
 */
assert(
  /props\.instance/.test(frame) && !/readInit/.test(frame),
  "SandboxedWidgetFrame.vue must take the instance from props, never from a message",
);

/**
 * No widget view may use a `<form>`.
 *
 * The form submission algorithm checks the sandbox flag *before* it fires the
 * submit event, so inside `allow-scripts` the event never arrives and an
 * `@submit.prevent` handler never runs. Not prevented — skipped. The widget
 * renders correctly and quietly does nothing, and the only trace is a console
 * line in a frame nobody has open.
 *
 * Widget views only. `ui/` renders in the host document, where a form is
 * ordinary.
 */
const extensionsRoot = join(root, "extensions");

/**
 * Contract extensions only. `extensions/` also holds the old host's widgets,
 * which render in the host document where a form is ordinary — scanning those
 * would fail the build for code this rule was never about. A folder is ours
 * when its manifest says so, which is the same test `loadExtensions.ts` and
 * `bundledExtensions.ts` use to decide who reads it.
 */
const contractExtensionDirs = readdirSync(extensionsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(extensionsRoot, entry.name))
  .filter((dir) => {
    try {
      return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).format === "contract";
    } catch {
      return false; // no manifest, or not JSON — not a contract extension
    }
  });

const viewDirs = [
  join(root, "core", "app", "extension-host", "fixtures"),
  ...contractExtensionDirs,
];

/**
 * Recursive on purpose. A contract extension keeps its views under
 * `widgets/`, and a flat scan would skip every one of them while still
 * reporting ok — the worst possible outcome for a guard whose whole reason to
 * exist is that the failure it catches is silent.
 */
function vueFilesIn(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) vueFilesIn(path, found);
    else if (entry.name.endsWith(".vue")) found.push(path);
  }
  return found;
}

const scanned = [];
for (const dir of viewDirs) {
  for (const file of vueFilesIn(dir)) {
    scanned.push(file);
    const source = stripComments(readFileSync(file, "utf8"));
    assert(
      !/<form[\s>]/.test(source),
      `${file} uses a <form>: submission is inert inside allow-scripts, because the sandbox check runs before the submit event fires. Wire the button with @click and the field with @keyup.enter instead.`,
    );
  }
}

/**
 * A guard that silently scans nothing passes forever. This is the tripwire for
 * the layout moving again.
 */
assert(
  scanned.length > 0,
  `no widget views found under ${viewDirs.join(", ")} — the guard is checking nothing, so the layout moved`,
);

/**
 * The example package, held to the same rules as the app's own guest.
 *
 * It is the thing an author copies and the thing a generator will be shown, so
 * a mistake here is a mistake that propagates. Both rules below produce a widget
 * that renders correctly and does nothing, with no error anyone will see.
 */
const packageDir = join(root, "sdk", "extension", "contract", "example-package");
const packageHtml = readFileSync(join(packageDir, "index.html"), "utf8");
const packageJs = stripComments(readFileSync(join(packageDir, "widget.js"), "utf8"));

assert(
  packageHtml.includes('id="kavibay-widget"'),
  "the example package's document has no #kavibay-widget for the guest to fill",
);
assert(
  packageHtml.includes('src="@kavibay/contract.js"'),
  "the example package must load the host-served guest runtime",
);
assert(
  !/<script[^>]*type\s*=\s*["']module["']/.test(packageHtml),
  'a package document must not use type="module": an opaque origin makes that fetch cross-origin, so it never loads (finding 17)',
);
assert(
  packageJs.includes("kavibayWidget.define("),
  "the example package's script must register itself through kavibayWidget.define",
);
assert(
  !/createElement\(\s*["']form["']\s*\)/.test(packageJs),
  "a package must not build a form: submission is checked against the sandbox flags before the submit event fires, so the handler is skipped (finding 18)",
);

/**
 * A package is embedded by format, and the contract branch comes first.
 *
 * The two frames speak different protocols and neither answers the other's
 * messages — `RuntimeExtensionFrame` requires a `type` in the `kavibay.ext.*`
 * vocabulary, and a contract guest opens with `{ kind: "kavibay.widget.ready" }`
 * — so a package handed to the wrong one has its handshake dropped in silence
 * and renders a black rectangle. That is not a test failure anywhere: the frame
 * mounts, the document loads, no exception is thrown and nothing is logged.
 *
 * Ordering is the property, not merely presence. Both branches match on
 * `runtimeEntryUrl`, so a contract check placed *after* the runtime one never
 * runs — which is exactly the shape the bug had.
 */
for (const name of ["WidgetInstanceView.vue", "InlineWidgetBody.vue"]) {
  const source = stripComments(readFileSync(join(root, "core", "app", "host", name), "utf8"));
  const contractAt = source.indexOf("<ContractPackageWidget");
  const runtimeAt = source.indexOf("<RuntimeExtensionFrame");
  assert(
    contractAt !== -1,
    `${name} embeds every package with RuntimeExtensionFrame: a contract package's handshake is dropped there without a word, and the card renders black`,
  );
  assert(
    runtimeAt === -1 || contractAt < runtimeAt,
    `${name} tests for a runtime package first, so the contract branch is unreachable — both match on runtimeEntryUrl`,
  );
}

console.log("extensionHostSandboxGuard.assert.mjs: ok");
