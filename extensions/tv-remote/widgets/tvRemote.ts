// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, type Ref } from "vue";
import { defineWidget, type TvRemoteKey, type WidgetContext } from "@sdk/contract/sdk";

/** Setup asks for the address, pairing waits for the code, ready shows the remote. */
export type TvRemotePhase = "loading" | "setup" | "pairing" | "ready";

export interface TvRemoteModel {
  phase: Ref<TvRemotePhase>;
  host: Ref<string>;
  busy: Ref<boolean>;
  error: Ref<string | null>;
  startPairing(): void;
  finishPairing(code: string): void;
  changeTv(): void;
  press(key: TvRemoteKey): void;
}

const HOST_KEY = "host";
/** How long a failed key press stays on screen. */
const ERROR_MS = 4_000;

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const tvRemoteWidget = defineWidget({
  name: "tv-remote",
  displayName: "TV Remote",
  description: "Remote control for an Android TV or Google TV device.",
  defaultSize: { w: 3, h: 8 },
  minSize: { w: 3, h: 8 },
  mode: "expanded",
  capabilities: { tvRemote: true },
  component: {
    setup(ctx: WidgetContext): TvRemoteModel {
      const phase = ref<TvRemotePhase>("loading");
      const host = ref("");
      const busy = ref(false);
      const error = ref<string | null>(null);
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

      /** Runs one step of setup, showing its error and keeping the user on the same screen. */
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

      void (async () => {
        try {
          const saved = await ctx.data.get<string>(HOST_KEY);
          host.value = saved ?? "";
          phase.value = saved && (await remote().isPaired(saved)) ? "ready" : "setup";
        } catch (cause) {
          phase.value = "setup";
          fail(cause);
        }
      })();

      onScopeDispose(() => clearTimeout(clearError));

      return {
        phase,
        host,
        busy,
        error,
        startPairing: () =>
          void step(async () => {
            host.value = host.value.trim();
            await remote().pairStart(host.value);
            phase.value = "pairing";
          }),
        finishPairing: (code) =>
          void step(async () => {
            await remote().pairFinish(host.value, code);
            await ctx.data.set(HOST_KEY, host.value);
            phase.value = "ready";
          }),
        changeTv: () => {
          error.value = null;
          phase.value = "setup";
        },
        // Presses are not serialized: Rust queues them on one connection in order.
        press: (key) => {
          remote().press(host.value, key).catch((cause) => fail(cause, true));
        },
      };
    },
  },
});
