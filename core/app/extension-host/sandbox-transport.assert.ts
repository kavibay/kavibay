import type { WidgetInstance } from "@sdk/contract/sdk";
import { ExtensionRegistry } from "./registry";
import { Host } from "./runtime";
import { JsonBridge } from "./bridge";
import { SandboxGuestPort, SandboxHostPort, failedMessage, isMounted, readFailure } from "./sandboxTransport";
import { todoExtension } from "./fixtures/todo";
import { tadoExtension } from "./fixtures/tado";
import { makeFetcher, makeUi } from "./fixtures/harness";

/**
 * Asserts for the postMessage transport.
 * Run: npx tsx core/app/extension-host/sandbox-transport.assert.ts
 *
 * The two ports are wired to each other through plain callbacks here, which is
 * what a real iframe channel reduces to once the window is out of the way. What
 * a real frame adds — which contentWindow a message came from — cannot be
 * exercised under tsx and is held by a grep guard instead.
 */

const TADO = "kavibay.tado/tado";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

const inst = <T>(definitionId: string, id: string, configuration: T): WidgetInstance<T> =>
  ({ id, definitionId, configuration, position: { x: 0, y: 0 }, size: { w: 2, h: 2 }, mode: "compact" });

/**
 * Host and guest, connected the way an iframe connects them: each side's post
 * lands in the other's accept, and only structured-cloneable data crosses.
 */
async function wire(instance: WidgetInstance<any>) {
  const reg = new ExtensionRegistry();
  reg.load(todoExtension, { kind: "bundled" });
  reg.load(tadoExtension, { kind: "bundled" });
  assert(reg.link().length === 0, `fixtures must link: ${JSON.stringify(reg.errors)}`);
  const host = new Host(reg, makeFetcher().fetcher, makeUi({}).ui);
  await host.connect(TADO, { accessToken: "tok" });

  const bridge = new JsonBridge(host);
  bridge.register(instance);

  const crossed: unknown[] = [];
  // The guest does not exist yet when the host port is built, the same way an
  // iframe's document does not exist when the element is created.
  let deliverToGuest: (m: unknown) => void = () => {};
  const hostPort = new SandboxHostPort(
    (m) => { crossed.push(m); deliverToGuest(m); },
    (emit) => bridge.connect(instance.id, emit),
  );
  const guest = new SandboxGuestPort((m) => { crossed.push(m); hostPort.accept(m); });
  deliverToGuest = (m) => guest.accept(m);

  // The frame is told which providers it may address, exactly as the real one
  // is over `initMessage`. The host re-checks every request against the
  // definition regardless, so this is convenience, not permission.
  return { host, hostPort, guest, crossed, ctx: guest.context(instance, [TADO]) };
}

const tadoTile = () => inst("kavibay.tado/control", "frame-1", { room: "living-room" });

// An unawaited read fails before its defaults can overwrite persisted data.
{
  const { ctx, guest } = await wire(inst("kavibay.todo/list", "water-test", {}));
  await ctx.data.set("water", { glasses: 3 });
  let message = "";
  try {
    const saved = ctx.data.get("water") as unknown as { glasses: number };
    await ctx.data.set("water", { glasses: saved?.glasses ?? 0 });
  } catch (error) { message = String(error); }
  assert(message.includes("Use await ctx.data.get"), "missing await has an actionable error");
  const saved = await ctx.data.get<{ glasses: number }>("water");
  assert(saved?.glasses === 3, "the real bridge retains the saved counter");
  guest.dispose();
}

// --- a widget runs unchanged on the far side of the transport ---
{
  const { host, ctx, crossed } = await wire(tadoTile());
  const definition = host.registry.widget("kavibay.tado/control")!.widget;
  const view = await (definition.component as any).setup(ctx);

  assert(view.state?.target === 21, `the widget got its data, saw ${JSON.stringify(view.state)}`);
  assert(crossed.length > 0, "and it crossed as messages");

  // Structured clone is not JSON, so a payload that stopped being a string
  // could carry a function or a cycle and nothing here would notice until a
  // real frame refused it.
  const allStrings = crossed.every(
    (m) => typeof (m as { payload?: unknown }).payload === "string",
  );
  assert(allStrings, "every payload crossing is a string");
}

// --- replies find their own request, in either order ---
{
  const { ctx } = await wire(tadoTile());

  // Two calls in flight at once. Without correlation the first answer settles
  // the first promise regardless of which call it belongs to, which is the
  // kind of bug that only shows up under load and looks like bad data.
  const [a, b] = await Promise.all([
    ctx.providers![TADO]!.query<{ roomId: string }>("roomState", { roomId: "living-room" }),
    ctx.providers![TADO]!.query<{ roomId: string }>("roomState", { roomId: "bedroom" }),
  ]);
  assert(a.roomId === "living-room" && b.roomId === "bedroom", `answers matched to callers, got ${a.roomId}/${b.roomId}`);
}

