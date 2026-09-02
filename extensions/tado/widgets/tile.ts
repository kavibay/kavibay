import { computed, ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import { PROVIDER_ID, type TadoRoom, type TadoRoomState } from "../provider";

/**
 * WHAT THE OLD WIDGET DID, AND THEREFORE WHAT THIS DOES: read-only tiles. One
 * heating zone per widget, showing humidity and inside temperature, with the
 * zone name underneath. It sets nothing — the old manifest says "read-only" and
 * declares no write command, so the provider has no actions at all rather than
 * unused ones.
 *
 * THE STATE QUERY TAKES NO ARGUMENTS, and that is the API's doing. tado° has no
 * per-zone state endpoint; `/zoneStates` returns every zone in one response. So
 * the query key is empty and each widget selects its own zone from the shared
 * result. The consequence is better than the per-room shape it replaces: five
 * tiles on five different rooms now produce one request, where the fixture's
 * design would have produced five.
 *
 * NOTHING HERE KNOWS WHAT TADO° SENDS. Both queries declare a flat result and
 * the provider maps into it, so this file joins two lists on `id` instead of
 * walking `sensorDataPoints.insideTemperature.celsius`. That is what makes the
 * shape safe to hand to a generated widget: the vendor's nesting is not part of
 * the surface a widget author, or a model, has to get right.
 */

export interface TadoTileModel {
  temperature: { value: number | null };
  humidity: { value: number | null };
  zoneName: { value: string };
}

export const tadoTile = defineWidget<{ zone: string }>({
  name: "tile",
  displayName: "Tado",
  description: "Temperature and humidity for one heating zone.",
  defaultSize: { w: 1, h: 1 },
  mode: "both",
  requires: { providers: [PROVIDER_ID] },
  configuration: {
    // The option list comes from the `zones` query at invocation, which is why
    // the gate asks for it only after the account is connected.
    zone: {
      type: "select",
      label: "Room",
      required: true,
      source: { provider: PROVIDER_ID, query: "zones" },
    },
  },
  component: {
    async setup(ctx: WidgetContext<{ zone: string }>) {
      const zoneId = String(ctx.config.zone ?? "");
      const states = ref<TadoRoomState[]>([]);
      const rooms = ref<TadoRoom[]>([]);

      // Queried before subscribing, because `subscribe` resolves once the
      // listener is registered — its first payload has not arrived yet, and the
      // check below needs data. The cache makes this the same single request.
      states.value = await ctx.providers![PROVIDER_ID]!.query<TadoRoomState[]>("zoneStates", {});
      rooms.value = await ctx.providers![PROVIDER_ID]!.query<TadoRoom[]>("zones", {});

      /**
       * The old widget had a "this room is no longer available" panel, and this
       * is where it lives now: a configured zone the account no longer returns
       * is a `not-found`, which the runtime renders as an error rather than the
       * widget drawing dashes and calling it data.
       *
       * The available ids are in the message deliberately. A tile silently
       * showing "—" for a room that is merely keyed differently than expected
       * is the hardest kind of failure to trace; this makes it one line.
       */
      if (!zoneId || !states.value.some((state) => state.id === zoneId)) {
        throw {
          kind: "not-found",
          message: `zone "${zoneId}" not in zoneStates (has: ${
            states.value.map((state) => state.id).join(", ") || "none"
          } / zones: ${rooms.value.map((room) => room.id).join(", ") || "none"})`,
        };
      }

      // Only success is read; loading and failure are the runtime's to render,
      // and it is already watching this same subscription.
      await ctx.providers![PROVIDER_ID]!.subscribe<TadoRoomState[]>("zoneStates", {}, (s) => {
        if (s.status === "success") states.value = s.data;
      });

      const mine = computed(() => states.value.find((state) => state.id === zoneId));

      return {
        temperature: computed(() => mine.value?.temperature ?? null),
        humidity: computed(() => mine.value?.humidity ?? null),
        zoneName: computed(
          () => rooms.value.find((room) => room.id === zoneId)?.name ?? "Room",
        ),
      };
    },
  },
});
