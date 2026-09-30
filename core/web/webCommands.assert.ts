// @ts-nocheck — reads the source tree with node:fs; core/web is typechecked against the browser tsconfig.
/**
 * Every Rust command the app calls has a decision for the web build.
 * Run: npx tsx core/web/webCommands.assert.ts
 *
 * The landing page runs the real app with the backend answered in the browser
 * (`webCommands.ts`). A command the app gains later would otherwise reach the
 * page as an unanswered `null` — nobody sees that until a visitor clicks the
 * one button that needed it. So every `invoke("…")` in the code base must be in
 * exactly one of ANSWERS, NO_OPS or NOT_ON_WEB, and every entry there must
 * still exist in the code.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANSWERS, NOT_ON_WEB, NO_OPS } from "./webCommands";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_DIRS = ["core/app", "sdk", "extensions"];

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sources(path, found);
    } else if (/\.(ts|vue)$/.test(entry.name) && !entry.name.includes(".assert.")) {
      found.push(path);
    }
  }
  return found;
}

const code = SOURCE_DIRS.flatMap((dir) => sources(join(repoRoot, dir)))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const invoked = new Set(
  [...code.matchAll(/invoke(?:<[^()]*>)?\(\s*"([a-z0-9_:|]+)"/g)].map((match) => match[1]!),
);

const tables: Record<string, Set<string>> = {
  ANSWERS: new Set(Object.keys(ANSWERS)),
  NO_OPS,
  NOT_ON_WEB,
};

const unclassified = [...invoked].filter(
  (command) => !Object.values(tables).some((table) => table.has(command)),
).sort();
assert.deepEqual(
  unclassified,
  [],
  `commands with no web answer — add each to ANSWERS, NO_OPS or NOT_ON_WEB in core/web/webCommands.ts:\n  ${unclassified.join("\n  ")}`,
);

for (const [name, table] of Object.entries(tables)) {
  for (const other of Object.keys(tables).filter((key) => key !== name)) {
    const twice = [...table].filter((command) => tables[other]!.has(command));
    assert.deepEqual(twice, [], `in both ${name} and ${other}: ${twice.join(", ")}`);
  }
}

// `plugin:*` commands come from @tauri-apps/api, not from our code. Everything
// else must still be named somewhere, or the entry is dead.
const stale = Object.values(tables)
  .flatMap((table) => [...table])
  .filter((command) => !command.startsWith("plugin:") && !code.includes(`"${command}"`))
  .sort();
assert.deepEqual(stale, [], `listed in webCommands.ts but gone from the app: ${stale.join(", ")}`);

console.log(`webCommands.assert.ts: ok (${invoked.size} commands classified)`);
