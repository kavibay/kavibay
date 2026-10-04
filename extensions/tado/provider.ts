import { declaredQuery } from "@sdk/contract/declaredQuery";
import { defineProvider } from "@sdk/contract/sdk";

/**
 * The tado° provider: what this extension can read, and from where.
 *
 * ITS OWN FILE BECAUSE IT HAS ITS OWN REVIEW. A provider decides which hosts
 * this app is willing to send a credential to; it arrives by reviewed PR and
 * can never be generated (`generatedContributionRefusal` in the registry
 * refuses one outright). A widget is the opposite end of that scale. Keeping
 * the two in one file made the boundary a matter of scrolling.
 *
 * `fixtures/tado.ts` stays where it is: it is the control case for the 37
 * assertions, and it addresses endpoints that do not exist (finding 13). This
 * is the real client, and the two never meet — the suite builds its own
 * registry, the cockpit builds another, so both can use the same ids.
 */

export const PROVIDER_ID = "kavibay.tado/tado";

/** What the widget sees. Flat on purpose — see the queries below. */
export interface TadoRoom {
  id: string;
  name: string;
}

export interface TadoRoomState {
  id: string;
  temperature: number | null;
  humidity: number | null;
  /** The setpoint the zone heats to right now; null while heating is off. */
  target: number | null;
}

export interface TadoSetTemperatureArgs {
  zoneId: string;
  celsius: number;
}

/** tado°'s heating range; the API refuses anything outside it. */
export const TARGET_MIN = 5;
export const TARGET_MAX = 25;

/** `{ zoneStates: { "1": { sensorDataPoints: … } } }`, keyed per account. */
interface ZoneStatesRaw {
  zoneStates?: Record<string, {
    setting?: { power?: string; temperature?: { celsius?: number } | null };
    sensorDataPoints?: {
      insideTemperature?: { celsius?: number };
      humidity?: { percentage?: number };
    };
  }>;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const HOME = "https://my.tado.com/api/v2/homes/{{homeId}}";

/**
 * The call budget the old integration paced itself against, carried over from
 * src-tauri/src/tado/cache.rs rather than re-guessed: tado°'s soft ceiling for
 * unofficial API use is 100 calls a day, and 90 of those are for data — the
 * rest is headroom for token refresh and the occasional zone list.
 *
 * Because every tile shares one cache key, this is the interval for the whole
 * screen, not per widget. Five tiles cost the same as one, which is why the
 * per-room query shape the reference fixture uses would not have survived here.
 *
 * The 30s the fixture uses is a made-up number for a fake fetcher. Shipping it
 * would have been ~2,900 calls a day against a 100-call ceiling.
 */
const PACED_REFRESH_MS = Math.max(Math.floor(86_400 / 90), 15 * 60) * 1000;
/** Rooms are renamed rarely; the old cache reused its zone list for six hours. */
const ZONES_TTL_MS = 6 * 60 * 60 * 1000;

export const tadoProvider = defineProvider({
  name: "tado",
  displayName: "tado°",
  requiresCredential: true,
  credentialType: "tadoOAuth2",
  // Must agree with the Rust table in src-tauri/src/extension_providers, which
  // is the authority — this is documentation (finding 8).
  /**
   * `auth.tado.com` is carried over from the hand-written Rust table and no
   * query here reaches it — the device-code flow lives in the credential
   * registry and uses `login.tado.com`. Kept so generating this table changes
   * no behaviour; removing it is a separate change with its own evidence.
   */
  hosts: ["my.tado.com", "auth.tado.com"],
  queries: {
    /**
     * THE PROVIDER NORMALIZES, THE WIDGET DOES NOT DIG.
     *
     * Both queries used to hand the widget tado°'s own JSON, so `tile.ts` read
     * `sensorDataPoints.insideTemperature.celsius` and every future widget —
     * including a generated one — would have had to know that path. The vendor's
     * shape now stops here, and what leaves is what `result` declares.
     */
    /**
     * Declared rather than written (FINDINGS §29). One request, a flat list,
     * two fields — there is nothing here a function was doing that data cannot
     * say, and saying it as data is what makes a query something other than a
     * code contribution.
     *
     * `{{homeId}}` is still filled host-side from the credential's metadata:
     * the home id is per-account and this code may not see it (finding 13).
     */
    zones: declaredQuery({
      description: "The names of your heating zones",
      get: `${HOME}/zones`,
      result: {
        type: "list",
        of: { type: "object", fields: { id: { type: "string" }, name: { type: "string" } } },
      },
      pick: { id: "id", name: "name" },
      // A zone with no id cannot be joined against `zoneStates`.
      require: ["id"],
      staleTime: ZONES_TTL_MS,
    }),
    zoneStates: {
      description: "Current temperature, humidity and target temperature in every room",
      args: {},
      result: {
        type: "list",
        of: {
          type: "object",
          fields: {
            id: { type: "string" },
            temperature: { type: "number", nullable: true },
            humidity: { type: "number", nullable: true },
            target: { type: "number", nullable: true },
          },
        },
      },
      key: () => [],
      // Doubles as the refresh interval for a subscription — a tile updates
      // because the host refetches, never because the widget polls.
      //
      // NOT MERGED WITH `zones`, though a joined `rooms` query would read better:
      // the two have deliberately different lifetimes, and refetching names on
      // this interval would cost a second call every 16 minutes — roughly 180 a
      // day against tado°'s ~100 ceiling. The widget joins on `id` instead.
      staleTime: PACED_REFRESH_MS,
      fetch: async (_args: Record<string, never>, host): Promise<TadoRoomState[]> => {
        const raw = await host.http.get<ZoneStatesRaw>(`${HOME}/zoneStates`);
        const states = raw?.zoneStates;
        if (!states || typeof states !== "object") return [];
        return Object.entries(states).map(([id, state]) => ({
          id,
          temperature: numberOrNull(state?.sensorDataPoints?.insideTemperature?.celsius),
          humidity: numberOrNull(state?.sensorDataPoints?.humidity?.percentage),
          target: state?.setting?.power === "ON"
            ? numberOrNull(state.setting.temperature?.celsius)
            : null,
        }));
      },
    },
  },
  actions: {
    setTemperature: {
      effect: "write",
      description:
        "Set a zone's target temperature (5–25 °C) until the next scheduled change, as the tado° app does by default.",
      args: {
        zoneId: { type: "string", label: "Room", required: true, source: { query: "zones" } },
        celsius: { type: "number", label: "Temperature", required: true },
      },
      execute: async (args: TadoSetTemperatureArgs, host): Promise<void> => {
        const zoneId = String(args.zoneId ?? "");
        // The zone id lands in the URL path; tado° ids are plain integers.
        if (!/^\d+$/.test(zoneId)) throw { kind: "provider-error", message: "zoneId must be numeric" };
        const celsius = Number(args.celsius);
        if (!Number.isFinite(celsius) || celsius < TARGET_MIN || celsius > TARGET_MAX) {
          throw { kind: "provider-error", message: `celsius must be ${TARGET_MIN}–${TARGET_MAX}` };
        }
        await host.http.put(`${HOME}/zones/${zoneId}/overlay`, {
          setting: { type: "HEATING", power: "ON", temperature: { celsius } },
          termination: { typeSkillBasedApp: "NEXT_TIME_BLOCK" },
        });
      },
      invalidates: () => [{ query: "zoneStates" }],
    },
  },
});
