/**
 * Verify the Moodist inventory: every sound has a file on disk, an icon, and a
 * source it may be shipped under.
 * Run: npx tsx extensions/moodist/catalog.assert.ts
 *
 * Node-only; does not import catalog.ts (Vite glob).
 */
// @ts-nocheck
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { categoryDefs, loopWindow } from "./soundInventory";
import { moodistIcon, moodistIconIds } from "./icons";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const here = dirname(fileURLToPath(import.meta.url));

assert(
  categoryDefs.map((c) => c.id).join(",") === "nature,rain,noise",
  `categories=${categoryDefs.map((c) => c.id).join(",")}`,
);

const allSounds = categoryDefs.flatMap((c) => c.sounds);
const ids = allSounds.map((s) => s.id);
assert(new Set(ids).size === ids.length, `duplicate sound ids: ${ids.join(",")}`);

// Every icon the catalog names exists, and no icon is dead weight.
const used = new Set(categoryDefs.flatMap((c) => [c.icon, ...c.sounds.map((s) => s.icon)]));
for (const icon of used) assert(moodistIcon(icon), `missing icon: ${icon}`);
const unused = [...moodistIconIds()].filter((icon) => !used.has(icon));
assert(unused.length === 0, `icons no sound uses: ${unused.join(", ")}`);

// Where each sound comes from. This is the record upstream Moodist never kept:
// a recording without a verifiable CC0 source does not ship.
const licenses = readFileSync(join(here, "LICENSES.md"), "utf8");
for (const sound of allSounds) {
  const { source } = sound;
  if (source.kind === "freesound") {
    assert(source.license === "CC0-1.0", `${sound.id}: licence ${source.license}`);
    assert(
      new RegExp(`^https://freesound\\.org/people/[^/]+/sounds/${source.id}/$`).test(source.url),
      `${sound.id}: url ${source.url} does not name freesound ${source.id}`,
    );
    assert(licenses.includes(source.url), `${sound.id}: ${source.url} is not listed in LICENSES.md`);
    assert(source.cut.length > 0 && source.cut.start >= 0, `${sound.id}: bad cut`);
    assert(sound.file?.endsWith(".webm"), `${sound.id}: recordings ship as Opus/WebM (buildSounds.mts)`);
  } else {
    assert(source.kind === "generated", `${sound.id}: unknown source kind`);
    assert(sound.file === undefined, `${sound.id}: generated noise ships no file (noise.ts)`);
  }
  const loop = loopWindow(sound);
  assert(loop.end > loop.start, `${sound.id}: empty loop window`);
}

// Nothing on disk that the inventory does not name: a recording dropped back
// into sounds/ would ship in every build without anyone checking its licence.
const listed = new Set(allSounds.flatMap((s) => (s.file ? [s.file] : [])));
const onDisk = (dir: string, prefix = ""): string[] =>
  readdirSync(join(here, "sounds", dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? onDisk(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
const unlisted = onDisk("").filter((file) => !listed.has(file));
assert(unlisted.length === 0, `sound files not in the inventory: ${unlisted.join(", ")}`);

for (const sound of allSounds) {
  if (!sound.file) continue;
  const path = join(here, "sounds", sound.file);
  assert(existsSync(path), `missing file for ${sound.id}: ${path}`);
  assert(statSync(path).size > 0, `empty file for ${sound.id}: ${path}`);
}

console.log(`ok catalog.assert (${allSounds.length} sounds, ${used.size} icons)`);
