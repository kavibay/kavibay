import { ExtensionRegistry } from "./registry";
import { Host } from "./runtime";
import { JsonBridge, type WidgetCall } from "./bridge";
import { tadoExtension } from "./fixtures/tado";
import { todoExtension } from "./fixtures/todo";
import { makeFetcher, makeUi } from "./fixtures/harness";
import type { WidgetInstance } from "@sdk/contract/sdk";

/**
 * Asserts for what the Wizard's debug panel is shown.
 * Run: npx tsx core/app/extension-host/call-log.assert.ts
 *
 * The panel exists because a widget renders its own sentence for a failure and
 * throws the host's answer away. The log is taken at the bridge, which is the
 * one place every capability call crosses, so no widget has to cooperate.
 *
 * The redaction cases are the ones worth pinning: the first version printed an
 * API token in full — into a screenshot that then went into a bug report — and
 * the fix for that over-corrected and hid `keyword` too, because `key` is
 * inside it. Both directions are failures, and only one of them is obvious.
 */

const TADO = "kavibay.tado/tado";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const inst = <T>(definitionId: string, id: string, configuration: T): WidgetInstance<T> =>
  ({ id, definitionId, configuration, position: { x: 0, y: 0 }, size: { w: 2, h: 2 }, mode: "compact" });

async function fixture() {
  const reg = new ExtensionRegistry();
  reg.load(todoExtension, { kind: "bundled" });
  reg.load(tadoExtension, { kind: "bundled" });
  assert(reg.link().length === 0, `fixtures must link: ${JSON.stringify(reg.errors)}`);
  const host = new Host(reg, makeFetcher().fetcher, makeUi({}).ui);
  await host.connect(TADO, { accessToken: "tok" });

  const bridge = new JsonBridge(host);
  const calls: WidgetCall[] = [];
  bridge.onCall = (call) => calls.push(call);
  return { host, bridge, calls };
}

const tile = inst("kavibay.tado/temperature", "i1", { room: "living-room" });

// --- a successful call is recorded with what it was about ---
{
  const { bridge, calls } = await fixture();
  bridge.register(tile);
  const conn = bridge.connect(tile.id, () => {});

  await conn.handle(
    JSON.stringify({ type: "provider.query", provider: TADO, name: "roomState", args: { roomId: "living-room" } }),
  );

  assert(calls.length === 1, `one call recorded, got ${calls.length}`);
  assert(calls[0]!.ok, "and it succeeded");
  assert(calls[0]!.target === `${TADO}.roomState`, `named by provider and query: ${calls[0]!.target}`);
  assert(calls[0]!.instanceId === tile.id, "and attributed to the instance that made it");
}

// --- a refusal keeps the host's own reason ---
{
  const { bridge, calls } = await fixture();
  bridge.register(tile);
  const conn = bridge.connect(tile.id, () => {});

  await conn.handle(
    JSON.stringify({ type: "provider.query", provider: "kavibay.nope/nope", name: "x", args: {} }),
  );

  assert(calls[0]!.ok === false, "a refused call is recorded as failed");
  /**
   * The message, not a summary of it. "Something went wrong" is what the widget
   * would have said; the whole point is the sentence underneath it.
   */
  assert(
    (calls[0]!.detail ?? "").includes("does not declare"),
    `with the host's own words: ${JSON.stringify(calls[0])}`,
  );
}

// --- an endpoint failure is unwrapped, not counted as success ---
{
  const { host, bridge, calls } = await fixture();
  // The transport answers the way the Rust broker does: the wire call works,
  // and the failure is inside the envelope.
  (host as unknown as { widgetTransport?: unknown }).widgetTransport = {
    runtimeHttpCall: async () => ({ ok: false, code: "http_error", status: 401, detail: "Invalid key" }),
  };
  bridge.register(tile);
  const conn = bridge.connect(tile.id, () => {});

  await conn.handle(JSON.stringify({ type: "endpoint.call", endpoint: "waqi_search", args: {} }));

  assert(calls[0]!.ok === false, `an envelope failure is a failure: ${JSON.stringify(calls[0])}`);
  assert(calls[0]!.code === "http_error" && calls[0]!.status === 401, "with its code and status");
}

// --- secrets are redacted, and only secrets ---
{
  const { host, bridge, calls } = await fixture();
  (host as unknown as { widgetTransport?: unknown }).widgetTransport = {
    runtimeHttpCall: async () => ({ ok: true, status: 200, data: {} }),
  };
  bridge.register(tile);
  const conn = bridge.connect(tile.id, () => {});

  await conn.handle(
    JSON.stringify({
      type: "endpoint.call",
      endpoint: "waqi_search",
      args: {
        token: "e8a2e52dbe070521cc39b91eae4536ea",
        apiToken: "second",
        "X-Api-Key": "third",
        keyword: "Berlin",
        monkey: "not a secret",
      },
    }),
  );

  const args = calls[0]!.args as Record<string, unknown>;
  assert(args.token === "***", `a token is hidden: ${JSON.stringify(args)}`);
  assert(args.apiToken === "***", "camelCase too");
  assert(args["X-Api-Key"] === "***", "and a header-shaped name");
  /**
   * The over-correction, which is the half that gets shipped by accident: a
   * panel that hides the search term is a panel nobody can debug with.
   */
  assert(args.keyword === "Berlin", `but not a word that merely contains one: ${JSON.stringify(args)}`);
  assert(args.monkey === "not a secret", "and not one that ends in one");
  // The key stays: that it was sent at all is often the answer.
  assert("token" in args, "the name is still shown, only the value is gone");
}

/**
 * The endpoint broker is addressed by package directory, not by extension id.
 *
 * This is the bug that took four rounds to find, and it was invisible from
 * every side: the widget rendered, the call left, the host answered, and the
 * answer — "ships no api.json" — was true about a directory named
 * `local.test123` that has never existed. The file was there the whole time,
 * in `test123`.
 *
 * Nothing else in the host works this way, which is exactly why it was easy to
 * get wrong: `ext.id` is the right value for the registry, the bridge, the
 * cache and the gate, and the wrong one for the only layer that resolves a path.
 */
{
  const { host, bridge, calls } = await fixture();
  const seen: string[] = [];
  (host as unknown as { widgetTransport?: unknown }).widgetTransport = {
    runtimeHttpCall: async (extId: string) => {
      seen.push(extId);
      return { ok: true, status: 200, data: {} };
    },
  };
  bridge.register(tile);
  const conn = bridge.connect(tile.id, () => {});

  await conn.handle(JSON.stringify({ type: "endpoint.call", endpoint: "x", args: {} }));

  const found = host.registry.widget(tile.definitionId)!;
  assert(
    seen[0] === found.ext.manifest.name,
    `the broker is given the package directory, got ${seen[0]}`,
  );
  assert(
    seen[0] !== found.ext.id,
    `and not the namespaced id the registry derived (${found.ext.id})`,
  );
  assert(calls.length === 1, "and the call is still logged");
}

console.log("call-log.assert.ts: ok");
