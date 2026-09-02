import { InstanceDataStore, type StorageBackend } from "./data-store";

/**
 * Asserts for the widget data store.
 * Run: npx tsx core/app/extension-host/data-store.assert.ts
 *
 * Everything here runs against an injected fake backend, deliberately. The
 * real backend moves to Rust, so pinning behaviour to localStorage would be
 * testing a detail that is on its way out — and would drag a DOM into a suite
 * that runs under `tsx`. What has to survive the swap is the contract the
 * store keeps with whatever sits underneath it: what it writes, when it
 * refuses, and that nothing is cached above the backend.
 */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); return undefined; } catch (e) { return e; }
}

/** Records every call, so the tests can assert on what reached the backend. */
function fakeBackend() {
  const cells = new Map<string, string>();
  const writes: string[] = [];
  const backend: StorageBackend = {
    getItem: (k) => cells.get(k) ?? null,
    setItem: (k, v) => { writes.push(k); cells.set(k, v); },
    removeItem: (k) => { cells.delete(k); },
    keys: () => [...cells.keys()],
  };
  return { backend, cells, writes };
}

// --- round-trip and delete ---
{
  const { backend } = fakeBackend();
  const data = new InstanceDataStore(backend).scoped("inst-a");

  assert((await data.get("missing")) === undefined, "unset key reads as undefined");

  await data.set("items", [{ id: "1", text: "Buy milk", done: false }]);
  const back = await data.get<{ text: string }[]>("items");
  assert(back?.[0]?.text === "Buy milk", "value round-trips through the backend");

  await data.delete("items");
  assert((await data.get("items")) === undefined, "delete removes the value");
}

// --- scoping: the isolation the contract promises ---
{
  const { backend } = fakeBackend();
  const store = new InstanceDataStore(backend);
  const a = store.scoped("inst-a");
  const b = store.scoped("inst-b");

  await a.set("items", ["a-only"]);
  assert((await b.get("items")) === undefined, "one instance cannot read another's key");

  await b.set("items", ["b-only"]);
  const readA = await a.get<string[]>("items");
  assert(readA?.[0] === "a-only", "a later write by another instance does not clobber the first");
}

// --- extension-scoped shared state ----------------------------------------
{
  const { backend } = fakeBackend();
  const store = new InstanceDataStore(backend);
  const first = store.shared("kavibay.emoji-picker");
  const second = store.shared("kavibay.emoji-picker");
  const other = store.shared("kavibay.snippets");

  await first.set("state", { recent: ["😀"] });
  assert((await second.get<{ recent: string[] }>("state"))?.recent[0] === "😀", "shared scope is visible to every instance");
  assert((await other.get("state")) === undefined, "shared scopes remain isolated by extension");
}

// --- nothing is cached above the backend ---
{
  const { backend } = fakeBackend();
  await new InstanceDataStore(backend).scoped("inst-a").set("items", ["persisted"]);

  // A fresh store over the same backend is the closest stand-in for a reload.
  const reread = await new InstanceDataStore(backend).scoped("inst-a").get<string[]>("items");
  assert(reread?.[0] === "persisted", "a new store over the same backend sees prior writes");
}

// --- quota ---
{
  const { backend, cells } = fakeBackend();
  const data = new InstanceDataStore(backend).scoped("inst-a");

  const err = await caught(() => data.set("big", "x".repeat(300_000)));
  assert(err instanceof Error, "over-quota write throws");
  assert(cells.size === 0, "a refused write reaches the backend not at all");

  await data.set("ok", "x".repeat(1000));
  assert((await data.get<string>("ok"))?.length === 1000, "an under-quota write still succeeds");
}

// --- keys and values the store must refuse ---
{
  const { backend } = fakeBackend();
  const data = new InstanceDataStore(backend).scoped("inst-a");

  // The separator is what makes `<instance><NUL><key>` unambiguous; a key
  // carrying one could otherwise address a different instance's cell.
  const badKey = await caught(() => data.set("a\0b", 1));
  assert(badKey instanceof Error, "a key containing the separator is refused");

  const badValue = await caught(() => data.set("fn", undefined));
  assert(badValue instanceof Error, "a value that does not survive JSON is refused");
}

// --- evict ---
{
  const { backend, cells } = fakeBackend();
  const store = new InstanceDataStore(backend);
  await store.scoped("inst-a").set("one", 1);
  await store.scoped("inst-a").set("two", 2);
  await store.scoped("inst-b").set("one", 1);

  store.evict("inst-a");
  assert((await store.scoped("inst-a").get("one")) === undefined, "evict drops the instance's keys");
  assert((await store.scoped("inst-b").get("one")) === 1, "evict leaves other instances alone");
  assert(cells.size === 1, "evict removes the cells rather than blanking them");
}

// --- clone opted-in instance data ---
{
  const { backend, cells } = fakeBackend();
  const store = new InstanceDataStore(backend);
  await store.scoped("source").set("state", { items: ["keep"] });
  await store.scoped("source").set("other", 42);

  store.clone("source", "copy");
  assert(
    (await store.scoped("copy").get<{ items: string[] }>("state"))?.items[0] === "keep",
    "clone copies all source cells",
  );
  assert((await store.scoped("copy").get<number>("other")) === 42, "clone keeps every key");
  assert(cells.size === 4, "clone leaves source and target cells intact");
}

// --- clone transform keeps extension-owned duplicate semantics -------------
{
  const { backend } = fakeBackend();
  const store = new InstanceDataStore(backend);
  await store.scoped("source").set("state", { sessions: [{ endedAt: null }] });
  await store.scoped("source").set("other", 42);

  store.clone("source", "copy", (key, value) =>
    key === "state" ? { ...(value as object), sessions: [] } : value,
  );
  assert(
    (await store.scoped("copy").get<{ sessions: unknown[] }>("state"))?.sessions.length === 0,
    "clone transform can normalize extension-owned state",
  );
  assert((await store.scoped("copy").get<number>("other")) === 42, "clone transform keeps other cells");
}

// --- a corrupt cell must not brick the widget ---
{
  const { backend, cells } = fakeBackend();
  const store = new InstanceDataStore(backend);
  await store.scoped("inst-a").set("items", ["fine"]);
  const [key] = [...cells.keys()];
  cells.set(key!, "{not json");

  assert((await store.scoped("inst-a").get("items")) === undefined, "unparseable cell reads as undefined");
}

// --- a renamed extension keeps its shared cells ---
{
  const { backend } = fakeBackend();
  const store = new InstanceDataStore(backend);
  await store.shared("local.dssd").set("rooms", ["living"]);
  await store.scoped("inst-a").set("note", "instance data");

  store.renameSharedScope("local.dssd", "local.tadoweather");

  assert(
    JSON.stringify(await store.shared("local.tadoweather").get("rooms")) ===
      JSON.stringify(["living"]),
    "shared cells follow the extension to its new id",
  );
  assert(
    (await store.shared("local.dssd").get("rooms")) === undefined,
    "and are gone from the old scope",
  );
  assert(
    (await store.scoped("inst-a").get("note")) === "instance data",
    "instance data is keyed by instance id and does not move",
  );
}

console.log("data-store.assert.ts: ok");
