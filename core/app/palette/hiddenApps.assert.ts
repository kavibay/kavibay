/**
 * Asserts for palette hidden-apps helpers.
 * Run: npx tsx core/app/palette/hiddenApps.assert.ts
 */
import {
  hideApp,
  hiddenAppKey,
  isAppHidden,
  normalizeHiddenApps,
  unhideApp,
} from "./hiddenApps";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const pathA = "C:\\Program Files\\Dell\\SupportAssist.exe";
const pathB = "C:\\Users\\x\\Desktop\\SupportAssist.lnk";
const name = "Dell SupportAssist";

const keyA = hiddenAppKey(name, pathA);
const keyB = hiddenAppKey(name, pathB);
assert(Boolean(keyA), "key from name");
assert(keyA === keyB, "name-based key shared across paths");

let hidden = new Set<string>();
assert(!isAppHidden(hidden, name, pathA), "starts visible");

hidden = hideApp(hidden, name, pathA);
assert(isAppHidden(hidden, name, pathA), "hidden by path A");
assert(isAppHidden(hidden, name, pathB), "same name hidden via path B");

hidden = unhideApp(hidden, name, pathB);
assert(!isAppHidden(hidden, name, pathA), "unhide clears name key");

assert(normalizeHiddenApps(null).size === 0, "null → empty");
assert(normalizeHiddenApps(["a", "", 1, "b"]).size === 2, "keeps strings");

const again = hideApp(hidden, name, pathA);
const noop = hideApp(again, name, pathA);
assert(noop.size === again.size, "hide is idempotent");

console.log("hiddenApps.assert.ts: ok");
