// SPDX-License-Identifier: MIT
import { storageReadPromise } from "./sandbox-guest";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }
function throws(action: () => unknown) {
  let message = "";
  try { action(); } catch (error) { message = String(error); }
  assert(message.includes("Use await ctx.data.get"), "missing await has an actionable error");
}
const read = () => storageReadPromise(Promise.resolve({ glasses: 3 }), "ctx.data.get(key)");
let saved = { glasses: 3 };
throws(() => {
  const pending = read() as unknown as typeof saved;
  saved = { glasses: pending?.glasses ?? 0 };
});
assert(saved.glasses === 3, "a missing await cannot silently replace saved data with defaults");
throws(() => ({ ...read() }));
throws(() => JSON.stringify(read()));
assert((await read()).glasses === 3, "await resolves the saved value");
assert(await read().then(value => value.glasses) === 3, "then resolves the saved value");
assert((await Promise.all([read(), read()])).every(value => value.glasses === 3), "parallel reads work");
assert(read() instanceof Promise, "the return value remains a Promise");
let finalized = false;
await read().finally(() => { finalized = true; });
assert(finalized, "finally runs");
const failure = new Error("Storage unavailable");
let caught: unknown;
try { await storageReadPromise(Promise.reject(failure), "ctx.data.get(key)"); } catch (error) { caught = error; }
assert(caught === failure, "await preserves storage errors");
assert(await storageReadPromise(Promise.reject(failure), "ctx.data.get(key)").catch(e => e) === failure, "catch preserves errors");
console.log("storage-read.assert: ok");
