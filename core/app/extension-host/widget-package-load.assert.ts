import { ExtensionRegistry } from "./registry";
import { Host } from "./runtime";
import { JsonBridge, sandboxContext } from "./bridge";
import { isReady } from "./sandboxTransport";
import { isExtToHost } from "../runtime/bridgeProtocol";
import { WidgetPackageLoader } from "./widgetPackageLoad";
import { tadoExtension } from "./fixtures/tado";
import { makeFetcher, makeUi } from "./fixtures/harness";

/**
 * Asserts for the step between "enabled on disk" and "mountable".
 * Run: npx tsx core/app/extension-host/widget-package-load.assert.ts
 *
 * Every failure this file describes rendered as the same thing: a black
 * rectangle. That is the reason it exists — the loader has to say *which* of
 * these happened, because none of them is distinguishable on screen, and four
 * rounds of misdiagnosis (finding 21) went exactly that way.
 */

const TADO = "kavibay.tado/tado";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function boot() {
  const registry = new ExtensionRegistry();
  registry.load(tadoExtension, { kind: "bundled" });
  assert(registry.link().length === 0, `the fixture must link: ${JSON.stringify(registry.errors)}`);
  return registry;
}

/** A package of the shape the wizard writes: reads one provider, no actions. */
const manifest = {
  name: "room-summary",
  version: "1.0.0",
  displayName: "Room summary",
  engines: { kavibay: "^0.1" },
  widget: {
    name: "tile",
    displayName: "Room summary",
    requires: { providers: [TADO] },
  },
};

const row = (over: Record<string, unknown> = {}) => ({
  id: "room-summary",
  status: "ready",
  format: "contract",
  contractManifest: manifest,
  ...over,
});

const install = (over: Record<string, unknown> = {}) => ({
  id: "room-summary",
  enabled: true,
  contractGrant: { provider: TADO, queries: ["rooms"] },
  ...over,
});

// --- the whole point: an approved package becomes mountable ---
{
  const registry = boot();
  const loader = new WidgetPackageLoader(registry);
  loader.sync([row()], [install()]);

  const definitionId = loader.definitionOf("room-summary");
  assert(
    definitionId === "local.room-summary/tile",
    `an approved package has a definition to mount, got ${definitionId}`,
  );
  assert(
    loader.refusalOf("room-summary") === undefined,
    `and nothing to explain: ${loader.refusalOf("room-summary")}`,
  );

  const found = registry.widget(definitionId!);
  assert(found !== undefined, "the registry resolves it, which is what the bridge does per request");
  assert(found!.ext.trust === "generated", `trust comes from the load source, got ${found!.ext.trust}`);
  assert(
    JSON.stringify(found!.widget.requires?.providers) === JSON.stringify([TADO]),
    `the widget addresses what the grant said: ${JSON.stringify(found!.widget.requires)}`,
  );
}

// --- no grant, no load: the blocking rule, stated as a test ---
{
  const loader = new WidgetPackageLoader(boot());
  loader.sync([row()], [install({ contractGrant: null })]);

  assert(
    loader.definitionOf("room-summary") === undefined,
    "a package nobody approved must not load — an empty grant is not a substitute for an absent one",
  );
  assert(
    (loader.refusalOf("room-summary") ?? "").includes("approved"),
    `and the reason has to reach the user: ${loader.refusalOf("room-summary")}`,
  );
}

// --- approved for nothing is an answer, and a different one ---
{
  const registry = boot();
  const loader = new WidgetPackageLoader(registry);
  // No account ticked, for a package that names one. Since §27 that is not
  // "loaded but able to read nothing" — the grant and the declaration disagree,
  // and a package loaded against a grant that is not about it is the one thing
  // `widgetPackageManifest` refuses outright.
  loader.sync([row()], [install({ contractGrant: { approved: [] } })]);

  assert(loader.definitionOf("room-summary") === undefined, "ticking no boxes loads nothing");
  const refusal = loader.refusalOf("room-summary");
  assert(
    refusal !== undefined && refusal.includes(TADO),
    `and says which account it wanted: ${refusal}`,
  );
}

// --- the manifest never grants itself, however the record is edited ---
{
  const registry = boot();
  const loader = new WidgetPackageLoader(registry);
  loader.sync([row()], [install({ contractGrant: { provider: TADO, queries: ["rooms"] } })]);

  const granted = registry.widget("local.room-summary/tile")!.widget.requires!.providers;
  assert(
    granted.join(",") === TADO,
    `the widget addresses exactly the account in the record, got ${JSON.stringify(granted)}`,
  );
}

