import type { WidgetInstance, WidgetResponse } from "@sdk/contract/sdk";
import { ExtensionRegistry } from "./registry";
import { Host } from "./runtime";
import { JsonBridge } from "./bridge";
import { todoExtension } from "./fixtures/todo";
import { tadoExtension } from "./fixtures/tado";
import { makeFetcher, makeUi } from "./fixtures/harness";

/**
 * Asserts for the wire boundary's caller identity.
 * Run: npx tsx core/app/extension-host/bridge.assert.ts
 *
 * Section [7] of scenarios.assert.ts already proves a widget works over a JSON
 * transport. What it cannot prove is what happens when a second sandbox is
 * hostile, because it only ever sends requests a cooperating widget would send.
 * Everything below sends the requests a widget would not.
 *
 * Separate file so the 37 stay 37 — that number is Phase 1's acceptance and
 * should keep meaning the same set.
 */

const TADO = "kavibay.tado/tado";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function boot() {
  const reg = new ExtensionRegistry();
  reg.load(todoExtension, { kind: "bundled" });
  reg.load(tadoExtension, { kind: "bundled" });
  assert(reg.link().length === 0, `fixtures must link: ${JSON.stringify(reg.errors)}`);
  const { ui } = makeUi({});
  return new Host(reg, makeFetcher().fetcher, ui);
}

const inst = <T>(definitionId: string, id: string, configuration: T): WidgetInstance<T> =>
  ({ id, definitionId, configuration, position: { x: 0, y: 0 }, size: { w: 2, h: 2 }, mode: "compact" });

/**
 * A widget definition identical to the fixture's control tile, loaded from a
 * generated source so the registry derives `trust: "generated"` for it.
 *
 * Built by loading a second extension rather than by editing the first: trust
 * comes from the load source and nothing else (registry invariant 1), so there
 * is deliberately no way to make an existing entry generated after the fact.
 */
function generatedTadoWidget(host: Host): WidgetInstance<{ room: string }> {
  const control = host.registry.widget("kavibay.tado/control")!.widget;
  host.registry.load(
    {
      name: "made-up",
      version: "1.0.0",
      displayName: "Made up",
      engines: { kavibay: "^0.1" },
      dependencies: { "kavibay.tado": { version: "*" } },
      contributes: { widgets: [{ ...control, name: "tile" }] },
    },
    { kind: "generated", builderSessionId: "s" },
  );
  host.registry.link();
  // A generated load derives the `local.` namespace, not `kavibay.`.
  return inst("local.made-up/tile", "generated-1", { room: "living-room" });
}

/** Sends a handcrafted payload — the thing sandboxContext would never build. */
async function raw(conn: { handle(j: string): Promise<string> }, payload: unknown) {
  return JSON.parse(await conn.handle(JSON.stringify(payload))) as WidgetResponse;
}

const tadoTile = inst("kavibay.tado/control", "victim", { room: "living-room" });
const todoTile = inst("kavibay.todo/list", "attacker", {});

async function fixture() {
  const host = boot();
  await host.connect(TADO, { accessToken: "tok" });
  const bridge = new JsonBridge(host);
  bridge.register(tadoTile);
  bridge.register(todoTile);
  return { host, bridge };
}

// --- naming another instance does not borrow its provider ---
{
  const { bridge } = await fixture();
  const attacker = bridge.connect(todoTile.id, () => {});

  // The Todo widget declares no provider at all. Under the ported bridge this
  // request was answered with the Tado tile's room state, because the payload
  // said so and the payload was believed.
  const res = await raw(attacker, {
    type: "provider.query", provider: TADO,
    name: "roomState",
    args: { roomId: "living-room" },
    instanceId: tadoTile.id,
  });

  assert(res.ok === false, `a forged instanceId must not reach a provider: ${JSON.stringify(res)}`);
}

// --- a generated widget may write through an approved provider ---
{
  /**
   * Approving an account approves the account. A sandboxed generated widget
   * calls provider actions the same way a bundled one does. Trust still comes
   * from the registry entry, never from the wire.
   */
  const { host, bridge } = await fixture();
  const generated = generatedTadoWidget(host);
  bridge.register(generated);
  const conn = bridge.connect(generated.id, () => {});

  const res = await raw(conn, {
    type: "provider.action", provider: TADO,
    name: "setTemperature",
    args: { roomId: "living-room", temperature: 25 },
    instanceId: generated.id,
  });

  assert(res.ok === true, `generated code may call a provider action: ${JSON.stringify(res)}`);
}

// --- nor its stored data ---
{
  const { host, bridge } = await fixture();
  const attacker = bridge.connect(todoTile.id, () => {});

  const res = await raw(attacker, {
    type: "data.set",
    key: "stolen",
    value: "written by the attacker",
    instanceId: tadoTile.id,
  });
  assert(res.ok === true, "the write itself is legitimate — it is the scope that matters");

  const victimSaw = await host.data.scoped(tadoTile.id).get("stolen");
  const attackerSaw = await host.data.scoped(todoTile.id).get("stolen");
  assert(victimSaw === undefined, `the named instance's data is untouched, got ${JSON.stringify(victimSaw)}`);
  assert(attackerSaw === "written by the attacker", "the write landed in the caller's own scope");
}

