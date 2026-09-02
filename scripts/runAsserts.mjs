/**
 * Runs every colocated `*.assert.ts` / `*.assert.mjs` in the repo.
 *
 * The project deliberately has no test framework (AGENTS.md): pure logic gets a
 * colocated assert file with plain node asserts. This is only the aggregator so
 * CI and humans have one entry point — `npm run test:assert`.
 *
 * It keeps going after a failure and prints every broken file at the end. A
 * contributor should see all of them in one run, not one per push.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// `.claude` holds git worktrees, each a full checkout of this repo. Without it
// every assert file runs twice — once here, once in each worktree — and a
// failure is reported against a path that is not the one being edited.
const SKIP_DIRS = new Set(["node_modules", "target", "dist", ".git", "gen", ".claude"]);
// Spawn tsx's CLI on this same node binary instead of going through `npx`. On
// Windows `npx` is a .cmd shim that needs `shell: true` and boots npm itself:
// ~2.1s of startup per file against ~0.3s direct, and it is paid 111 times.
const TSX_CLI = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

function collect(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(join(dir, entry.name), found);
    } else if (/\.assert\.(ts|mts|mjs)$/.test(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function run(file) {
  return new Promise((resolve) => {
    // tsx resolves the extensionless relative imports the assert files use;
    // node's own type stripping does not.
    const child = spawn(process.execPath, [TSX_CLI, file], {
      cwd: repoRoot,
    });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    child.on("close", (code) => resolve({ file, code, output }));
    child.on("error", (err) => resolve({ file, code: 1, output: String(err) }));
  });
}

const files = collect(repoRoot).sort();
if (files.length === 0) {
  console.error("No *.assert files found — did the glob roots move?");
  process.exit(1);
}

const queue = [...files];
const failures = [];
let done = 0;

async function worker() {
  for (let file = queue.shift(); file; file = queue.shift()) {
    const result = await run(file);
    const name = relative(repoRoot, result.file).split(sep).join("/");
    done += 1;
    const counter = String(done).padStart(String(files.length).length, " ");
    if (result.code === 0) {
      console.log(`  ${counter}/${files.length} ok    ${name}`);
    } else {
      console.log(`  ${counter}/${files.length} FAIL  ${name}`);
      failures.push({ name, output: result.output.trimEnd() });
    }
  }
}

const parallel = Math.min(Math.max(cpus().length - 1, 1), 8);
console.log(`Running ${files.length} assert files (${parallel} at a time)\n`);
await Promise.all(Array.from({ length: parallel }, worker));

if (failures.length > 0) {
  console.error(`\n${"=".repeat(60)}`);
  for (const failure of failures) {
    console.error(`\nFAILED  ${failure.name}\n${failure.output}`);
  }
  console.error(`\n${failures.length} of ${files.length} assert files failed.`);
  process.exit(1);
}

console.log(`\nAll ${files.length} assert files passed.`);
