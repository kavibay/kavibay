function equal(actual: unknown, expected: unknown, message = "values differ"): void {
  if (!Object.is(actual, expected)) throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
function deepEqual(actual: unknown, expected: unknown, message = "values differ"): void {
  equal(JSON.stringify(actual), JSON.stringify(expected), message);
}
import { durableStorageFailures, hydrateDurableStorage, retryDurableStorage } from "./durableStorage";

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const local = new MemoryStorage();
let state: string | null = '{"kavibay:note":"old note"}';
let settings: string | null = '{"appearance":{"colorMode":"dark"}}';
let failWrite = false;
let failLoad = false;
const writes: string[] = [];
const invoke = async (command: string, args?: { value?: string; sections?: unknown }) => {
  if (command === "web_storage_load") {
    if (failLoad) throw new Error("disk unavailable");
    return state;
  }
  if (command === "settings_load") return settings;
  if (command === "web_storage_save") {
    if (failWrite) throw new Error("disk full");
    state = args!.value!;
    writes.push(state);
  } else if (command === "settings_save_sections") settings = JSON.stringify(args!.sections);
};
Object.defineProperties(globalThis, {
  Storage: { configurable: true, value: MemoryStorage },
  localStorage: { configurable: true, value: local },
  window: { configurable: true, value: { __TAURI_INTERNALS__: { invoke }, addEventListener() {} } },
  document: { configurable: true, value: { addEventListener() {} } },
});

await hydrateDurableStorage();
equal(local.getItem("kavibay:note"), "old note");
local.setItem("kavibay:note", "new note");
failWrite = true;
await retryDurableStorage();
deepEqual(durableStorageFailures.value, [{ file: "state", operation: "save", detail: "disk full" }]);
equal(JSON.parse(state!)["kavibay:note"], "old note");
equal(local.getItem("kavibay:note"), "new note");
failWrite = false;
await retryDurableStorage();
equal(JSON.parse(state!)["kavibay:note"], "new note");
deepEqual(durableStorageFailures.value, []);

failLoad = true;
await hydrateDurableStorage();
const countBeforeBlockedSave = writes.length;
local.setItem("kavibay:note", "work written during a failed load");
await retryDurableStorage();
equal(writes.length, countBeforeBlockedSave, "retry never replaces a file that could not be read");
deepEqual(durableStorageFailures.value, [{ file: "state", operation: "load", detail: "disk unavailable" }]);
equal(JSON.parse(state!)["kavibay:note"], "new note");

failLoad = false;
state = "[]";
await hydrateDurableStorage();
await retryDurableStorage();
equal(state, "[]", "invalid loaded data is protected too");
equal(durableStorageFailures.value[0]?.operation, "load");
console.log("durable storage failure/retry assertions passed");
