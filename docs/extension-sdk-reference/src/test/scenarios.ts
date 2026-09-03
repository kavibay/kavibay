import { ExtensionRegistry } from "../host/registry.js";
import { Host } from "../host/runtime.js";
import { todoExtension } from "../extensions/todo/index.js";
import { tadoExtension } from "../extensions/tado/index.js";
import { calendarExtension } from "../extensions/calendar/index.js";
import { weatherExtension } from "../extensions/weather/index.js";
import { makeFetcher, makeUi, check, summary, caught } from "./harness.js";
import { JsonBridge, sandboxContext } from "../host/bridge.js";
import type { WidgetInstance, QueryState } from "../sdk.js";

const TADO = "kavibay.tado/tado";
const CAL = "kavibay.google-calendar/calendar";

function boot() {
  const reg = new ExtensionRegistry();
  reg.load(todoExtension, { kind: "bundled" });
  reg.load(tadoExtension, { kind: "bundled" });
  reg.load(calendarExtension, { kind: "bundled" });
  reg.load(weatherExtension, { kind: "bundled" });
  const failedLinks = reg.link();
  const { fetcher, calls } = makeFetcher();
  const { ui, log } = makeUi({ calendarId: "primary", title: "Lunch" });
  return { reg, host: new Host(reg, fetcher, ui), calls, log, failedLinks };
}

const inst = <T>(definitionId: string, id: string, configuration: T): WidgetInstance<T> =>
  ({ id, definitionId, configuration, position: { x: 0, y: 0 }, size: { w: 2, h: 2 }, mode: "compact" });

