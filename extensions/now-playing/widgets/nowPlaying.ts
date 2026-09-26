// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import {
  defineWidget,
  type NowPlayingControl,
  type WidgetContext,
} from "@sdk/contract/sdk";
import {
  emptyNowPlaying,
  normalizeNowPlaying,
  PLAY_STATE_GRACE_MS,
  settlePlayState,
  type ExpectedPlayState,
  type NowPlayingInfo,
} from "../nowPlayingLogic";

export interface NowPlayingModel {
  info: ComputedRef<NowPlayingInfo>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  onPrev(): void;
  onPlayPause(): void;
  onNext(): void;
  onOpenSource(): void;
  onConnect(): void;
}

const REFRESH_MS = 1_000;

export const nowPlayingWidget = defineWidget({
  name: "now-playing",
  displayName: "Now Playing",
  description: "Currently playing media session.",
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 3, h: 2 },
  mode: "both",
  capabilities: { nowPlaying: true },
  component: {
    setup(ctx: WidgetContext): NowPlayingModel {
      const display = ref<NowPlayingInfo>(emptyNowPlaying());
      const loading = ref(false);
      const error = ref<string | null>(null);
      const pending = ref(false);
      let request: Promise<void> | undefined;
      let alive = true;
      let expected: ExpectedPlayState | null = null;

      /** Every snapshot goes through here, so a sent play/pause is not undone by a stale one. */
      const show = (snapshot: NowPlayingInfo) => {
        const settled = settlePlayState(snapshot, expected, Date.now());
        expected = settled.expected;
        display.value = settled.info;
      };

      const readSnapshot = async (): Promise<NowPlayingInfo> => {
        if (!ctx.nowPlaying) throw new Error("Now Playing capability unavailable");
        return normalizeNowPlaying(await ctx.nowPlaying.snapshot<NowPlayingInfo>());
      };

      const refresh = (): Promise<void> => {
        if (pending.value || request) return request ?? Promise.resolve();
        loading.value = true;
        request = (async () => {
          try {
            const snapshot = await readSnapshot();
            if (!alive) return;
            show(snapshot);
            error.value = null;
          } catch (cause) {
            if (alive) error.value = cause instanceof Error ? cause.message : String(cause);
          }
        })().finally(() => {
          loading.value = false;
          request = undefined;
        });
        return request;
      };

      async function runControl(action: NowPlayingControl, optimistic?: Partial<NowPlayingInfo>) {
        if (!ctx.nowPlaying) return;
        if (action !== "connect" && !display.value.has_session) return;
        if (optimistic) display.value = { ...display.value, ...optimistic };
        pending.value = true;
        try {
          await ctx.nowPlaying.control(action);
          show(await readSnapshot());
          error.value = null;
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
          expected = null;
          try {
            display.value = await readSnapshot();
          } catch {
            // Keep the last display if the recovery snapshot also fails.
          }
        } finally {
          pending.value = false;
        }
      }

      const onPrev = () => { void runControl("previous"); };
      const onPlayPause = () => {
        if (!display.value.has_session) return;
        const isPlaying = !display.value.is_playing;
        expected = { isPlaying, untilMs: Date.now() + PLAY_STATE_GRACE_MS };
        void runControl("playPause", { is_playing: isPlaying });
      };
      const onNext = () => { void runControl("next"); };
      const onOpenSource = () => { void runControl("openSource"); };
      const onConnect = () => { void runControl("connect"); };

      const timer = ctx.nowPlaying ? setInterval(() => void refresh(), REFRESH_MS) : undefined;
      onScopeDispose(() => {
        alive = false;
        if (timer !== undefined) clearInterval(timer);
      });

      void refresh();
      return {
        info: computed(() => display.value),
        loading,
        error,
        onPrev,
        onPlayPause,
        onNext,
        onOpenSource,
        onConnect,
      };
    },
  },
});
