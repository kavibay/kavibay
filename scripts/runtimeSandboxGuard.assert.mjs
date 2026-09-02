/**
 * CI guard: RuntimeExtensionFrame must keep sandbox="allow-scripts" only.
 * Fail if allow-same-origin appears or the sandbox attribute is dropped.
 *
 * Run: node scripts/runtimeSandboxGuard.assert.mjs
 * (Also: npx tsx scripts/runtimeSandboxGuard.assert.mjs — same file.)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const here = dirname(fileURLToPath(import.meta.url));
const framePath = join(here, "..", "core", "app", "runtime", "RuntimeExtensionFrame.vue");
const source = readFileSync(framePath, "utf8");

assert(
  !/\ballow-same-origin\b/.test(source),
  "RuntimeExtensionFrame.vue must not contain allow-same-origin (opaque origin isolation)",
);

assert(
  /sandbox\s*=\s*["']allow-scripts["']/.test(source),
  'RuntimeExtensionFrame.vue must keep sandbox="allow-scripts" (exactly)',
);

// Ensure we didn't accidentally widen via a bound attribute without the literal.
assert(
  !/:sandbox\s*=/.test(source),
  "RuntimeExtensionFrame.vue must use a static sandbox attribute (not :sandbox=)",
);

console.log("runtimeSandboxGuard.assert.mjs: ok");