// --- a disabled package is not a refusal, it is an answer ---
{
  const loader = new WidgetPackageLoader(boot());
  loader.sync([row()], [install({ enabled: false })]);
  assert(loader.definitionOf("room-summary") === undefined, "a disabled package does not load");
  assert(
    loader.refusalOf("room-summary") === undefined,
    "and needs no explanation — the user turned it off",
  );
}

// --- a runtime package is not this loader's business ---
{
  const loader = new WidgetPackageLoader(boot());
  loader.sync([row({ format: "runtime", contractManifest: undefined })], [install()]);
  assert(
    loader.definitionOf("room-summary") === undefined &&
      loader.refusalOf("room-summary") === undefined,
    "the format discriminator decides, and the other format is served elsewhere",
  );
}

// --- a package naming a provider that is not installed says so ---
{
  const loader = new WidgetPackageLoader(new ExtensionRegistry());
  loader.sync([row()], [install()]);
  assert(loader.definitionOf("room-summary") === undefined, "it cannot mount without its provider");
  const reason = loader.refusalOf("room-summary") ?? "";
  assert(
    reason.includes("kavibay.tado/tado"),
    `and the message names what is missing rather than the widget: ${reason}`,
  );
}

// --- re-syncing an unchanged package leaves it alone ---
{
  const registry = boot();
  const loader = new WidgetPackageLoader(registry);
  loader.sync([row()], [install()]);
  const first = registry.extensions.get("local.room-summary");
  const errorsAfterFirst = registry.errors.length;
  loader.sync([row()], [install()]);

  // Object identity, not merely "still there": unloading and loading again
  // produces an equal entry, so equality would pass for the version that churns
  // the registry on every rescan and prove nothing.
  assert(
    registry.extensions.get("local.room-summary") === first,
    "an unchanged package is left alone rather than torn down and rebuilt",
  );
  assert(
    registry.errors.length === errorsAfterFirst,
    `and no duplicate id is reported: ${JSON.stringify(registry.errors.slice(errorsAfterFirst))}`,
  );
}

// --- withdrawing the grant unloads it, rather than leaving it live ---
{
  const registry = boot();
  const loader = new WidgetPackageLoader(registry);
  loader.sync([row()], [install()]);
  loader.sync([row()], [install({ contractGrant: null })]);

  assert(loader.definitionOf("room-summary") === undefined, "the loader drops it");
  assert(
    registry.widget("local.room-summary/tile") === undefined,
    "and so does the registry — a stale definition is a live permission list the user withdrew",
  );
}

// --- a re-approval takes effect, and remounts ---
{
  const registry = boot();
  const loader = new WidgetPackageLoader(registry);
  // Approved for nothing first, which for a package that names tado° is a
  // refusal — then approved, which is the answer that has to win.
  loader.sync([row()], [install({ contractGrant: { approved: [] } })]);
  assert(loader.definitionOf("room-summary") === undefined, "the first answer refused it");

  loader.sync([row()], [install({ contractGrant: { approved: [TADO] } })]);
  const granted = registry.widget("local.room-summary/tile")!.widget.requires!.providers;
  assert(
    granted.includes(TADO),
    `the second answer is the one that counts, got ${JSON.stringify(granted)}`,
  );
  assert(
    loader.definitionOf("room-summary") === "local.room-summary/tile",
    "and the definition id is the same one the refusal was about, which is the trap",
  );
  assert(
    loader.mountKeyOf("room-summary") !== undefined,
    "so it has a mount key at all — without one `setup` never runs and the new access is never used",
  );

  /**
   * With a coarse grant a single-provider package has only two states, so the
   * old "different boxes ticked" case cannot be written any more. What still
   * has to hold is the pair above: the id does not move, so something else must,
   * or a re-approval is invisible to the frame.
   */
}

// --- and an unchanged rescan must not remount anything ---
{
  const loader = new WidgetPackageLoader(boot());
  loader.sync([row()], [install()]);
  const keyBefore = loader.mountKeyOf("room-summary");
  loader.sync([row()], [install()]);
  assert(
    loader.mountKeyOf("room-summary") === keyBefore,
    "a rescan is not a reason to tear a running widget down",
  );
}

