/**
 * CI guard for the built contract guest.
 *
 * Run: node scripts/contractGuestArtifact.assert.mjs
 *
 * This artifact is committed and embedded into the binary at compile time, then
 * served into widget packages. Every property below fails silently if lost: a
 * stale build ships yesterday's protocol into somebody else's package, and a
 * module build does not load at all inside an opaque origin — with the only
 * trace being a console line in a frame nobody has open.
 */
import { readFileSync } from "node:fs";
import { HASH_MARKER, TARGET, sourceHash } from "./contractGuest.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let built;
try {
  built = readFileSync(TARGET, "utf8");
} catch {
  throw new Error(
    "sdk/contract-guest/kavibay-contract-guest.js is missing. Run `npm run build:guest` — it is committed on purpose, because Rust embeds it at compile time.",
  );
}

// --- current ---
// `.trim()` because the artifact is checked out with the platform's line
// endings too, so splitting on "\n" leaves a carriage return on the value.
const declared = built
  .split("\n")
  .find((line) => line.startsWith(HASH_MARKER))
  ?.slice(HASH_MARKER.length)
  .trim();
assert(declared, "the built guest carries no source fingerprint; rebuild with `npm run build:guest`");
assert(
  declared === sourceHash(),
  "sdk/contract-guest/kavibay-contract-guest.js is stale: guest.ts or sandbox-guest.ts changed since it was built. Run `npm run build:guest`.",
);

// --- classic, not a module ---
/**
 * An opaque origin makes every `type="module"` fetch cross-origin, so a module
 * build cannot be loaded by the frame it exists for. Finding 17.
 */
assert(
  !/^\s*(import|export)\s/m.test(built),
  "the built guest contains module syntax: it must be an IIFE, because a module script cannot load inside sandbox=\"allow-scripts\"",
);

// --- it is what a package calls ---
assert(
  /window\.kavibayWidget\s*=/.test(built),
  "the built guest does not define window.kavibayWidget, which is the only entry point a package has",
);

// --- and it did not swallow the app ---
/**
 * The guest imports nothing from the host on purpose: no Vue, no registry, no
 * host code. If one of those crept in through an import, this file would be
 * hundreds of kilobytes rather than single digits, and every package would
 * carry it.
 */
const kb = Buffer.byteLength(built) / 1024;
assert(kb < 40, `the built guest is ${kb.toFixed(0)} kB — something pulled the app into it; it should be single-digit`);

console.log("contractGuestArtifact.assert.mjs: ok");
