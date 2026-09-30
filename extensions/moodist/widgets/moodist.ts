// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import {
  DEFAULT_CATEGORY_ID,
  clearVolumes,
  emptyState,
  normalizeState,
  setSoundVolume,
  stateForDuplicate,
  toggleSound as toggleSoundInVolumes,
  type MoodistPersisted,
} from "../moodistLogic";
import type { MoodistCategory, MoodistSound } from "../catalog";
import { createLoopPlayer } from "../loopPlayer";

export const MOODIST_DATA_KEY = "state";
const DEBOUNCE_MS = 300;

export interface MoodistRuntime extends MoodistPersisted {
  playing: boolean;
}

export interface MoodistModel {
  state: Ref<MoodistRuntime>;
  setCategory(categoryId: string): void;
  toggleSound(soundId: string, defaultVolume?: number): void;
  setVolume(soundId: string, volume: number): void;
  togglePlay(): void;
  clear(): void;
}

function persistable(state: MoodistRuntime): MoodistPersisted {
  return {
    version: 1,
    activeCategoryId: state.activeCategoryId,
    volumes: state.volumes,
  };
}

/** Normalize persisted data after the Vite catalog has supplied its ids. */
export function duplicateMoodistData(key: string, value: unknown): unknown {
  return key === MOODIST_DATA_KEY && value && typeof value === "object"
    ? stateForDuplicate(value as MoodistPersisted)
    : value;
}

export const moodistWidget = defineWidget({
  name: "moodist",
  displayName: "Moodist",
  description: "Mix rain, nature sounds and noise for focus.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  mode: "both",
  duplicateData: true,
  duplicateDataTransform: duplicateMoodistData,
  component: {
    setup(ctx: WidgetContext): MoodistModel {
      const state = ref<MoodistRuntime>({
        ...emptyState(DEFAULT_CATEGORY_ID),
        playing: false,
      });
      const player = createLoopPlayer();
      let categories: MoodistCategory[] = [];
      let persistTimer: ReturnType<typeof setTimeout> | undefined;
      let alive = true;

      function findSound(soundId: string): MoodistSound | undefined {
        for (const category of categories) {
          const sound = category.sounds.find((item) => item.id === soundId);
          if (sound) return sound;
        }
        return undefined;
      }

      function tearDownAllAudio(): void {
        for (const soundId of Object.keys(state.value.volumes)) player.remove(soundId);
      }

      function syncSoundAudio(soundId: string, volume: number, playing: boolean): void {
        const sound = findSound(soundId);
        if (volume <= 0 || !sound || (!sound.src && !sound.noise)) {
          player.remove(soundId);
          return;
        }
        player.set(soundId, sound, volume);
        if (playing) player.play();
        else player.pause();
      }

      function syncAllActiveAudio(): void {
        for (const [soundId, volume] of Object.entries(state.value.volumes)) {
          if (volume > 0) syncSoundAudio(soundId, volume, state.value.playing);
        }
      }

      function persistNow(): void {
        if (!categories.length || !alive) return;
        if (persistTimer !== undefined) {
          clearTimeout(persistTimer);
          persistTimer = undefined;
        }
        const opts = {
          defaultCategoryId: categories[0]!.id,
          categoryIds: new Set(categories.map((category) => category.id)),
          soundIds: new Set(categories.flatMap((category) => category.sounds.map((sound) => sound.id))),
        };
        void ctx.data.set(MOODIST_DATA_KEY, normalizeState(persistable(state.value), opts));
      }

      function schedulePersist(): void {
        if (persistTimer !== undefined) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
          persistTimer = undefined;
          persistNow();
        }, DEBOUNCE_MS);
      }

      function setCategory(categoryId: string): void {
        state.value = { ...state.value, activeCategoryId: categoryId };
        schedulePersist();
      }

      function toggleSound(soundId: string, defaultVolume = 0.5): void {
        const wasActive = (state.value.volumes[soundId] ?? 0) > 0;
        const volumes = toggleSoundInVolumes(state.value.volumes, soundId, defaultVolume);
        const nowActive = (volumes[soundId] ?? 0) > 0;
        const hasMix = Object.values(volumes).some((volume) => volume > 0);
        state.value = {
          ...state.value,
          volumes,
          playing: nowActive ? true : hasMix && state.value.playing,
        };
        schedulePersist();
        if (nowActive && !wasActive) syncAllActiveAudio();
        else syncSoundAudio(soundId, volumes[soundId] ?? 0, state.value.playing);
      }

      function setVolume(soundId: string, volume: number): void {
        const wasActive = (state.value.volumes[soundId] ?? 0) > 0;
        const volumes = setSoundVolume(state.value.volumes, soundId, volume);
        const nowActive = (volumes[soundId] ?? 0) > 0;
        const hasMix = Object.values(volumes).some((item) => item > 0);
        state.value = {
          ...state.value,
          volumes,
          playing: nowActive ? true : hasMix && state.value.playing,
        };
        schedulePersist();
        if (nowActive && !wasActive) syncAllActiveAudio();
        else syncSoundAudio(soundId, volumes[soundId] ?? 0, state.value.playing);
      }

      function play(): void {
        const entries = Object.entries(state.value.volumes).filter(([, volume]) => volume > 0);
        if (!entries.length) {
          state.value = { ...state.value, playing: false };
          return;
        }
        state.value = { ...state.value, playing: true };
        syncAllActiveAudio();
      }

      function pause(): void {
        player.pause();
        state.value = { ...state.value, playing: false };
      }

      function togglePlay(): void {
        if (state.value.playing) pause();
        else play();
      }

      function clear(): void {
        tearDownAllAudio();
        state.value = { ...state.value, volumes: clearVolumes(), playing: false };
        schedulePersist();
      }

      const catalogReady = import("../catalog").then(async (catalog) => {
        categories = catalog.categories;
        const raw = await ctx.data.get<MoodistPersisted>(MOODIST_DATA_KEY);
        if (!alive) return;
        const opts = {
          defaultCategoryId: catalog.defaultCategoryId(),
          categoryIds: catalog.allCategoryIds(),
          soundIds: catalog.allSoundIds(),
        };
        state.value = { ...normalizeState(raw, opts), playing: false };
        syncAllActiveAudio();
      });

      void catalogReady.catch(() => {
        // The host will show the regular setup failure if the catalog cannot load.
      });

      onScopeDispose(() => {
        if (persistTimer !== undefined) clearTimeout(persistTimer);
        persistNow();
        alive = false;
        player.dispose();
      });

      return { state, setCategory, toggleSound, setVolume, togglePlay, clear };
    },
  },
});
