/**
 * CI guard: the app version lives in three files and they must agree.
 *
 * A release with drifted versions ships an installer whose "about" screen lies,
 * and the tag no longer identifies the binary. Bumping stays manual — this only
 * makes forgetting one of the three loud.
 *
 * Run: node scripts/versionSync.assert.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(repoRoot, ...parts), "utf8");

const versions = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri", "tauri.conf.json")).version,
  // Only the [package] version — dependency versions must not match here.
  "src-tauri/Cargo.toml": read("src-tauri", "Cargo.toml")
    .split(/^\[/m)[1]
    ?.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1],
};

for (const [file, version] of Object.entries(versions)) {
  if (!version) throw new Error(`versionSync: could not read a version from ${file}`);
}

const unique = [...new Set(Object.values(versions))];
if (unique.length !== 1) {
  const detail = Object.entries(versions)
    .map(([file, version]) => `  ${version.padEnd(12)} ${file}`)
    .join("\n");
  throw new Error(`versionSync: versions differ — bump all three:\n${detail}`);
}

console.log(`versionSync.assert.mjs: ok (${unique[0]})`);