// --- a subscription's updates arrive as events ---
{
  const { host, ctx } = await wire(tadoTile());
  const seen: unknown[] = [];
  await ctx.providers![TADO]!.subscribe("roomState", { roomId: "living-room" }, (s) => seen.push(s));
  const before = seen.length;

  await host.action(TADO, "setTemperature", { roomId: "living-room", temperature: 22 }, null);
  await tick();

  assert(seen.length > before, `invalidation reaches the guest, ${before} -> ${seen.length}`);
}

// --- traffic that is not ours is left alone ---
{
  const { hostPort, guest } = await wire(tadoTile());

  // Vite's HMR client posts into every window on reload. A transport that
  // assumed what it sees is its own would try to parse it.
  for (const stranger of [
    { type: "vite:beforeUpdate" },
    "a bare string",
    null,
    { kind: "kavibay.widget.request" },
    { kind: "kavibay.widget.request", id: 7, payload: "{}" },
    { kind: "kavibay.widget.response", id: "r1" },
  ]) {
    assert(hostPort.accept(stranger) === false, `host ignores ${JSON.stringify(stranger)}`);
    assert(guest.accept(stranger) === false, `guest ignores ${JSON.stringify(stranger)}`);
  }
}

// --- an answer nobody is waiting for is dropped ---
{
  const { guest } = await wire(tadoTile());
  // Claimed as ours by shape, so `accept` reports true, but there is no pending
  // call with that id. Resolving something stale with a fresh answer is worse
  // than leaving it unanswered.
  assert(
    guest.accept({ kind: "kavibay.widget.response", id: "never-asked", payload: '{"ok":true,"value":1}' }) === true,
    "a well-formed response is recognised",
  );
}

// --- closing the guest settles every call in flight ---
{
  const { guest, ctx } = await wire(tadoTile());
  const inFlight = ctx.providers![TADO]!.query("roomState", { roomId: "living-room" });
  guest.dispose();

  // A widget awaiting a reply that never comes sits on the runtime's skeleton
  // with nothing saying why. Every promise settles, the same rule the command
  // dialog follows.
  let settled: unknown = "never";
  try { settled = await inFlight; } catch (err) { settled = err; }
  assert(settled !== "never", "a call outstanding at teardown settles");
  assert((settled as { kind?: string })?.kind === "disconnected", `as a typed error, got ${JSON.stringify(settled)}`);
}

// --- closing the host stops it answering and unsubscribes ---
{
  const { host, hostPort, ctx, crossed } = await wire(tadoTile());
  await ctx.providers![TADO]!.subscribe("roomState", { roomId: "living-room" }, () => {});
  hostPort.dispose();

  const after = crossed.length;
  await host.action(TADO, "setTemperature", { roomId: "living-room", temperature: 23 }, null);
  await tick();
  assert(crossed.length === after, `a disposed host port emits nothing, ${after} -> ${crossed.length}`);

  // It still claims the message as its own — silently not-ours would have the
  // caller looking for another handler.
  assert(
    hostPort.accept({ kind: "kavibay.widget.request", id: "x", payload: '{"type":"provider.status"}' }) === true,
    "a request after teardown is recognised and dropped, not disowned",
  );
  await tick();
  assert(crossed.length === after, "and nothing is sent in reply");
}

// --- a reported failure is shaped before it reaches the error panel ---
{
  const real = readFailure(failedMessage({ kind: "not-found", message: "no such room" }));
  assert(real?.kind === "not-found" && real.message === "no such room", "a typed failure survives");

  // The panel switches on `kind`, and a shape it has no branch for is what
  // crashed it once already. The guest is not an attacker, but it is the one
  // piece of this the host takes on trust, so what it says gets a shape.
  for (const bogus of ['{"kind":5,"message":"x"}', '{"message":"no kind"}', '"a string"', "{oops"]) {
    const shaped = readFailure({ kind: "kavibay.widget.failed", payload: bogus });
    assert(
      typeof shaped?.kind === "string" && typeof shaped.message === "string",
      `a malformed failure still arrives as a ProviderError, got ${JSON.stringify(shaped)}`,
    );
  }

  assert(readFailure({ kind: "kavibay.widget.mounted" }) === undefined, "a mount is not a failure");
  assert(isMounted(failedMessage({ kind: "provider-error", message: "x" })) === false, "and a failure is not a mount");
}

console.log("sandbox-transport.assert.ts: ok");
