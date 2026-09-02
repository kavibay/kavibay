/**
 * Verify Moodist inventory and that every sound file exists on disk
 * (run: npx tsx src/extensions/moodist/catalog.assert.ts).
 *
 * Node-only; does not import catalog.ts (Vite glob).
 */
// @ts-nocheck
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { categoryDefs } from "./soundInventory";
import { moodistIcon, moodistIconIds } from "./icons";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const here = dirname(fileURLToPath(import.meta.url));

assert(categoryDefs.length === 3, "expected 3 categories");
assert(categoryDefs[0]!.id === "nature", "first category must be nature");
assert(categoryDefs[1]!.id === "rain", "second category must be rain");
assert(categoryDefs[2]!.id === "noise", "third category must be noise");

const allSounds = categoryDefs.flatMap((c) => c.sounds);
assert(allSounds.length === 23, `sound defs=${allSounds.length}`);

const iconIds = moodistIconIds();
assert(iconIds.size >= 15 && iconIds.size <= 20, `icon count=${iconIds.size}`);

let assetCount = 0;
for (const cat of categoryDefs) {
  assert(moodistIcon(cat.icon), `missing category icon: ${cat.icon}`);
  for (const s of cat.sounds) {
    assert(moodistIcon(s.icon), `missing sound icon: ${s.icon} (${s.id})`);
    const path = join(here, "sounds", s.file);
    assert(existsSync(path), `missing file for ${s.id}: ${path}`);
    assert(statSync(path).size > 0, `empty file for ${s.id}: ${path}`);
    assetCount += 1;
  }
}

assert(assetCount === 23, `asset count=${assetCount}`);
console.log(`ok catalog.assert (${assetCount} assets, ${iconIds.size} icons)`);
