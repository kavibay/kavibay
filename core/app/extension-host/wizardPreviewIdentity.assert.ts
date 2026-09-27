import { InstanceDataStore } from "./data-store";
import { migrateWizardPreviewData, wizardPreviewIdentity } from "./wizardPreviewIdentity";
import { handleBridgeMessage } from "../runtime/bridgeProtocol";
import { loadRuntimeInstanceJson, saveRuntimeInstanceJson } from "../runtime/runtimeStorage";

function equal(actual: unknown, expected: unknown, message = "values match") {
  if (!Object.is(actual, expected)) throw new Error(`${message}: ${JSON.stringify(actual)}`);
}
function deepEqual(actual: unknown, expected: unknown, message = "values match") {
  equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

const cells = new Map<string, string>();
const storage: Storage = {
  get length() { return cells.size; },
  key: (i) => [...cells.keys()][i] ?? null,
  getItem: (key) => cells.get(key) ?? null,
  setItem: (key, value) => { cells.set(key, value); },
  removeItem: (key) => { cells.delete(key); },
  clear: () => cells.clear(),
};
const data = new InstanceDataStore({ ...storage, keys: () => [...cells.keys()] });
const draft = wizardPreviewIdentity("__draft__water");
const saved = wizardPreviewIdentity("water");

await data.scoped(draft.instanceId).set("glasses", 3);
equal(await data.scoped(saved.instanceId).get("glasses"), 3,
  "publishing and reopening reads the same preview data");
equal(await data.scoped(wizardPreviewIdentity("weather").instanceId).get("glasses"), undefined,
  "switching to another package does not inherit the previous preview");
equal(await data.scoped("desk-water").get("glasses"), undefined,
  "preview data stays separate from desk instances");

await data.scoped(draft.legacyDraftInstanceId).set("glasses", 1);
await data.scoped(draft.legacyDraftInstanceId).set("goal", 8);
migrateWizardPreviewData("__draft__water", "contract", data, storage);
equal(await data.scoped(saved.instanceId).get("glasses"), 3, "existing saved values win");
equal(await data.scoped(saved.instanceId).get("goal"), 8, "old draft values survive migration");
await data.scoped(saved.instanceId).delete("goal");
migrateWizardPreviewData("water", "contract", data, storage);
equal(await data.scoped(saved.instanceId).get("goal"), undefined,
  "reopening does not restore a deliberately deleted value");

saveRuntimeInstanceJson("__draft__water", draft.legacyDraftInstanceId, { glasses: 4 }, storage);
migrateWizardPreviewData("water", "runtime", data, storage);
const identity = {
  extId: "__draft__water", instanceId: draft.instanceId, storageExtId: draft.packageId,
  grantedPermissions: ["storage.instance"],
};
const read = () => handleBridgeMessage(
  { type: "kavibay.ext.storage.get", requestId: "get" }, identity, storage,
);
deepEqual(read(), {
  type: "kavibay.ext.storage.result", requestId: "get", ok: true, value: { glasses: 4 },
});
const write = {
  type: "kavibay.ext.storage.set" as const, requestId: "set", value: { glasses: 5 },
  extId: "victim", instanceId: "victim", storageExtId: "victim",
};
handleBridgeMessage(write, identity, storage);
identity.extId = "water";
deepEqual(read(), {
  type: "kavibay.ext.storage.result", requestId: "get", ok: true, value: { glasses: 5 },
}, "publishing runtime code also retains its preview storage");
equal(loadRuntimeInstanceJson("victim", "victim", storage), null,
  "a payload cannot redirect the host-owned storage namespace");
deepEqual(handleBridgeMessage(write, { ...identity, grantedPermissions: [] }, storage), {
  type: "kavibay.ext.storage.result", requestId: "set", ok: false,
  error: "permission denied: storage.instance",
}, "a stable preview namespace does not grant storage permission");

console.log("wizard preview identity assertions passed");
