import { ref } from "vue";
import { defineExtension, defineProvider, defineWidget, defineCommand, type WidgetContext } from "@sdk/contract/sdk";

/**
 * CONTROL CASE. The model was derived from this, so it fits by construction.
 *
 * Ported from docs/extension-sdk-reference/.../tado, with two edits that change
 * no assertion: `engines.kavibay` "^0.4" → "^0.1" (see registry.ts), and the
 * `{}` arg types became `Record<string, never>`, which the repo's lint rules
 * require and which means the same thing.
 */

interface Room { id: string; name: string }
interface RoomState { roomId: string; current: number; target: number; heating: boolean }

const tado = defineProvider({
  name: "tado",
  displayName: "Tado",
  // The flow lives in credentials/registry.rs, which knows tado° signs in by
  // device code. Restating it here is what finding 12 removed.
  requiresCredential: true,
  hosts: ["my.tado.com", "auth.tado.com"],
  // The API answers from `my.tado.com`; a room page a person would open is on
  // `tado.com`. Two lists because they are two different trusts.
  linkHosts: ["tado.com"],
  queries: {
    rooms: {
      key: () => [],
      staleTime: 300_000,
      // FINDING 8: no token handling here. The broker attaches auth for the
      // provider's declared hosts, and `assertReady` has already refused the
      // call if the provider is not connected.
      fetch: async (_args: Record<string, never>, host) =>
        host.http.get<Room[]>("https://my.tado.com/api/v2/rooms"),
    },
    roomState: {
      key: (a: { roomId: string }) => [a.roomId],
      staleTime: 30_000,
      fetch: async (a: { roomId: string }, host) =>
        host.http.get<RoomState>(`https://my.tado.com/api/v2/rooms/${a.roomId}/state`),
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
  requires: { providers: [PID] },
  configuration: {
    room: { type: "select", label: "Room", required: true, source: { provider: PID, query: "rooms" } },
  },
  component: {
    async setup(ctx: WidgetContext<{ room: string }>) {
      const state = ref<RoomState | undefined>(undefined);
      // Only success is read. Loading and failure are the runtime's to render,
      // and the runtime is already watching this same subscription — see
      // useWidgetRuntime.observeQueries. A widget that branched on the other
      // two statuses would be building a second, inconsistent error UI.
      await ctx.providers![PID]!.subscribe<RoomState>("roomState", { roomId: ctx.config.room }, (s) => {
        if (s.status === "success") state.value = s.data;
      });
      return { state, room: ctx.config.room };
    },
  },
});

const control = defineWidget<{ room: string }>({
  name: "control",
  displayName: "Heating control",
  defaultSize: { w: 3, h: 2 },
  requires: { providers: [PID], actions: { [PID]: ["setTemperature"] } },
  configuration: {
    room: { type: "select", label: "Room", required: true, source: { provider: PID, query: "rooms" } },
  },
  component: {
    async setup(ctx: WidgetContext<{ room: string }>) {
      return {
        state: await ctx.providers![PID]!.query<RoomState>("roomState", { roomId: ctx.config.room }),
        bump: (delta: number, current: number) =>
          ctx.providers![PID]!.action("setTemperature", { roomId: ctx.config.room, temperature: current + delta }),
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
  engines: { kavibay: "^0.1" },
  contributes: { providers: [tado], widgets: [temperature, control], commands: [livingRoom21] },
});
