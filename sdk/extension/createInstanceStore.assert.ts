// SPDX-License-Identifier: MIT
/**
 * Asserts for instanceStorageKey + createInstanceStore.
 * Run: npx tsx sdk/extension/createInstanceStore.assert.ts
 */
import { instanceStorageKey } from "./instanceStorageKey";
import { createInstanceStore } from "./createInstanceStore";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// --- instanceStorageKey ---
{
  assert(
    instanceStorageKey("clock", "abc") === "kavibay:clock:abc",
    "canonical key shape kavibay:<extId>:<instanceId>",
  );
  assert(
    instanceStorageKey("notes", "x-1") === "kavibay:notes:x-1",
    "works for other extension ids",
  );
}

// --- createInstanceStore ---
{
  type Settings = { label: string; n: number };
  const persisted = new Map<string, Settings>();

  const store = createInstanceStore<Settings>({
    load: (id) => persisted.get(id) ?? { label: "default", n: 0 },
    save: (id, value) => {
      persisted.set(id, value);
    },
    normalize: (raw) => {
      const o = raw && typeof raw === "object" ? (raw as Partial<Settings>) : {};
      return {
        label: typeof o.label === "string" ? o.label : "default",
        n: typeof o.n === "number" ? o.n : 0,
      };
    },
  });

  const a = store.use("a");
  assert(a.state.value.label === "default" && a.state.value.n === 0, "load defaults");

  a.update({ n: 3 });
  assert(a.state.value.n === 3, "update merges partial");
  assert(persisted.get("a")?.n === 3, "update persists");

  const aAgain = store.use("a");
  assert(aAgain.state === a.state, "same instance returns cached ref");

  store.seedFrom("a", "b");
  const b = store.use("b");
  assert(b.state.value.n === 3 && b.state.value.label === "default", "seed copies value");
  assert(persisted.get("b")?.n === 3, "seed persists target");
  assert(b.state !== a.state, "seed creates a distinct ref");

  a.update({ label: "changed" });
  assert(b.state.value.label === "default", "seeded instance is independent");

  store.dispose("a");
  const aFresh = store.use("a");
  assert(aFresh.state !== a.state, "dispose drops cache");
  assert(aFresh.state.value.label === "changed", "dispose keeps persisted data");
}

console.log("createInstanceStore.assert.ts: ok");
