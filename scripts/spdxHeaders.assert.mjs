/**
 * CI guard: `sdk/**` and `examples/**` are MIT islands inside a GPL repo, and
 * that only holds if every file says so. AGENTS.md requires an SPDX header
 * there; this makes a missing one a failed check instead of a licensing
 * question three months later.
 *
 * Run: node scripts/spdxHeaders.assert.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["sdk", "examples"];
const EXPECTED = "SPDX-License-Identifier: MIT";
const SOURCE = /\.(ts|mts|tsx|js|mjs|jsx|vue|css)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "target"]);

function collect(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(join(dir, entry.name), found);
    } else if (SOURCE.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

const missing = [];
let checked = 0;

for (const root of ROOTS) {
  for (const file of collect(join(repoRoot, root))) {
    checked += 1;
    // Header, not body: only the first few lines count as a file-level license.
    const head = readFileSync(file, "utf8").split(/\r?\n/, 8).join("\n");
    if (!head.includes(EXPECTED)) missing.push(relative(repoRoot, file).split(sep).join("/"));
  }
}

if (missing.length > 0) {
  throw new Error(
    `spdxHeaders: ${missing.length} file(s) under ${ROOTS.join("/ and ")}/ lack a "${EXPECTED}" header ` +
      `in their first lines:\n  ${missing.join("\n  ")}`,
  );
}

console.log(`spdxHeaders.assert.mjs: ok (${checked} files)`);