// --- the chain, end to end over a real JSON transport ---
/**
 * Everything above is about what loaded. This is about what a package can then
 * actually do, driven the way the frame drives it: `sandboxContext` on one side,
 * `BridgeConnection` on the other, nothing but strings in between.
 *
 * It is the only place the grant is tested as a *capability* rather than as a
 * field — the bridge reads the permission list off the loaded definition on
 * every request, so a grant that survived storage but not loading fails here
 * and nowhere else.
 */
{
  const registry = boot();
  const loader = new WidgetPackageLoader(registry);
  loader.sync([row()], [install({ contractGrant: { provider: TADO, queries: ["rooms"] } })]);

  const { fetcher } = makeFetcher();
  // The command UI is unused here — a package contributes no commands — but the
  // host requires one, so the fixture's stands in rather than a cast.
  const host = new Host(registry, fetcher, makeUi({}).ui);
  await host.connect(TADO, { accessToken: "tok" });

  const instance = {
    id: "package-1",
    definitionId: loader.definitionOf("room-summary")!,
    configuration: {},
    position: { x: 0, y: 0 },
    size: { w: 2, h: 2 },
    mode: "compact" as const,
  };
  const bridge = new JsonBridge(host);
  bridge.register(instance);
  const connection = bridge.connect(instance.id, () => {});

  let bytes = 0;
  const ctx = sandboxContext(
    instance,
    async (json) => {
      bytes += json.length;
      return connection.handle(json);
    },
    () => {},
    [TADO],
  );

  const rooms = await ctx.providers![TADO]!.query<{ id: string }[]>("rooms", {});
  assert(Array.isArray(rooms) && rooms.length > 0, "the granted query answers over the wire");
  assert(bytes > 0, "and it really crossed as strings");

  /**
   * A query the manifest never mentions, on an account the person did approve.
   * Since §27 that is allowed — the grant is the account — and it is asserted
   * rather than left implicit, because a refusal here would mean the coarse
   * grant had quietly stayed fine-grained somewhere in this chain.
   */
  const alsoFine = await ctx.providers![TADO]!.query("roomState", { roomId: "living-room" });
  assert(alsoFine !== undefined, "any query on an approved account answers over the wire");

  /**
   * Reading is the account; writing is declared, and for a package the
   * declaration that counts is the grant. This one approved the account and no
   * action, so the write is refused over the wire.
   */
  const write = await ctx.providers![TADO]!
    .action("setTemperature", { roomId: "living-room", temperature: 25 })
    .then(() => undefined, (error: unknown) => error as { kind?: string });
  assert(write?.kind === "permission-denied", "an action the grant does not name is refused over the wire");
}

// --- a change the person approved goes through, over the same wire ---
{
  const writes = {
    ...manifest,
    widget: { ...manifest.widget, requires: { providers: [{ id: TADO, actions: ["setTemperature"] }] } },
  };
  const registry = boot();
  const loader = new WidgetPackageLoader(registry);
  loader.sync(
    [row({ contractManifest: writes })],
    [install({ contractGrant: { approved: [TADO], actions: { [TADO]: ["setTemperature"] } } })],
  );
  assert(loader.refusalOf("room-summary") === undefined, `it loads: ${loader.refusalOf("room-summary")}`);

  const { fetcher, calls } = makeFetcher();
  const host = new Host(registry, fetcher, makeUi({}).ui);
  await host.connect(TADO, { accessToken: "tok" });
  const instance = {
    id: "package-2",
    definitionId: loader.definitionOf("room-summary")!,
    configuration: {},
    position: { x: 0, y: 0 },
    size: { w: 2, h: 2 },
    mode: "compact" as const,
  };
  const bridge = new JsonBridge(host);
  bridge.register(instance);
  const connection = bridge.connect(instance.id, () => {});
  const ctx = sandboxContext(instance, (json) => connection.handle(json), () => {}, [TADO]);

  await ctx.providers![TADO]!.action("setTemperature", { roomId: "living-room", temperature: 25 });
  assert(calls.some((url) => url.endsWith("/target")), "an approved change reaches the provider over the wire");
}

// --- why it was black, kept as a fact rather than a memory ---
/**
 * The two frames do not answer each other's messages, and neither says so. A
 * contract guest's first act is `{ kind: "kavibay.widget.ready" }`; the runtime
 * bridge's narrowing requires a `type` in the `kavibay.ext.*` vocabulary, finds
 * none, and drops it. No `init` follows, `setup` never runs, and the card is a
 * black rectangle with nothing logged anywhere.
 */
{
  const ready: unknown = { kind: "kavibay.widget.ready" };
  assert(isReady(ready), "the contract frame recognises its guest's first message");
  assert(
    !isExtToHost(ready),
    "the runtime bridge does not — which is the whole of why a package rendered nothing",
  );
}

console.log("widget-package-load.assert.ts: ok");
