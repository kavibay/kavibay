// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import {
  defineWidget,
  type TvRemoteApp,
  type TvRemoteDevice,
  type TvRemoteKey,
  type WidgetContext,
} from "@sdk/contract/sdk";

/**
 * findTv connects the Samsung TV, findStick and code pair the optional stick,
 * ready shows the remote.
 */
export type TvRemotePhase = "loading" | "findTv" | "findStick" | "code" | "ready";

export interface TvRemoteConfig {
  /** Navigation goes to a waipu.tv 4K Stick or other Android TV device. */
  stick?: boolean;
  /** The app buttons shown, in this order. */
  apps?: TvRemoteApp[];
}

export interface TvRemoteAppButton {
  id: TvRemoteApp;
  label: string;
}

export const APP_BUTTONS: readonly TvRemoteAppButton[] = [
  { id: "youtube", label: "YouTube" },
  { id: "netflix", label: "Netflix" },
  { id: "primeVideo", label: "Prime" },
  { id: "disneyPlus", label: "Disney+" },
  { id: "spotify", label: "Spotify" },
  { id: "appleTv", label: "Apple TV" },
];
const DEFAULT_APPS: TvRemoteApp[] = APP_BUTTONS.map((app) => app.id);

export interface TvRemoteModel {
  phase: Ref<TvRemotePhase>;
  /** Devices of the kind the current setup step looks for. */
  candidates: ComputedRef<TvRemoteDevice[]>;
  searching: Ref<boolean>;
  /** An address typed by hand when the search finds nothing. */
  manualHost: Ref<string>;
  tvHost: Ref<string>;
  stickHost: Ref<string>;
  /** The app buttons the settings ask for. */
  apps: TvRemoteAppButton[];
  busy: Ref<boolean>;
  error: Ref<string | null>;
  search(): void;
  choose(host: string): void;
  submitCode(code: string): void;
  restart(): void;
  press(key: TvRemoteKey): void;
  launch(app: TvRemoteApp): void;
}

const TV_KEY = "tv";
const STICK_KEY = "stick";
/**
 * Keys that stay with the TV when a stick is added: a stick's volume stops at
 * the TV's level and does not reach it over HDMI-CEC, and power belongs to the
 * screen.
 */
const TV_KEYS: readonly TvRemoteKey[] = ["power", "volumeUp", "volumeDown", "mute"];
/** How long a failed key press stays on screen. */
const ERROR_MS = 4_000;

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const tvRemoteWidget = defineWidget({
  name: "tv-remote",
  displayName: "TV Remote",
  description: "Remote control for a Samsung TV, optionally with a waipu.tv 4K Stick.",
  defaultSize: { w: 3, h: 8 },
  minSize: { w: 3, h: 8 },
  mode: "expanded",
  capabilities: { tvRemote: true },
  configuration: {
    stick: {
      type: "boolean",
      label: "Use a waipu.tv 4K Stick / Android TV for navigation",
      default: false,
    },
    apps: {
      type: "select",
      label: "Streaming services",
      multiple: true,
      options: APP_BUTTONS.map((app) => ({ value: app.id, label: app.label })),
      default: DEFAULT_APPS,
    },
  },
  component: {
    setup(ctx: WidgetContext<TvRemoteConfig>): TvRemoteModel {
      const useStick = ctx.config.stick === true;
      const chosen = Array.isArray(ctx.config.apps) ? ctx.config.apps : DEFAULT_APPS;
      const apps = APP_BUTTONS.filter((app) => chosen.includes(app.id));
      const phase = ref<TvRemotePhase>("loading");
      const devices = ref<TvRemoteDevice[]>([]);
      const searching = ref(false);
      const manualHost = ref("");
      const tvHost = ref("");
      const stickHost = ref("");
      const busy = ref(false);
      const error = ref<string | null>(null);
      let pairingHost = "";
      let clearError: ReturnType<typeof setTimeout> | undefined;

      const remote = () => {
        if (!ctx.tvRemote) throw new Error("TV remote capability unavailable");
        return ctx.tvRemote;
      };

      const fail = (cause: unknown, fade = false) => {
        error.value = message(cause);
        clearTimeout(clearError);
        if (fade) clearError = setTimeout(() => (error.value = null), ERROR_MS);
      };

      /** Runs one setup step, showing its error and keeping the user on the same screen. */
      const step = async (work: () => Promise<void>) => {
        if (busy.value) return;
        busy.value = true;
        error.value = null;
        try {
          await work();
        } catch (cause) {
          fail(cause);
        } finally {
          busy.value = false;
        }
      };

      const search = async () => {
        if (searching.value) return;
        searching.value = true;
        try {
          devices.value = await remote().discover();
        } catch (cause) {
          fail(cause);
        } finally {
          searching.value = false;
        }
      };

      const enter = (next: TvRemotePhase) => {
        phase.value = next;
        manualHost.value = "";
        if (next === "findTv" || next === "findStick") void search();
      };

      /** After the TV: the stick when the settings ask for one, else the remote. */
      const afterTv = async () => {
        const paired = stickHost.value !== "" && (await remote().isPaired(stickHost.value));
        enter(useStick && !paired ? "findStick" : "ready");
      };

      void (async () => {
        try {
          tvHost.value = (await ctx.data.get<string>(TV_KEY)) ?? "";
          stickHost.value = (await ctx.data.get<string>(STICK_KEY)) ?? "";
          if (tvHost.value) await afterTv();
          else enter("findTv");
        } catch (cause) {
          enter("findTv");
          fail(cause);
        }
      })();

      onScopeDispose(() => clearTimeout(clearError));

      return {
        phase,
        candidates: computed(() =>
          devices.value.filter((device) =>
            phase.value === "findTv" ? device.kind === "samsung" : device.kind === "androidTv",
          ),
        ),
        searching,
        manualHost,
        tvHost,
        stickHost,
        apps,
        busy,
        error,
        search: () => void search(),
        choose: (host) =>
          void step(async () => {
            const target = host.trim();
            if (phase.value === "findTv") {
              await remote().samsungPair(target);
              await ctx.data.set(TV_KEY, target);
              tvHost.value = target;
              await afterTv();
            } else {
              await remote().pairStart(target);
              pairingHost = target;
              phase.value = "code";
            }
          }),
        submitCode: (code) =>
          void step(async () => {
            await remote().pairFinish(pairingHost, code);
            await ctx.data.set(STICK_KEY, pairingHost);
            stickHost.value = pairingHost;
            enter("ready");
          }),
        restart: () => {
          error.value = null;
          enter("findTv");
        },
        // Presses are not serialized: Rust queues them on one connection in order.
        press: (key) => {
          const toStick = useStick && stickHost.value !== "" && !TV_KEYS.includes(key);
          const sent = toStick
            ? remote().press(stickHost.value, key)
            : remote().samsungPress(tvHost.value, key);
          sent.catch((cause) => fail(cause, true));
        },
        // Apps start where navigation goes: on the stick when there is one.
        launch: (app) => {
          const sent =
            useStick && stickHost.value !== ""
              ? remote().launch(stickHost.value, app)
              : remote().samsungLaunch(tvHost.value, app);
          sent.catch((cause) => fail(cause, true));
        },
      };
    },
  },
});
