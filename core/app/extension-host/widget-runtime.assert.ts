import { effectScope } from "vue";
import {
  defineExtension, defineProvider, defineWidget,
  type ExtensionManifest, type WidgetContext, type WidgetInstance,
} from "@sdk/contract/sdk";
import { ExtensionRegistry } from "./registry";
import { Host } from "./runtime";
import type { Fetcher } from "./http";
import { useWidgetRuntime } from "./useWidgetRuntime";
import { todoExtension } from "./fixtures/todo";
import { clockExtension } from "./fixtures/clock";
import { tadoExtension } from "./fixtures/tado";
import { calendarExtension } from "./fixtures/calendar";
import { makeFetcher, makeUi } from "./fixtures/harness";

/**
 * Asserts for the Phase 3 widget runtime.
 * Run: npx tsx core/app/extension-host/widget-runtime.assert.ts
 *
 * These cover the decisions, not the pixels: which of the four gate states a
 * given instance resolves to, and — the load-bearing one — that `phase` only
 * reaches "ready" when there is data to render. The Vue components in ui/ are
 * a thin switch over `phase`; this repo has no component test framework and
 * this file is where the logic that would break actually lives.
 */

const TADO = "kavibay.tado/tado";
const CAL = "kavibay.google-calendar/calendar";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Lets queued microtasks and the async mount settle. */
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function boot(fetcher: Fetcher = makeFetcher().fetcher, extra: ExtensionManifest[] = []) {
  const reg = new ExtensionRegistry();
  reg.load(todoExtension, { kind: "bundled" });
  reg.load(clockExtension, { kind: "bundled" });
  reg.load(tadoExtension, { kind: "bundled" });
  reg.load(calendarExtension, { kind: "bundled" });
  for (const ext of extra) reg.load(ext, { kind: "bundled" });
  const failed = reg.link();
  assert(failed.length === 0, `fixtures must link: ${JSON.stringify(reg.errors)}`);
  const { ui } = makeUi({});
  return new Host(reg, fetcher, ui);
}

const inst = <T>(definitionId: string, id: string, configuration: T): WidgetInstance<T> =>
  ({ id, definitionId, configuration, position: { x: 0, y: 0 }, size: { w: 2, h: 2 }, mode: "compact" });

/** useWidgetRuntime registers onScopeDispose, so it needs an owning scope. */
async function mounted<T>(host: Host, instance: WidgetInstance<T>) {
  const scope = effectScope();
  const runtime = scope.run(() => useWidgetRuntime(host, instance))!;
  await tick();
  return { runtime, dispose: () => scope.stop() };
}

// --- no provider: the two widgets that must just render ---
{
  const host = boot();
  const { runtime, dispose } = await mounted(host, inst("kavibay.todo/list", "todo-1", {}));

  assert(runtime.phase.value === "ready", `todo renders with no provider, got ${runtime.phase.value}`);
  const model = runtime.model.value as { todos: unknown[]; add: unknown };
  assert(Array.isArray(model.todos), "todo model carries its items");
  assert(typeof model.add === "function", "todo model carries its actions");
  dispose();
}
{
  const host = boot();
  const { runtime, dispose } = await mounted(host, inst("kavibay.clock/clock", "clock-1", {}));

  assert(runtime.phase.value === "ready", `clock renders with no provider, got ${runtime.phase.value}`);
  const model = runtime.model.value as { now: { value: Date }; showSeconds: boolean };
  assert(model.now.value instanceof Date, "clock model carries the current time");
  assert(model.showSeconds === true, "an optional config field falls back to its default");
  // Disposing must not throw: the widget's interval is registered on the
  // runtime's scope, which is the whole teardown contract.
  dispose();
}

// --- provider gate: connect prompt comes before any data ---
{
  const { fetcher, calls } = makeFetcher();
  const host = boot(fetcher);
  const { runtime, dispose } = await mounted(host, inst("kavibay.tado/temperature", "tado-1", { room: "living-room" }));

  assert(runtime.phase.value === "provider", `disconnected tado gates on the provider, got ${runtime.phase.value}`);
  assert(runtime.provider.value?.id === TADO, "the prompt knows which provider to connect");
  assert(runtime.provider.value?.status.state === "disconnected", "the prompt knows the provider state");
  assert(calls.length === 0, "no fetch is issued before the provider connects");
  assert(runtime.model.value === undefined, "the widget is not mounted behind the connect prompt");
  dispose();
}

