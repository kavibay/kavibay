/**
 * CI guard: both guests must report what goes wrong inside their frame.
 *
 * Run: node scripts/guestFaultReporting.assert.mjs
 *
 * WHY A GREP AND NOT A TEST. There are two guests — `guest.ts` for contract
 * packages, `kavibay-runtime.js` for runtime packages — and they share no
 * module system, because one is compiled and the other is served to third-party
 * packages as-is. So the reporting exists twice, and the behaviour of the
 * compiled one is covered properly by `guest-fault.assert.ts`. What no test can
 * see is the hand-written twin quietly falling behind, or either one losing the
 * `window` listeners in a refactor.
 *
 * The failure being prevented is specific and silent: the widget renders blank,
 * the browser writes a perfectly good message to a console inside a sandboxed
 * frame that cannot be opened, and the debug panel says "nothing yet" — which
 * reads as "nothing happened" rather than "the reporting is gone".
 *
 * ORDER IS PART OF IT. Both must install before the package's own script runs.
 * A listener added afterwards misses the parse error and the top-level throw,
 * which are exactly the failures that leave no other trace, since the widget
 * then never registers and the host never hears anything at all.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(repoRoot, ...parts), "utf8");

// --- the contract guest ------------------------------------------------------
{
  const source = read("sdk", "extension", "contract", "guest.ts");
  assert(
    /installFaultReporting\s*\(/.test(source),
    "guest.ts must call installFaultReporting; without it a contract package that throws is a blank frame with an empty debug panel",
  );
  // Before the port, and so before anything a package can reach.
  const install = source.indexOf("installFaultReporting(");
  const port = source.indexOf("new SandboxGuestPort");
  assert(
    install !== -1 && port !== -1 && install < port,
    "guest.ts must install fault reporting before the guest port, so a failure during startup is still reported",
  );
}

// --- the runtime guest -------------------------------------------------------
{
  const source = read("sdk", "runtime", "kavibay-runtime.js");
  for (const [pattern, what] of [
    [/addEventListener\(\s*["']error["']/, "uncaught throws"],
    [/addEventListener\(\s*["']unhandledrejection["']/, "promises nobody awaited"],
    [/console\.error\s*=/, "the widget's own console.error"],
    [/["']kavibay\.ext\.fault["']/, "the message the host listens for"],
  ]) {
    assert(
      pattern.test(source),
      `kavibay-runtime.js must report ${what} — it is the hand-written twin of installFaultReporting and has fallen behind`,
    );
  }
  // The capture-phase listener is the only way a <script src> that 404s is
  // heard at all: resource errors do not bubble and carry no message.
  assert(
    /addEventListener\(\s*\n?\s*["']error["'][\s\S]{0,600}?true,?\s*\n?\s*\)/.test(source),
    "kavibay-runtime.js must keep the capture-phase error listener, or a script that fails to load stays silent",
  );

  const install = source.indexOf("installFaultReporting");
  const bridge = source.indexOf("REQUEST_TIMEOUT_MS");
  assert(
    install !== -1 && bridge !== -1 && install < bridge,
    "kavibay-runtime.js must install fault reporting before the bridge below it",
  );
}

// --- the host end ------------------------------------------------------------
// A guest that reports into a host that drops the message is the same outage
// with more steps.
{
  const frame = read("core", "app", "runtime", "RuntimeExtensionFrame.vue");
  assert(
    /kavibay\.ext\.fault/.test(frame) && /reportWidgetFault/.test(frame),
    "RuntimeExtensionFrame.vue must route kavibay.ext.fault into the widget log",
  );

  const sandboxed = read("core", "app", "extension-host", "ui", "SandboxedWidgetFrame.vue");
  assert(
    /readFault\s*\(/.test(sandboxed) && /onFault/.test(sandboxed),
    "SandboxedWidgetFrame.vue must route readFault() into the widget log",
  );

  const protocol = read("core", "app", "runtime", "bridgeProtocol.ts");
  assert(
    /case "kavibay\.ext\.fault":/.test(protocol),
    "isExtToHost must accept kavibay.ext.fault, or every runtime-package fault is dropped as an unknown message",
  );
}

console.log("guestFaultReporting.assert.mjs: ok");
