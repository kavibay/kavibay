import { defineExtension, defineProvider, defineWidget, type ExtensionSource } from "@sdk/contract/sdk";
import type { Fetcher } from "./http";
import { ExtensionRegistry } from "./registry";
import { Host } from "./runtime";
import { makeUi } from "./fixtures/harness";
import type { WidgetCapabilityTransport } from "./widgetCapabilityTransport";

/**
 * `ProviderHostContext.heartRate` reaches only a bundled provider that declares it.
 * Run: npx tsx core/app/extension-host/heart-rate-capability.assert.ts
 *
 * The declaration is a request and the load source is the grant (SDK
 * invariant 1): the same definition loaded from anywhere else gets no handle.
 */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const fetcher: Fetcher = async () => ({});
const transport = {
  heartRateLatest: async () => ({ bpm: 71, at: 1, connected: true }),
} as unknown as WidgetCapabilityTransport;

const sensor = defineProvider({
  name: "sensor",
  displayName: "Sensor",
  requiresCredential: false,
  hosts: [],
  heartRate: true,
  queries: {
    live: {
      args: {},
      result: { type: "object", fields: { granted: { type: "boolean" } } },
      key: () => [],
      fetch: async (_args: Record<string, never>, host) => ({ granted: host.heartRate !== undefined }),
    },
  },
  actions: {},
});

async function granted(source: ExtensionSource, provider = sensor): Promise<boolean> {
  // The namespace is derived from the source, so the widget learns its
  // provider id from the registry rather than hardcoding one.
  let pid = "";
  const tile = defineWidget<Record<string, never>>({
    name: "tile",
    displayName: "Tile",
    defaultSize: { w: 1, h: 1 },
    get requires() { return { providers: [pid] }; },
    component: {
      async setup(ctx) {
        return ctx.providers![pid]!.query<{ granted: boolean }>("live");
      },
    },
  });
  const reg = new ExtensionRegistry();
  const id = reg.load(
    defineExtension({
      name: "sensor",
      version: "1.0.0",
      displayName: "Sensor",
      engines: { kavibay: "^0.1" },
      contributes: { providers: [provider], widgets: [tile] },
    }),
    source,
  );
  pid = `${id}/sensor`;
  assert(reg.link().length === 0, `fixture must link: ${JSON.stringify(reg.errors)}`);
  const host = new Host(reg, fetcher, makeUi({}).ui, undefined, transport);
  const instance = {
    id: "i1",
    definitionId: `${id}/tile`,
    configuration: {},
    position: { x: 0, y: 0 },
    size: { w: 1, h: 1 },
    mode: "compact" as const,
  };
  const setup = (host.registry.widget(instance.definitionId)!.widget.component as {
    setup(ctx: unknown): Promise<{ granted: boolean }>;
  }).setup;
  return (await setup(host.buildWidgetContext(instance))).granted;
}

assert(await granted({ kind: "bundled" }), "a bundled provider that declares heartRate gets the handle");
assert(
  !(await granted({ kind: "sideloaded", path: "/tmp/fake" })),
  "a sideloaded provider declaring heartRate gets nothing",
);
assert(
  !(await granted({ kind: "bundled" }, { ...sensor, heartRate: undefined })),
  "a bundled provider that does not declare it gets nothing",
);

console.log("heart-rate-capability.assert.ts: ok");
