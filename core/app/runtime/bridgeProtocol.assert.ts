/**
 * Run: npx tsx src/core/runtime/bridgeProtocol.assert.ts
 */
import {
  handleBridgeMessage,
  httpFailure,
  isExtToHost,
  popOutcome,
  POP_COOLDOWN_MS,
  type BridgeFrameIdentity,
  type ExtToHost,
  type HostToExt,
} from "./bridgeProtocol";
import { loadRuntimeInstanceJson } from "./runtimeStorage";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Narrows a bridge reply to the storage variant (the union also has http). */
function isStorageReply(
  reply: HostToExt | null,
): reply is Extract<HostToExt, { type: "kavibay.ext.storage.result" }> {
  return reply !== null && reply.type === "kavibay.ext.storage.result";
}

/** Map-backed mock Storage for asserts (no real localStorage). */
function createMockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

const frame: BridgeFrameIdentity = {
  extId: "real-ext",
  instanceId: "inst-a",
  grantedPermissions: ["storage.instance"],
};

// --- type guard ---
assert(isExtToHost({ type: "kavibay.ext.ready", extId: "x" }) === true, "ready ok");
assert(isExtToHost({ type: "nope" }) === false, "unknown type rejected");
assert(isExtToHost(null) === false, "null rejected");

// --- ready → no reply ---
{
  const reply = handleBridgeMessage(
    { type: "kavibay.ext.ready", extId: "spoofed" },
    frame,
  );
  assert(reply === null, "ready produces no reply");
}

// --- deny storage without permission ---
{
  const noPerm: BridgeFrameIdentity = {
    ...frame,
    grantedPermissions: [],
  };
  const reply = handleBridgeMessage(
    {
      type: "kavibay.ext.storage.get",
      requestId: "r1",
      extId: "real-ext",
      instanceId: "inst-a",
    },
    noPerm,
  );
  assert(isStorageReply(reply) && reply.ok === false, "deny without storage.instance");
  assert(
    isStorageReply(reply) && reply.ok === false && reply.requestId === "r1",
    "deny keeps requestId",
  );
}

// --- get/set ignore payload extId & instanceId; use frame identity ---
{
  const storage = createMockStorage();
  const setMsg: ExtToHost = {
    type: "kavibay.ext.storage.set",
    requestId: "s1",
    extId: "attacker-ext",
    instanceId: "attacker-inst",
    value: { n: 42 },
  };
  const setReply = handleBridgeMessage(setMsg, frame, storage);
  assert(isStorageReply(setReply) && setReply.ok === true, "set ok with permission");
  assert(
    JSON.stringify(loadRuntimeInstanceJson("real-ext", "inst-a", storage)) ===
      JSON.stringify({ n: 42 }),
    "set wrote frame extId/instanceId key",
  );
  assert(
    loadRuntimeInstanceJson("attacker-ext", "attacker-inst", storage) === null,
    "set ignored spoofed payload ids",
  );

  const getMsg: ExtToHost = {
    type: "kavibay.ext.storage.get",
    requestId: "g1",
    extId: "attacker-ext",
    instanceId: "attacker-inst",
  };
  const getReply = handleBridgeMessage(getMsg, frame, storage);
  assert(
    isStorageReply(getReply) &&
      getReply.ok === true &&
      JSON.stringify(getReply.value) === JSON.stringify({ n: 42 }),
    "get returns frame-keyed value",
  );
}

// --- get missing → ok null ---
{
  const storage = createMockStorage();
  const reply = handleBridgeMessage(
    {
      type: "kavibay.ext.storage.get",
      requestId: "g2",
      extId: "real-ext",
      instanceId: "inst-a",
    },
    frame,
    storage,
  );
  assert(
    isStorageReply(reply) && reply.ok === true && reply.value === null,
    "missing key returns null value",
  );
}

// --- payload ids are optional: the host binds identity from the frame ---
assert(
  isExtToHost({ type: "kavibay.ext.storage.get", requestId: "r1" }) === true,
  "storage.get without payload ids is accepted",
);
assert(
  isExtToHost({ type: "kavibay.ext.storage.set", requestId: "r1", value: 1 }) === true,
  "storage.set without payload ids is accepted",
);
assert(
  isExtToHost({ type: "kavibay.ext.storage.get" }) === false,
  "a request without an id is still rejected",
);

// --- http calls are recognized but answered asynchronously by the frame ---
assert(
  isExtToHost({ type: "kavibay.ext.http.call", requestId: "r1", endpointId: "forecast" }) ===
    true,
  "http.call shape",
);
assert(
  isExtToHost({ type: "kavibay.ext.http.call", requestId: "r1" }) === false,
  "http.call needs an endpoint id",
);
assert(
  handleBridgeMessage(
    { type: "kavibay.ext.http.call", requestId: "r1", endpointId: "forecast", args: null },
    frame,
    createMockStorage(),
  ) === null,
  "http.call is not answered synchronously",
);

// --- the failure helper produces a complete, safe result shape ---
{
  const reply = httpFailure("r1", "permission_denied");
  assert(reply.type === "kavibay.ext.http.result", "failure is an http result");
  if (reply.type === "kavibay.ext.http.result") {
    assert(reply.result.ok === false, "failure is not ok");
    assert(reply.result.code === "permission_denied", "failure carries the code");
    assert(reply.result.data === null, "failure carries no data");
  }
}

// --- pop: recognized, answered by the frame, gated by grant and cooldown ---
assert(isExtToHost({ type: "kavibay.ext.pop", requestId: "r1" }) === true, "pop shape");
assert(isExtToHost({ type: "kavibay.ext.pop", sound: true }) === false, "pop needs a request id");
assert(
  handleBridgeMessage({ type: "kavibay.ext.pop", requestId: "r1" }, frame, createMockStorage()) ===
    null,
  "pop is answered by the frame",
);
assert(popOutcome(["storage.instance"], null, 0) === "denied", "pop without background.pop");
assert(popOutcome(["background.pop"], null, 0) === "raise", "first pop raises");
assert(
  popOutcome(["background.pop"], 1_000, 1_000 + POP_COOLDOWN_MS - 1) === "swallowed",
  "pop inside the cooldown is swallowed",
);
assert(
  popOutcome(["background.pop"], 1_000, 1_000 + POP_COOLDOWN_MS) === "raise",
  "pop after the cooldown raises again",
);

console.log("bridgeProtocol.assert.ts: ok");
