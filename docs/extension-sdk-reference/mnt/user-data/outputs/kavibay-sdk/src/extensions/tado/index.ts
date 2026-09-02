import { defineExtension, defineProvider, defineWidget, defineCommand, type WidgetContext } from "../../sdk.js";

/** CONTROL CASE. The model was derived from this, so it fits by construction. */

interface Room { id: string; name: string }
interface RoomState { roomId: string; current: number; target: number; heating: boolean }

const tado = defineProvider({
  name: "tado",
  displayName: "Tado",
  connection: { kind: "oauth2-pkce", authorizeUrl: "https://auth.tado.com/oauth2/authorize", tokenUrl: "https://auth.tado.com/oauth2/token", clientId: "kavibay", scopes: ["home.details"] },
  hosts: ["my.tado.com", "auth.tado.com"],
  queries: {
    rooms: {
      key: () => [],
      staleTime: 300_000,
      fetch: async (_args: {}, host) => {
        await host.credentials.getAccessToken();
        return host.http.get<Room[]>("https://my.tado.com/api/v2/rooms");
      },
    },
    roomState: {
      key: (a: { roomId: string }) => [a.roomId],
      staleTime: 30_000,
      fetch: async (a: { roomId: string }, host) => {
        await host.credentials.getAccessToken();
        return host.http.get<RoomState>(`https://my.tado.com/api/v2/rooms/${a.roomId}/state`);
      },
    },
  },
  actions: {
    setTemperature: {
      effect: "write",
      args: {
        roomId: { type: "string", label: "Room", required: true, source: { query: "rooms" } },
        temperature: { type: "number", label: "Target", required: true },
      },
      execute: async (a: { roomId: string; temperature: number }, host) => {
        await host.http.post(`https://my.tado.com/api/v2/rooms/${a.roomId}/target`, { temperature: a.temperature });
      },
      invalidates: (a) => [{ query: "roomState", key: [a.roomId] }],
    },
  },
});

const PID = "kavibay.tado/tado";

const temperature = defineWidget<{ room: string }>({
  name: "temperature",
  displayName: "Room temperature",
  defaultSize: { w: 2, h: 2 },
  requires: { provider: PID },
  permissions: { queries: ["roomState"], actions: [] },
  configuration: {
    room: { type: "select", label: "Room", required: true, source: { provider: PID, query: "rooms" } },
  },
  component: {
    async setup(ctx: WidgetContext<{ room: string }>) {
      const sub = await ctx.provider!.subscribe<RoomState>("roomState", { roomId: ctx.config.room }, () => {});
      return { sub };
    },
  },
});

const control = defineWidget<{ room: string }>({
  name: "control",
  displayName: "Heating control",
  defaultSize: { w: 3, h: 2 },
  requires: { provider: PID },
  permissions: { queries: ["roomState"], actions: ["setTemperature"] },
  configuration: {
    room: { type: "select", label: "Room", required: true, source: { provider: PID, query: "rooms" } },
  },
  component: {
    async setup(ctx: WidgetContext<{ room: string }>) {
      return {
        state: await ctx.provider!.query<RoomState>("roomState", { roomId: ctx.config.room }),
        bump: (delta: number, current: number) =>
          ctx.provider!.action("setTemperature", { roomId: ctx.config.room, temperature: current + delta }),
      };
    },
  },
});

/** AI-generatable: pure binding to a declared action, no code. */
const livingRoom21 = defineCommand({
  kind: "action",
  name: "living-room-21",
  title: "Living room to 21 degrees",
  keywords: ["tado", "heating"],
  when: { providerConnected: PID },
  action: {
    provider: PID,
    name: "setTemperature",
    args: {
      roomId: { from: "literal", value: "living-room" },
      temperature: { from: "literal", value: 21 },
    },
  },
});

export const tadoExtension = defineExtension({
  name: "tado",
  version: "1.2.0",
  displayName: "Tado",
  engines: { kavibay: "^0.4" },
  contributes: { providers: [tado], widgets: [temperature, control], commands: [livingRoom21] },
});
