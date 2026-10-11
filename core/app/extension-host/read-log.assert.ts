import { ExtensionRegistry } from "./registry";
import { Host } from "./runtime";
import { JsonBridge } from "./bridge";
import { tadoExtension } from "./fixtures/tado";
import { makeFetcher, makeUi } from "./fixtures/harness";
import type { WidgetInstance } from "@sdk/contract/sdk";

/**
 * The read log the widget chat builds its snapshot from.
 * Run: npx tsx core/app/extension-host/read-log.assert.ts
 */

const TADO = "kavibay.tado/tado";
const TILE = "kavibay.tado/temperature";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const reg = new ExtensionRegistry();
reg.load(tadoExtension, { kind: "bundled" });
assert(reg.link().length === 0, `fixtures must link: ${JSON.stringify(reg.errors)}`);
const host = new Host(reg, makeFetcher().fetcher, makeUi({}).ui);
await host.connect(TADO, { accessToken: "tok" });

const bridge = new JsonBridge(host);
const tile: WidgetInstance<{ room: string }> = {
  id: "i1", definitionId: TILE, configuration: { room: "living-room" },
  position: { x: 0, y: 0 }, size: { w: 2, h: 2 }, mode: "compact",
};
bridge.register(tile);
const conn = bridge.connect(tile.id, () => {});
const read = (roomId: string) =>
  conn.handle(JSON.stringify({ type: "provider.query", provider: TADO, name: "roomState", args: { roomId } }));

// --- a widget read is recorded once per distinct read, without its result ---
await read("living-room");
await read("living-room");
assert(
  JSON.stringify(host.recentReads("i1")) ===
    JSON.stringify([{ provider: TADO, query: "roomState", args: { roomId: "living-room" } }]),
  `one entry per distinct read: ${JSON.stringify(host.recentReads("i1"))}`,
);

// --- the chat's own reads stay out ---
const chatCaller = { ...host.callerFor(TILE, "i1"), chat: true as const };
await host.query(TADO, "roomState", { roomId: "living-room" }, chatCaller).catch(() => {});
await host.query(TADO, "roomState", { roomId: "kitchen" }, chatCaller).catch(() => {});
assert(host.recentReads("i1").length === 1, "chat reads are not logged");
assert(chatCaller.instanceId === "i1" && chatCaller.extensionId === reg.widget(TILE)!.ext.id, "callerFor names instance and extension");

// --- capped at 20, oldest out first ---
for (let n = 0; n < 25; n++) await read(`room-${n}`);
const log = host.recentReads("i1");
assert(log.length === 20, `capped at 20, got ${log.length}`);
assert((log[0]!.args as { roomId: string }).roomId === "room-5", `oldest dropped first: ${JSON.stringify(log[0])}`);

// --- removal forgets ---
host.forgetReads("i1");
assert(host.recentReads("i1").length === 0, "forgetReads clears the instance");
