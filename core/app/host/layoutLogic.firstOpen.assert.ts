/**
 * First-open one-shot: fresh installs reveal the search bar once.
 * Run: npx tsx core/app/host/layoutLogic.firstOpen.assert.ts
 */
import {
  FIRST_OPEN_KEY,
  consumeFirstOpen,
  markFirstOpenDone,
} from "./layoutLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const mem = new Map<string, string>();
const store = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, v);
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
};
(globalThis as { localStorage: typeof store }).localStorage = store;

mem.clear();
assert(consumeFirstOpen() === true, "first call consumes");
assert(mem.get(FIRST_OPEN_KEY) === "1", "marker written");
assert(consumeFirstOpen() === false, "second call is no-op");

mem.clear();
markFirstOpenDone();
assert(consumeFirstOpen() === false, "markFirstOpenDone blocks consume");

console.log("layoutLogic.firstOpen.assert.ts: ok");