// --- connecting moves the same instance to ready, without a remount by hand ---
{
  const host = boot();
  const { runtime, dispose } = await mounted(host, inst("kavibay.tado/temperature", "tado-2", { room: "living-room" }));
  assert(runtime.phase.value === "provider", "starts on the connect prompt");

  await host.connect(TADO, { accessToken: "tok" });
  await tick();

  assert(runtime.phase.value === "ready", `connecting mounts the widget, got ${runtime.phase.value}`);
  const model = runtime.model.value as { state: { value?: { target: number } } };
  assert(model.state.value?.target === 21, "the widget model carries the fetched room state");
  dispose();
}

// --- a query that never settles must hold the skeleton, never render ---
{
  const host = boot(() => new Promise(() => {}));
  await host.connect(TADO, { accessToken: "tok" });
  const { runtime, dispose } = await mounted(host, inst("kavibay.tado/temperature", "tado-3", { room: "living-room" }));

  assert(runtime.phase.value === "loading", `a pending query holds the skeleton, got ${runtime.phase.value}`);
  assert(runtime.error.value === undefined, "a pending query is not an error");
  dispose();
}

// --- a failing query is the runtime's error, not the widget's ---
{
  const host = boot(async () => { throw new Error("upstream is down"); });
  await host.connect(TADO, { accessToken: "tok" });
  const { runtime, dispose } = await mounted(host, inst("kavibay.tado/temperature", "tado-4", { room: "living-room" }));

  assert(runtime.phase.value === "error", `a failed query surfaces as error, got ${runtime.phase.value}`);
  assert(runtime.error.value?.kind === "provider-error", `typed error, got ${JSON.stringify(runtime.error.value)}`);
  dispose();
}

// --- unconfigured: provider is connected, required config still missing ---
{
  const host = boot();
  await host.connect(CAL, { accessToken: "tok" });
  const { runtime, dispose } = await mounted(host, inst("kavibay.google-calendar/today", "cal-1", {} as { calendar: string }));

  assert(runtime.phase.value === "unconfigured", `missing required config gates, got ${runtime.phase.value}`);
  assert(runtime.missingConfig.value.join(",") === "calendar", "the form knows which fields to ask for");
  assert(runtime.model.value === undefined, "the widget is not mounted behind the settings form");
  dispose();
}

// --- the gate order the contract requires: provider before unconfigured ---
{
  const host = boot();
  const { runtime, dispose } = await mounted(host, inst("kavibay.google-calendar/today", "cal-2", {} as { calendar: string }));

  // Both are wrong at once. Connect has to win: the calendar list that fills
  // this field is itself a provider query.
  assert(runtime.phase.value === "provider", `provider outranks unconfigured, got ${runtime.phase.value}`);
  dispose();
}

// --- retry must never leave the error panel without an error ---
{
  const host = boot(async () => { throw new Error("upstream is down"); });
  await host.connect(TADO, { accessToken: "tok" });
  const { runtime, dispose } = await mounted(host, inst("kavibay.tado/temperature", "tado-5", { room: "living-room" }));

  assert(runtime.phase.value === "error", `starts on the error panel, got ${runtime.phase.value}`);
  assert(runtime.error.value !== undefined, "and with an error to show");

  // The panel's own Retry button clears the failure. Any moment where the
  // phase still says "error" while the error is gone renders a panel with
  // nothing in it — which is what shipped, and what crashed before that.
  runtime.retry();
  assert(
    runtime.phase.value !== "error" || runtime.error.value !== undefined,
    "retry never leaves phase=error without an error",
  );
  assert(runtime.phase.value === "loading", `retry goes to loading, got ${runtime.phase.value}`);

  await tick();
  assert(
    runtime.phase.value !== "error" || runtime.error.value !== undefined,
    "and the state it settles into carries its error too",
  );
  dispose();
}

/**
 * A widget with two independent subscriptions — the shape the runtime has to
 * aggregate. Nothing in `fixtures/` has it, and the reference set is pinned to
 * the 37 assertions and must keep its shape, so it is built here.
 *
 * Subscriptions rather than awaited queries on purpose: a query that throws
 * leaves `setup`, which the runtime already reports as a setup failure. The
 * case that had no handling is the widget that keeps running while one of the
 * things it is watching is broken.
 */
const PAIR = "kavibay.pair/pair";

