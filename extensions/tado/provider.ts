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

/** One reading inside a room; `time` is local ISO without offset, like a Fitbit sleep log. */
export interface TadoRoomReading {
  time: string;
  temperature: number | null;
  /** Relative humidity, percent. */
  humidity: number | null;
}

interface RoomHistoryArgs {
  zoneId: string;
  /** Local times "yyyy-MM-ddTHH:mm"; a sleep's startTime / endTime fit as they are. */
  start: string;
  end: string;
}

/** A stretch of time in local ISO without offset, clipped to the asked window. */
export interface TadoInterval {
  from: string;
  to: string;
}

/** What the room did through one window: readings, heating and open windows. */
export interface TadoRoomHistory {
  readings: TadoRoomReading[];
  /**
   * When the zone called for heat. tado° reports a level, not a percentage:
   * 1 low, 2 medium, 3 high. Stretches without a call are left out.
   */
  heating: (TadoInterval & { level: number })[];
  /** When tado°'s open-window detection had the zone paused. */
  windowOpen: TadoInterval[];
}

/** `dayReport`'s series; timestamps are UTC, humidity a 0–1 fraction. */
interface DayReportRaw {
  measuredData?: {
    insideTemperature?: { dataPoints?: { timestamp?: string; value?: { celsius?: number } }[] };
    humidity?: { dataPoints?: { timestamp?: string; value?: number }[] };
  };
  callForHeat?: { dataIntervals?: { from?: string; to?: string; value?: string }[] };
  stripes?: { dataIntervals?: { from?: string; to?: string; value?: { stripeType?: string } }[] };
}

const HEAT_LEVELS: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** "2026-10-08T21:45:00.000Z" in this machine's local time, without offset. */
function toLocalIso(utc: string): string | null {
  const at = new Date(utc);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:00`;
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
    /**
     * One room's temperature and humidity between two local times, from
     * tado°'s per-day `dayReport` (a reading every 15 minutes).
     *
     * One call per calendar date touched, so a night across midnight costs two
     * of the ~100 a day. That is why it takes a single room and at most 48
     * hours, and why a result is kept for an hour: past days never change.
     */
    roomHistory: {
      description:
        "Temperature and humidity in one room between two local times (a reading every 15 minutes, at most 48 hours), plus when it heated (level 1–3) and when a window was open. A sleep's startTime and endTime fit as they are",
      args: {
        zoneId: { type: "string", label: "Room", required: true, source: { query: "zones" } },
        start: { type: "string", label: "From (yyyy-MM-ddTHH:mm, local)", required: true },
        end: { type: "string", label: "To (yyyy-MM-ddTHH:mm, local)", required: true },
      },
      result: {
        type: "object",
        fields: {
          readings: {
            type: "list",
            of: {
              type: "object",
              fields: {
                time: { type: "string" },
                temperature: { type: "number", nullable: true },
                humidity: { type: "number", nullable: true },
              },
            },
          },
          heating: {
            type: "list",
            of: {
              type: "object",
              fields: { from: { type: "string" }, to: { type: "string" }, level: { type: "number" } },
            },
          },
          windowOpen: {
            type: "list",
            of: { type: "object", fields: { from: { type: "string" }, to: { type: "string" } } },
          },
        },
      },
      key: (args: RoomHistoryArgs) => [String(args.zoneId ?? ""), args.start ?? "", args.end ?? ""],
      staleTime: 60 * 60 * 1000,
      fetch: async (args: RoomHistoryArgs, host): Promise<TadoRoomHistory> => {
        const zoneId = String(args.zoneId ?? "");
        // The zone id lands in the URL path; tado° ids are plain integers.
        if (!/^\d+$/.test(zoneId)) throw { kind: "provider-error", message: "zoneId must be numeric" };
        const from = LOCAL_TIME.exec(args.start ?? "");
        const to = LOCAL_TIME.exec(args.end ?? "");
        if (!from || !to) throw { kind: "provider-error", message: "start and end must be yyyy-MM-ddTHH:mm" };
        const startKey = `${from[1]}T${from[2]}`;
        const endKey = `${to[1]}T${to[2]}`;
        const span = Date.parse(`${to[1]}T12:00:00`) - Date.parse(`${from[1]}T12:00:00`);
        if (endKey <= startKey || span > 2 * 86_400_000) {
          throw { kind: "provider-error", message: "end must follow start by at most 48 hours" };
        }

        // Every date from start to end, usually one or two.
        const dates: string[] = [];
        for (let day = Date.parse(`${from[1]}T12:00:00`); ; day += 86_400_000) {
          const d = new Date(day);
          const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          dates.push(date);
          if (date >= to[1]!) break;
        }
        const reports = await Promise.all(
          dates.map((date) => host.http.get<DayReportRaw>(`${HOME}/zones/${zoneId}/dayReport`, { date })),
        );

        // Temperature and humidity come as two series; join them on the local minute.
        const byTime = new Map<string, TadoRoomReading>();
        const at = (time: string) => {
          const reading = byTime.get(time) ?? { time, temperature: null, humidity: null };
          byTime.set(time, reading);
          return reading;
        };
        for (const report of reports) {
          for (const point of report?.measuredData?.insideTemperature?.dataPoints ?? []) {
            const time = typeof point?.timestamp === "string" ? toLocalIso(point.timestamp) : null;
            const celsius = numberOrNull(point?.value?.celsius);
            if (time && celsius !== null) at(time).temperature = celsius;
          }
          for (const point of report?.measuredData?.humidity?.dataPoints ?? []) {
            const time = typeof point?.timestamp === "string" ? toLocalIso(point.timestamp) : null;
            const fraction = numberOrNull(point?.value);
            if (time && fraction !== null) at(time).humidity = Math.round(fraction * 1000) / 10;
          }
        }
        const readings = [...byTime.values()]
          .filter((reading) => reading.time.slice(0, 16) >= startKey && reading.time.slice(0, 16) <= endKey)
          .sort((a, b) => a.time.localeCompare(b.time));

        // Intervals are clipped to the window; one that misses it is dropped.
        const clip = (from?: string, to?: string): TadoInterval | null => {
          const f = typeof from === "string" ? toLocalIso(from) : null;
          const t = typeof to === "string" ? toLocalIso(to) : null;
          if (!f || !t) return null;
          const start = f.slice(0, 16) < startKey ? `${startKey}:00` : f;
          const stop = t.slice(0, 16) > endKey ? `${endKey}:00` : t;
          return start < stop ? { from: start, to: stop } : null;
        };
        const heating: TadoRoomHistory["heating"] = [];
        const windowOpen: TadoInterval[] = [];
        for (const report of reports) {
          for (const call of report?.callForHeat?.dataIntervals ?? []) {
            const level = HEAT_LEVELS[call?.value ?? ""];
            const span = level ? clip(call?.from, call?.to) : null;
            if (span) heating.push({ ...span, level: level! });
          }
          for (const stripe of report?.stripes?.dataIntervals ?? []) {
            if (stripe?.value?.stripeType !== "OPEN_WINDOW") continue;
            const span = clip(stripe.from, stripe.to);
            if (span) windowOpen.push(span);
          }
        }
        const byFrom = (a: TadoInterval, b: TadoInterval) => a.from.localeCompare(b.from);
        return { readings, heating: heating.sort(byFrom), windowOpen: windowOpen.sort(byFrom) };
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
