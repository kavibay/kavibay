import { defineExtension, defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import { JsonBridge, sandboxContext } from "./bridge";
import { ExtensionRegistry } from "./registry";
import { Host } from "./runtime";
import { makeUi } from "./fixtures/harness";
import type { Fetcher } from "./http";
import { tadoLiveExtension } from "../../../extensions/tado/extension";
import weatherExtension from "../../../extensions/weather/extension";
import { PROVIDER_ID as TADO, type TadoRoomState } from "../../../extensions/tado/provider";
import { PROVIDER_ID as METEO, type WeatherNow } from "../../../extensions/weather/provider";

/**
 * Asserts for a widget reading from two providers at once.
 * Run: npx tsx core/app/extension-host/two-providers.assert.ts
 *
 * The case this whole change exists for: room temperatures from tado° and the
 * outdoor temperature from Open-Meteo, in one widget. Written against the two
 * real providers rather than fixtures, because the thing worth knowing is not
 * that the plumbing type-checks — it is that the two shipping providers
 * actually coexist under one widget, with their own grants and their own gates.
 *
 * What each block pins down:
 *  - the definition links, so `requires.providers` and a keyed `permissions`
 *    agree with the registry's validation;
 *  - the gate waits for the one provider that needs an account and not for the
 *    one that does not;
 *  - each handle reaches its own provider and only its own;
 *  - a grant on one provider does not open the other;
 *  - over the wire, a provider id the caller did not declare is refused by the
 *    host rather than by a missing handle on the guest side. That last one is
 *    the new attack surface: before `requires` was a list, the host derived the
 *    provider from the connection and there was nothing to forge.
 */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const fetcher: Fetcher = async (url: string) => {
  if (url.includes("zoneStates")) {
    return { zoneStates: { "1": { sensorDataPoints: { insideTemperature: { celsius: 21.3 } } } } };
  }
  if (url.includes("/zones")) return [{ id: 1, name: "Living Room" }];
  if (url.includes("geocoding-api")) {
    return { results: [{ name: "Berlin", country: "Germany", latitude: 52.5, longitude: 13.4 }] };
  }
  return { current: { temperature_2m: 8.1, weather_code: 3 } };
};

const insideOutside = defineWidget<{ location: string }>({
  name: "inside-outside",
  displayName: "Inside and outside",
  defaultSize: { w: 3, h: 3 },
  requires: { providers: [TADO, METEO] },
  component: {
    async setup(ctx: WidgetContext<{ location: string }>) {
      return {
        rooms: await ctx.providers![TADO]!.query<TadoRoomState[]>("zoneStates", {}),
        outside: await ctx.providers![METEO]!.query<WeatherNow>("current", {
          location: ctx.config.location,
        }),
      };
    },
  },
});

function boot() {
  const reg = new ExtensionRegistry();
  reg.load(tadoLiveExtension as never, { kind: "bundled" });
  reg.load(weatherExtension as never, { kind: "bundled" });
  reg.load(
    defineExtension({
      name: "demo",
      version: "1.0.0",
      displayName: "Demo",
      engines: { kavibay: "^0.1" },
      // One entry per owner, the rule the linker has always enforced — now
      // checked once per declared provider rather than once per widget.
      dependencies: {
        "kavibay.tado": { version: "*" },
        "kavibay.weather": { version: "*" },
      },
      contributes: { widgets: [insideOutside] },
    }) as never,
    { kind: "bundled" },
  );
  const failed = reg.link();
  assert(failed.length === 0, `the two-provider widget must link: ${JSON.stringify(reg.errors)}`);
  return { reg, host: new Host(reg, fetcher, makeUi({}).ui) };
}

const instance = {
  id: "i1",
  definitionId: "kavibay.demo/inside-outside",
  configuration: { location: "Berlin" },
  position: { x: 0, y: 0 },
  size: { w: 3, h: 3 },
  mode: "compact" as const,
};

// --- the gate waits only for the provider that needs an account ---
{
  const { host } = boot();
  const gate = host.widgetGate(instance);
  assert(gate.state === "provider", `tado° is unconnected, so the gate holds: ${gate.state}`);
  assert(
    gate.state === "provider" && gate.pending.length === 1 && gate.pending[0]!.provider === TADO,
    `and holds for tado° alone — Open-Meteo needs no account: ${JSON.stringify(gate)}`,
  );

  await host.connect(TADO, { accessToken: "t" });
  assert(host.widgetGate(instance).state === "ready", "connecting the one account opens the widget");
}

// --- each handle reaches its own provider ---
{
  const { reg, host } = boot();
  await host.connect(TADO, { accessToken: "t" });

  const view = await (reg.widget(instance.definitionId)!.widget.component as never as {
    setup(c: unknown): Promise<{ rooms: TadoRoomState[]; outside: WeatherNow }>;
  }).setup(host.buildWidgetContext(instance));

  assert(view.rooms[0]?.temperature === 21.3, `inside came from tado°: ${JSON.stringify(view.rooms)}`);
  assert(view.outside.temperature === 8.1, `outside came from Open-Meteo: ${JSON.stringify(view.outside)}`);
  assert(view.outside.place === "Berlin, Germany", "and it was normalized by the provider, not the widget");
}

// --- a declared provider is open, and only the declared one ---
{
  const { host } = boot();
  await host.connect(TADO, { accessToken: "t" });
  const ctx = host.buildWidgetContext(instance);

  /**
   * `zones` is a query the widget never mentions anywhere. Since §27 that is
   * fine: approving tado° approves reading tado°, and there is no finer list to
   * be outside of. Pinned down because it is the behaviour that changed, and a
   * refusal here would mean the coarse grant had quietly stayed fine-grained.
   */
  const rooms = await ctx.providers![TADO]!.query<{ id: string }[]>("zones", {});
  assert(Array.isArray(rooms), "a query the widget never named is still reachable on a granted account");

  let denied: unknown;
  try {
    await ctx.providers![METEO]!.query("zoneStates", {});
  } catch (error) {
    denied = error;
  }
  assert(denied !== undefined, "but tado°'s query is not reachable through Open-Meteo's handle");
}

// --- over the wire, an undeclared provider is refused by the host ---
{
  const { host } = boot();
  await host.connect(TADO, { accessToken: "t" });
  const bridge = new JsonBridge(host);
  bridge.register(instance);

  const connection = bridge.connect(instance.id, () => {});
  // A guest that claims a third provider it never declared. The handle exists
  // on this side because the guest builds one per id it was handed; the refusal
  // has to come from the bridge.
  const ctx = sandboxContext(instance, async (json) => connection.handle(json), () => {}, [
    "kavibay.calendar/calendar",
  ]);

  let refusal: unknown;
  try {
    await ctx.providers!["kavibay.calendar/calendar"]!.query("events", {});
  } catch (error) {
    refusal = error;
  }
  assert(refusal !== undefined, "a provider the caller never declared is refused on the wire");
  assert(
    JSON.stringify(refusal).includes("does not declare"),
    `and refused for that reason, not for a missing handle: ${JSON.stringify(refusal)}`,
  );
}

console.log("two-providers.assert.ts: ok");