const pairExtension = defineExtension({
  name: "pair",
  version: "1.0.0",
  displayName: "Pair",
  engines: { kavibay: "^0.1" },
  contributes: {
    providers: [
      defineProvider({
        name: "pair",
        displayName: "Pair",
        requiresCredential: true,
        hosts: ["pair.example"],
        queries: {
          good: {
            key: () => [],
            fetch: async (_a: Record<string, never>, host) =>
              host.http.get("https://pair.example/good"),
          },
          bad: {
            key: () => [],
            fetch: async (_a: Record<string, never>, host) =>
              host.http.get("https://pair.example/bad"),
          },
          room: {
            key: (a: { id: string }) => [a.id],
            fetch: async (a: { id: string }, host) =>
              host.http.get(`https://pair.example/room/${a.id}`),
          },
        },
        actions: {
          refresh: {
            effect: "write",
            args: {},
            execute: async (_a: Record<string, never>, host) => {
              await host.http.post("https://pair.example/refresh", {});
            },
            invalidates: () => [{ query: "good" }],
          },
        },
      }),
    ],
    widgets: [
      defineWidget<Record<string, never>>({
        name: "both",
        displayName: "Both",
        defaultSize: { w: 1, h: 1 },
        requires: { providers: [PAIR] },
        component: {
          async setup(ctx: WidgetContext<Record<string, never>>) {
            // The failing one first, so a naive last-writer-wins runtime ends on
            // the success and reports "ready".
            await ctx.providers![PAIR]!.subscribe("bad", {}, () => {});
            await ctx.providers![PAIR]!.subscribe("good", {}, () => {});
            return { refresh: () => ctx.providers![PAIR]!.action("refresh", {}) };
          },
        },
      }),
      defineWidget<Record<string, never>>({
        name: "rooms",
        displayName: "Rooms",
        defaultSize: { w: 1, h: 1 },
        requires: { providers: [PAIR] },
        component: {
          async setup(ctx: WidgetContext<Record<string, never>>) {
            await ctx.providers![PAIR]!.subscribe("room", { id: "bad" }, () => {});
            await ctx.providers![PAIR]!.subscribe("room", { id: "good" }, () => {});
            return {};
          },
        },
      }),
    ],
  },
});

/** Anything with "bad" in the path fails; everything else answers. */
const pairFetcher: Fetcher = async (url) => {
  if (url.includes("bad")) throw new Error("upstream is down");
  return { ok: true };
};

// --- a failure must not be erased by another query succeeding after it ---
{
  const host = boot(pairFetcher, [pairExtension]);
  await host.connect(PAIR, { accessToken: "tok" });
  const { runtime, dispose } = await mounted(host, inst("kavibay.pair/both", "pair-1", {}));

  assert(
    runtime.phase.value === "error",
    `a later success must not hide an earlier failure, got ${runtime.phase.value}`,
  );
  assert(runtime.error.value?.kind === "provider-error", "and the failure is the one reported");
  dispose();
}

// --- nor cleared by an ordinary refresh of the query that still works ---
{
  const host = boot(pairFetcher, [pairExtension]);
  await host.connect(PAIR, { accessToken: "tok" });
  const { runtime, dispose } = await mounted(host, inst("kavibay.pair/both", "pair-2", {}));
  assert(runtime.phase.value === "error", "starts on the failure");

  // An action invalidates `good`, which refetches and reports success — the
  // everyday case, not a contrived one. Under last-writer-wins that push was
  // enough to send a broken widget back to rendering, so the failure vanished
  // the moment the user did anything at all.
  await (runtime.model.value as { refresh: () => Promise<void> }).refresh();
  await tick();

  assert(
    runtime.phase.value === "error",
    `a refresh elsewhere must not clear a failure, got ${runtime.phase.value}`,
  );
  dispose();
}

// --- one query per argument set, not per query name ---
{
  const host = boot(pairFetcher, [pairExtension]);
  await host.connect(PAIR, { accessToken: "tok" });
  const { runtime, dispose } = await mounted(host, inst("kavibay.pair/rooms", "pair-3", {}));

  // Same query name, two arguments, two cache entries — so two states. Keying
  // the runtime's slots by name alone would collapse them and restore exactly
  // the last-writer-wins bug this pins down.
  assert(
    runtime.phase.value === "error",
    `the same query at two arguments is two states, got ${runtime.phase.value}`,
  );
  dispose();
}

// --- and the aggregate is not permanently pessimistic ---
{
  const host = boot(async () => ({ ok: true }), [pairExtension]);
  await host.connect(PAIR, { accessToken: "tok" });
  const { runtime, dispose } = await mounted(host, inst("kavibay.pair/both", "pair-4", {}));

  assert(runtime.phase.value === "ready", `all queries succeeding renders, got ${runtime.phase.value}`);
  assert(runtime.error.value === undefined, "with nothing to report");
  dispose();
}

// --- a definition that is not registered ---
{
  const host = boot();
  const { runtime, dispose } = await mounted(host, inst("kavibay.ghost/gone", "ghost-1", {}));

  assert(runtime.phase.value === "missing-definition", `unknown definition, got ${runtime.phase.value}`);
  assert(runtime.model.value === undefined, "nothing is mounted for a missing definition");
  dispose();
}

console.log("widget-runtime.assert.ts: ok");