async function run() {
  // --- 1. registry -------------------------------------------------------
  console.log("\n[1] registry");
  {
    const { reg, failedLinks } = boot();
    check("all four extensions load and link", reg.extensions.size === 4 && failedLinks.length === 0, JSON.stringify(reg.errors));
    check("provider ids are namespace-qualified", reg.providers.has(TADO));
    check("bundled derives trust=core", reg.extensions.get("kavibay.tado")?.trust === "core");
  }
  {
    const reg = new ExtensionRegistry();
    reg.load(tadoExtension, { kind: "sideloaded", path: "/tmp/fake" });
    const e = reg.extensions.get("dev.tado");
    check("sideloaded cannot claim the kavibay namespace", !reg.extensions.has("kavibay.tado") && !!e);
    check("sideloaded derives trust=untrusted", e?.trust === "untrusted");
  }
  {
    const reg = new ExtensionRegistry();
    reg.load({ ...tadoExtension, engines: { kavibay: "^0.9" } }, { kind: "bundled" });
    check("engine range mismatch refuses the load", reg.extensions.size === 0, JSON.stringify(reg.errors));
  }
  {
    const reg = new ExtensionRegistry();
    reg.load(tadoExtension, { kind: "bundled" });
    reg.load({
      name: "community-thermo", version: "1.0.0", displayName: "Community",
      engines: { kavibay: "^0.4" },
      contributes: { widgets: [{ ...tadoExtension.contributes.widgets![0]!, name: "stolen" }] },
    }, { kind: "catalog", entry: "someone/community-thermo", signature: "sig" });
    const failed = reg.link();
    check("cross-extension provider use without a dependency is refused",
      failed.includes("someone.community-thermo"), JSON.stringify(reg.errors));
  }

  // --- 2. Todo: no provider, no capability, per-instance data ------------
  console.log("\n[2] todo (falsification case 1)");
  {
    const { host } = boot();
    const a = inst("kavibay.todo/list", "inst-a", {});
    const b = inst("kavibay.todo/list", "inst-b", {});
    check("gate is ready with no provider and no config", host.widgetGate(a).state === "ready");
    const ca = host.buildWidgetContext(a), cb = host.buildWidgetContext(b);
    check("no provider handle when none is required", ca.provider === undefined);
    check("no http handle when none is declared", ca.http === undefined);
    const va: any = await (host.registry.widget(a.definitionId)!.widget.component as any).setup(ca);
    await va.add("Buy milk"); await va.add("Ship Kavibay");
    const vb: any = await (host.registry.widget(b.definitionId)!.widget.component as any).setup(cb);
    check("two instances of one definition have independent data", vb.todos.length === 0 && va.todos.length === 2);
    const err = await caught(() => ca.data.set("big", "x".repeat(300_000)));
    check("data quota is enforced", err instanceof Error);
  }

  // --- 3. Tado: dedupe, invalidation, permissions ------------------------
  console.log("\n[3] tado (control case)");
  {
    const { host, calls } = boot();
    const i1 = inst("kavibay.tado/temperature", "t1", { room: "living-room" });
    check("gate blocks on disconnected provider, not an error",
      host.widgetGate(i1).state === "provider");
    await host.connect(TADO, { accessToken: "tok" });
    check("gate is ready once connected and configured", host.widgetGate(i1).state === "ready");

    const c1 = host.buildWidgetContext(i1);
    const i2 = inst("kavibay.tado/control", "t2", { room: "living-room" });
    const c2 = host.buildWidgetContext(i2);
    const before = host.cache.fetchCount;
    await Promise.all([
      c1.provider!.query("roomState", { roomId: "living-room" }),
      c2.provider!.query("roomState", { roomId: "living-room" }),
    ]);
    check("two widgets, same key, one fetch", host.cache.fetchCount - before === 1, `${host.cache.fetchCount - before}`);

    let states: QueryState<any>[] = [];
    await c1.provider!.subscribe("roomState", { roomId: "living-room" }, (s) => states.push(s));
    const n = states.length;
    await c2.provider!.action("setTemperature", { roomId: "living-room", temperature: 22 });
    await new Promise((r) => setTimeout(r, 10));
    check("action invalidation pushes a refresh to the subscriber", states.length > n, `${n} -> ${states.length}`);

    const denied = await caught(() => c1.provider!.action("setTemperature", { roomId: "living-room", temperature: 25 }));
    check("widget without action permission is denied", denied?.kind === "permission-denied", JSON.stringify(denied));

    const bedroomCalls = calls.filter((u) => u.includes("bedroom")).length;
    check("no fetch for a room nobody subscribed to", bedroomCalls === 0);

    host.disconnect(TADO);
    const gone = await caught(() => c1.provider!.query("roomState", { roomId: "living-room" }));
    check("disconnect evicts cache and reads fail closed", gone?.kind === "disconnected", JSON.stringify(gone));
  }

  // --- 4. http capability ------------------------------------------------
  console.log("\n[4] http capability");
  {
    const { host } = boot();
    const w = inst("kavibay.weather/current", "w1", { latitude: 52.4, longitude: 13.06 });
    const ok = await (host.registry.widget(w.definitionId)!.widget.component as any).setup(host.buildWidgetContext(w));
    check("allowlisted host succeeds", !!ok);
    const s = inst("kavibay.weather/sneaky", "w2", {});
    const err = await caught(() => (host.registry.widget(s.definitionId)!.widget.component as any).setup(host.buildWidgetContext(s)));
    check("non-allowlisted host is refused", err instanceof Error && err.message.includes("denied"), String(err));
  }

  // --- 5. Calendar: commands without widgets, prompts, destructive -------
  console.log("\n[5] calendar (falsification case 2)");
  {
    const { host, log } = boot();
    check("commands are hidden while the provider is disconnected",
      !host.visibleCommands().includes("kavibay.google-calendar/create-event"));
    await host.connect(CAL, { accessToken: "tok" });
    check("commands appear once connected",
      host.visibleCommands().includes("kavibay.google-calendar/create-event"));

    await host.runCommand("kavibay.google-calendar/create-event");
    check("prompt-bound arg gets options resolved from the live provider",
      log.some((l) => l.startsWith("prompt:calendarId[primary")), JSON.stringify(log));
    check("write action does not force a confirm", !log.some((l) => l.startsWith("confirm:")));

    await host.runCommand("kavibay.google-calendar/join-next-meeting");
    check("code command with no widget runs", log.some((l) => l.includes("Joining Standup")), JSON.stringify(log));

    const cfg = host.registry.widget("kavibay.google-calendar/today")!.widget.configuration!["calendar"]!;
    const unconfigured = inst("kavibay.google-calendar/today", "c1", {} as any);
    check("config source is provider-backed", cfg.source?.query === "calendars");
    check("gate reports unconfigured before render", host.widgetGate(unconfigured).state === "unconfigured");
  }

  // --- 6. destructive / literal revalidation ----------------------------
  console.log("\n[6] policy");
  {
    const reg = new ExtensionRegistry();
    reg.load(calendarExtension, { kind: "bundled" });
    reg.load({
      name: "reckless", version: "1.0.0", displayName: "Reckless",
      engines: { kavibay: "^0.4" },
      dependencies: { "kavibay.google-calendar": { version: "^0.9" } },
      contributes: {
        commands: [{
          kind: "action", name: "nuke", title: "Delete event", confirm: false,
          action: { provider: CAL, name: "deleteEvent", args: {
            calendarId: { from: "literal", value: "primary" },
            eventId: { from: "literal", value: "e1" },
          } },
        }],
      },
    }, { kind: "catalog", entry: "someone/reckless", signature: "sig" });
    const failed = reg.link();
    check("confirm cannot be disabled on a destructive action",
      failed.includes("someone.reckless"), JSON.stringify(reg.errors));
  }
  {
    const { host, log } = boot();
    await host.connect(TADO, { accessToken: "tok" });
    await host.runCommand("kavibay.tado/living-room-21");
    check("provider-sourced literal passes when the value still exists",
      !log.some((l) => l.includes("failed")), JSON.stringify(log));
  }
  {
    const reg = new ExtensionRegistry();
    reg.load(tadoExtension, { kind: "bundled" });
    reg.link();
    const { fetcher } = makeFetcher();
    const { ui, log } = makeUi({});
    const host = new Host(reg, async (url) => (url.includes("/api/v2/rooms") && !url.includes("state") ? [] : fetcher(url)), ui);
    await host.connect(TADO, { accessToken: "tok" });
    const err = await caught(() => host.runCommand("kavibay.tado/living-room-21"));
    check("provider-sourced literal fails at invocation when the room is gone",
      err?.kind === "not-found", JSON.stringify(err));
  }

  // --- 7. wire boundary: everything through JSON --------------------------
  console.log("\n[7] wire boundary");
  {
    const { host } = boot();
    await host.connect(TADO, { accessToken: "tok" });

    let onEventCb: ((j: string) => void) | undefined;
    const bridge = new JsonBridge(host, (j) => onEventCb?.(j));

    const i = inst("kavibay.tado/control", "b1", { room: "living-room" });
    bridge.register(i);

    /** Simulates the sandbox: only strings cross. */
    let sentBytes = 0;
    const ctx = sandboxContext(
      i,
      async (json) => { sentBytes += json.length; return bridge.handle(json); },
      (cb) => { onEventCb = cb; },
    );

    const view: any = await (host.registry.widget(i.definitionId)!.widget.component as any).setup(ctx);
    check("widget runs unchanged over a JSON transport", view.state?.target === 21, JSON.stringify(view.state));
    check("payloads actually crossed as strings", sentBytes > 0);

    const seen: any[] = [];
    await ctx.provider!.subscribe("roomState", { roomId: "living-room" }, (s) => seen.push(s));
    const n = seen.length;
    await view.bump(1, 21);
    await new Promise((r) => setTimeout(r, 10));
    check("invalidation events reach the sandbox", seen.length > n, `${n} -> ${seen.length}`);

    const denied = await caught(() => ctx.provider!.action("setTemperature", {}) as any);
    check("errors survive serialization as typed ProviderError",
      denied === undefined || typeof denied?.kind === "string", JSON.stringify(denied));

    // a widget cannot address a provider it did not declare
    const todo = inst("kavibay.todo/list", "b2", {});
    bridge.register(todo);
    const ctx2 = sandboxContext(todo, async (j) => bridge.handle(j), () => {});
    const nope = await caught(() => ctx2.provider!.query("roomState", { roomId: "living-room" }));
    check("provider-less widget cannot reach any provider over the wire", nope !== undefined, JSON.stringify(nope));

    await ctx2.data.set("items", [{ id: "x", text: "via wire", done: false }]);
    const back = await ctx2.data.get<any[]>("items");
    check("instance data round-trips through the wire", back?.[0]?.text === "via wire");
  }

  return summary();
}

run().then((f) => process.exit(f ? 1 : 0));
