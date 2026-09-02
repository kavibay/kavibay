/**
 * CI guard: a package's canvas must not be handed to `color-scheme`.
 *
 * This has now been got wrong twice, both times invisibly. Models write
 * `:root { color-scheme: dark }` and `body { background: transparent }` — both
 * correct on their own — and per CSS Color Adjust the canvas then takes the
 * scheme's colour *because* the root's background is transparent. Every widget
 * renders as a black rectangle on the desk.
 *
 * The two failed fixes are what this pins against:
 *
 *   1. `:root { background: transparent !important }` — that is the condition
 *      itself, stated as a fix.
 *   2. `rgba(0,0,0,0.00004)` — Chromium quantises alpha to 8 bits at
 *      computed-value time, so it computes to `rgba(0, 0, 0, 0)`: the same
 *      value as `transparent`. Measured, not assumed.
 *
 * A regression here produces no error, no warning and no failing test anywhere
 * else — only a black card that reads as the wizard being broken.
 *
 * Both guests are checked. Fixing one and not the other is exactly how this
 * went wrong the third time: the runtime guest was corrected and the contract
 * one left, so the format whose widgets read real data stayed black.
 *
 * Run: node scripts/runtimeCanvasTransparency.assert.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * BOTH guests, because fixing one is exactly how this went wrong.
 *
 * The runtime guest was fixed and the contract one was left — same trap, same
 * black rectangle, in the format whose widgets read real data. They are
 * hand-kept twins with no shared code, so nothing but this notices.
 */
const guests = [
  ["runtime", join(here, "..", "sdk", "runtime", "kavibay-runtime.js"), "forceTransparentCanvas", "appendChild(style)"],
  ["contract", join(here, "..", "sdk", "extension", "contract", "guest.ts"), "forceTransparentCanvas", "appendChild(style)"],
  // The host's own copy, served into `<head>`. This is the one that cannot be
  // raced: the guests inject when their script runs, which a package puts at
  // the end of `<body>`, so until then the document has been parsed with the
  // dark scheme and the frame may already have composed an opaque background.
  // That race is what made the black intermittent.
  ["protocol", join(here, "..", "src-tauri", "src", "runtime_extensions", "protocol.rs"), "const CANVAS_RESET", "\"</style>\""],
];

for (const [name, path, from, to] of guests) {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(from);
  assert(start >= 0, `the canvas rule is gone from the ${name} copy`);
  const injected = source.slice(start, source.indexOf(to, start));
  assert(injected.length > 0, `the canvas rule is gone from the ${name} copy`);
  check(name, injected);
}

function check(name, injected) {

// The rule is removed rather than satisfied: with no scheme on the root there
// is no colour to substitute.
  assert(
    /color-scheme:\s*normal\s*!important/.test(injected),
    `${name}: the root must not keep a color-scheme — that is what paints the canvas`,
  );

// What `color-scheme: dark` was wanted for is put back where it changes
// rendering instead of the canvas.
  assert(
    /scrollbar-color:/.test(injected),
    `${name}: dropping the root scheme costs the dark scrollbar unless it is set directly`,
  );
  assert(
    /input[^"]*\{color-scheme:dark/.test(injected.replace(/\s+/g, "")) ||
      /input,.*color-scheme:dark/.test(injected),
    `${name}: form controls still need the dark scheme`,
  );

// The second line of defence, and the number that makes it one.
  const alpha = injected.match(/background-color:rgba\(0,0,0,([\d.]+)\)/);
  assert(alpha, `${name}: the root keeps a non-transparent background as a second defence`);
  assert(
    Number(alpha[1]) >= 0.004,
    `${name}: alpha ${alpha[1]} computes to transparent — 8-bit quantisation makes anything under 1/255 a no-op`,
  );

// The exact shape of the first failed fix must not come back.
  assert(
    !/:root\{[^}]*background:\s*transparent\s*!important/.test(injected.replace(/\s+/g, "")),
    `${name}: forcing the root transparent is the bug, not the fix`,
  );
}

console.log("runtimeCanvasTransparency.assert.mjs: ok");
