/**
 * Runs the three verify steps concurrently — `npm run verify`.
 *
 * They are independent: typecheck reads types, eslint reads style, the assert
 * files run pure logic. Sequentially they cost the sum of all three; the
 * machine has cores to spare, so the wall clock is the slowest one instead.
 *
 * Each step is spawned on this same node binary rather than through `npm run`
 * or a .bin shim, for the reason spelled out in runAsserts.mjs: on Windows the
 * shim is a .cmd that boots npm again, and that startup dwarfs some of the
 * steps it wraps.
 *
 * Output is buffered per step and printed when that step finishes, so three
 * concurrent writers cannot interleave into nonsense. Every step runs to
 * completion even after one fails — a contributor should see all the breakage
 * in one pass, not the first item of it.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (...parts) => join(repoRoot, "node_modules", ...parts);

const STEPS = [
  { name: "typecheck", args: [bin("vue-tsc", "bin", "vue-tsc.js"), "--noEmit"] },
  { name: "lint", args: [bin("eslint", "bin", "eslint.js"), "."] },
  { name: "asserts", args: [join(repoRoot, "scripts", "runAsserts.mjs")] },
];

function run(step) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, step.args, { cwd: repoRoot });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    const finish = (code) =>
      resolve({ ...step, code, output: output.trimEnd(), ms: Date.now() - startedAt });
    child.on("close", finish);
    child.on("error", (err) => {
      output += String(err);
      finish(1);
    });
  });
}

console.log(`Running ${STEPS.length} verify steps concurrently\n`);

const results = await Promise.all(
  STEPS.map(async (step) => {
    const result = await run(step);
    const seconds = (result.ms / 1000).toFixed(1);
    console.log(`  ${result.code === 0 ? "ok  " : "FAIL"}  ${result.name} (${seconds}s)`);
    return result;
  }),
);

const failures = results.filter((result) => result.code !== 0);
for (const result of failures) {
  console.error(`\n${"=".repeat(60)}\nFAILED  ${result.name}\n\n${result.output}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${STEPS.length} verify steps failed.`);
  process.exit(1);
}

// eslint warnings do not fail the build, so a green run still has something to
// say. Print the steps that produced output rather than swallowing it.
for (const result of results.filter((r) => r.output)) {
  console.log(`\n--- ${result.name} ---\n${result.output}`);
}
console.log(`\nAll ${STEPS.length} verify steps passed.`);