// --- one connection cannot cancel another's subscription ---
{
  const { host, bridge } = await fixture();
  const seen: string[] = [];
  const victim = bridge.connect(tadoTile.id, (j) => seen.push(j));
  const attacker = bridge.connect(todoTile.id, () => {});

  const SUB = "victim-1";
  await raw(victim, { type: "provider.subscribe", provider: TADO, name: "roomState", args: { roomId: "living-room" }, subscriptionId: SUB });
  await raw(attacker, { type: "provider.unsubscribe", subscriptionId: SUB });

  const before = seen.length;
  await host.action(TADO, "setTemperature", { roomId: "living-room", temperature: 22 }, null);
  await new Promise((r) => setTimeout(r, 20));

  // Subscription ids are chosen by the guest and are guessable by construction
  // (`${instanceId}-1`). They are only unique within a connection, so cancelling
  // has to be too.
  assert(seen.length > before, "a guessed subscription id from another frame cancels nothing");
}

// --- and events reach only the frame that subscribed ---
{
  const { host, bridge } = await fixture();
  const mine: string[] = [];
  const theirs: string[] = [];
  const victim = bridge.connect(tadoTile.id, (j) => mine.push(j));
  bridge.connect(todoTile.id, (j) => theirs.push(j));

  await raw(victim, { type: "provider.subscribe", provider: TADO, name: "roomState", args: { roomId: "living-room" }, subscriptionId: "s1" });
  await host.action(TADO, "setTemperature", { roomId: "living-room", temperature: 23 }, null);
  await new Promise((r) => setTimeout(r, 20));

  assert(mine.length > 0, "the subscriber is told");
  assert(theirs.length === 0, "and nobody else is");
}

// --- closing a frame stops what it started ---
{
  const { host, bridge } = await fixture();
  const seen: string[] = [];
  const conn = bridge.connect(tadoTile.id, (j) => seen.push(j));

  await raw(conn, { type: "provider.subscribe", provider: TADO, name: "roomState", args: { roomId: "living-room" }, subscriptionId: "s1" });
  conn.dispose();

  const afterClose = seen.length;
  await host.action(TADO, "setTemperature", { roomId: "living-room", temperature: 24 }, null);
  await new Promise((r) => setTimeout(r, 20));

  // A subscribed query schedules its own refresh (finding 15), so a leaked
  // subscription is not just a dangling listener — it goes on calling the
  // provider for a widget the user closed.
  assert(seen.length === afterClose, `dispose unsubscribes, got ${seen.length} after ${afterClose}`);
}

// --- a closed connection answers nothing ---
{
  const { bridge } = await fixture();
  const conn = bridge.connect(tadoTile.id, () => {});
  conn.dispose();

  // A torn-down frame can still have a message in flight.
  const res = await raw(conn, { type: "provider.query", provider: TADO, name: "roomState", args: { roomId: "living-room" } });
  assert(res.ok === false, "a closed connection refuses rather than resurrecting itself");
}

// --- an unregistered instance has no connection to open ---
{
  const { bridge } = await fixture();
  let threw = false;
  try {
    bridge.connect("never-registered", () => {});
  } catch {
    threw = true;
  }
  assert(threw, "the host cannot open a channel for something it has no record of");
}

// --- the connection reports query states, so the host can draw the gate ---
{
  const { host, bridge } = await fixture();
  const seen: { slot: string; status: string }[] = [];
  const conn = bridge.connect(tadoTile.id, () => {}, (slot, state) => seen.push({ slot, status: state.status }));

  await raw(conn, { type: "provider.query", provider: TADO, name: "roomState", args: { roomId: "living-room" } });

  // Loading then success, on a slot keyed by name and args — the same identity
  // the cache uses, and the same one `observeQueries` uses in-process, so a
  // widget's skeleton behaves identically on either side of the boundary.
  assert(seen.length >= 2, `a query reports as it moves, saw ${JSON.stringify(seen)}`);
  assert(seen[0]!.status === "loading", `first loading, got ${seen[0]!.status}`);
  assert(seen[seen.length - 1]!.status === "success", `then success, got ${seen[seen.length - 1]!.status}`);
  assert(seen[0]!.slot.startsWith("roomState:"), `slotted by name and args, got ${seen[0]!.slot}`);

  // Subscription pushes arrive too, which is what keeps a refetch from being
  // invisible to the gate.
  const before = seen.length;
  await raw(conn, { type: "provider.subscribe", provider: TADO, name: "roomState", args: { roomId: "living-room" }, subscriptionId: "s1" });
  await host.action(TADO, "setTemperature", { roomId: "living-room", temperature: 21 }, null);
  await new Promise((r) => setTimeout(r, 20));
  assert(seen.length > before, "a subscription's updates are reported as well");
}

// --- a query the caller may not make reports as an error, not silence ---
{
  const { bridge } = await fixture();
  const seen: string[] = [];
  const conn = bridge.connect(todoTile.id, () => {}, (_slot, state) => seen.push(state.status));

  // The Todo widget declares no provider, so this is refused. The gate has to
  // learn about it, or the widget sits on a skeleton that never resolves.
  await raw(conn, { type: "provider.query", provider: TADO, name: "roomState", args: {} });
  assert(seen.includes("error"), `a refused query reports an error, saw ${seen.join(",")}`);
}

// --- garbage on the wire is an error, not a crash ---
{
  const { bridge } = await fixture();
  const conn = bridge.connect(tadoTile.id, () => {});
  const res = JSON.parse(await conn.handle("{not json")) as WidgetResponse;
  assert(res.ok === false, "an unparseable request is refused");
}

console.log("bridge.assert.ts: ok");
