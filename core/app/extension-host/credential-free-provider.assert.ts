import { defineExtension, defineProvider, defineWidget } from "@sdk/contract/sdk";
import type { Fetcher } from "./http";
import { ExtensionRegistry } from "./registry";
import { Host } from "./runtime";
import { makeUi } from "./fixtures/harness";

/**
 * Asserts for a provider that needs no credential.
 * Run: npx tsx core/app/extension-host/credential-free-provider.assert.ts
 *
 * `requiresCredential` has been in `ProviderDefinition` since the port, and
 * every provider that ever shipped set it to `true` — so the `false` branch was
 * a declared concept with no behaviour behind it and nothing exercising it. It
 * acquired both when Open-Meteo became a provider, which it is not because it
 * holds a secret (it holds none) but because the Widget Wizard can only offer a
 * person data sources that are providers.
 *
 * The rule these pin down: **connected is the resting state when there is
 * nothing to connect.** A connect prompt in front of a public API is not a
 * harmless extra click — it asks for an account that does not exist, so there
 * is no answer that makes it go away.
 */

// Bundled loads derive the `kavibay` namespace (registry invariant 1), so
// the id an author writes is the derived one.
const PID = "kavibay.public/public";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const fetcher: Fetcher = async () => ({ value: 42 });

const publicProvider = defineProvider({
  name: "public",
  displayName: "Public",
  requiresCredential: false,
  hosts: ["public.example"],
  queries: {
    reading: {
      description: "A number from a service that asks for no account",
      args: {},
      result: { type: "object", fields: { value: { type: "number" } } },
      key: () => [],
      fetch: async (_args: Record<string, never>, host) =>
        host.http.get<{ value: number }>("https://public.example/v1/reading"),
    },
  },
  actions: {},
});

const tile = defineWidget<Record<string, never>>({
  name: "tile",
  displayName: "Tile",
  defaultSize: { w: 1, h: 1 },
  requires: { providers: [PID] },
  component: {
    async setup(ctx) {
      return { reading: await ctx.providers![PID]!.query<{ value: number }>("reading") };
    },
  },
});

function boot() {
  const reg = new ExtensionRegistry();
  reg.load(
    defineExtension({
      name: "public",
      version: "1.0.0",
      displayName: "Public",
      engines: { kavibay: "^0.1" },
      contributes: { providers: [publicProvider], widgets: [tile] },
    }),
    { kind: "bundled" },
  );
  assert(reg.link().length === 0, `the fixture must link: ${JSON.stringify(reg.errors)}`);
  return new Host(reg, fetcher, makeUi({}).ui);
}

const instance = {
  id: "i1",
  definitionId: "kavibay.public/tile",
  configuration: {},
  position: { x: 0, y: 0 },
  size: { w: 1, h: 1 },
  mode: "compact" as const,
};

// --- connected without anyone connecting it ---
{
  const host = boot();
  const status = host.providerStatus(PID);
  assert(
    status.state === "connected",
    `a provider with no credential is connected on load, got ${status.state}`,
  );
}

// --- so the gate mounts the widget instead of asking for an account ---
{
  const host = boot();
  const gate = host.widgetGate(instance);
  assert(gate.state === "ready", `the gate must not ask for an account, got ${gate.state}`);
}

// --- and the query runs, with no connect() ever called ---
{
  const host = boot();
  const view = await (host.registry.widget(instance.definitionId)!.widget.component as {
    setup(ctx: unknown): Promise<{ reading: { value: number } }>;
  }).setup(host.buildWidgetContext(instance));
  assert(view.reading.value === 42, `the query runs unconnected, got ${JSON.stringify(view.reading)}`);
}

/**
 * The negative half, without which the checks above would also pass if
 * `providerStatus` had simply stopped gating anything.
 */
{
  const reg = new ExtensionRegistry();
  reg.load(
    defineExtension({
      name: "guarded",
      version: "1.0.0",
      displayName: "Guarded",
      engines: { kavibay: "^0.1" },
      contributes: {
        providers: [{ ...publicProvider, name: "guarded", requiresCredential: true }],
        widgets: [],
      },
    }),
    { kind: "bundled" },
  );
  const host = new Host(reg, fetcher, makeUi({}).ui);
  assert(
    host.providerStatus("kavibay.guarded/guarded").state === "disconnected",
    "a provider that does need a credential still starts disconnected",
  );
}

console.log("credential-free-provider.assert.ts: ok");
