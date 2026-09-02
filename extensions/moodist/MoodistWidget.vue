<script setup lang="ts">
import { computed } from "vue";
import { categories, findCategory, soundsForCategory } from "./catalog";
import { moodistIconOrFallback } from "./icons";
import { isActive } from "./moodistLogic";
import type { MoodistModel } from "./widgets/moodist";

// Ambient mixer fills whichever host surface renders it (card or inline panel).
const props = defineProps<{ model: MoodistModel }>();

const {
  state,
  setCategory,
  toggleSound,
  setVolume,
  togglePlay,
  clear,
} = props.model;

/** Sounds listed under the active browse category. */
const soundRows = computed(() => soundsForCategory(state.value.activeCategoryId));

/** Title of the active category (empty if unknown). */
const categoryTitle = computed(
  () => findCategory(state.value.activeCategoryId)?.title ?? "",
);

/** Volume for a sound id (0 when not in the mix). */
function volumeOf(soundId: string): number {
  return state.value.volumes[soundId] ?? 0;
}

/** Whether a sound is currently in the mix. */
function rowActive(soundId: string): boolean {
  return isActive(state.value.volumes, soundId);
}

/** Resolve catalog icon for inline SVG rendering (always returns a def). */
function iconPaths(iconId: string) {
  return moodistIconOrFallback(iconId);
}

/** Toggle a sound from a row click (not from the slider). */
function onRowClick(soundId: string): void {
  toggleSound(soundId);
}

/** Apply slider volume; >0 activates the sound into the mix. */
function onVolumeInput(soundId: string, event: Event): void {
  const target = event.target as HTMLInputElement;
  setVolume(soundId, Number(target.value));
}
</script>

<template>
  <div
    class="moodist"
    data-interactive
    @pointerdown.stop
  >
    <!-- Category icon strip -->
    <div class="moodist-cats" role="tablist" aria-label="Categories">
      <button
        v-for="cat in categories"
        :key="cat.id"
        type="button"
        class="moodist-cat"
        :class="{ 'moodist-cat--active': state.activeCategoryId === cat.id }"
        role="tab"
        :aria-selected="state.activeCategoryId === cat.id"
        v-tip="cat.title"
        :aria-label="cat.title"
        @click="setCategory(cat.id)"
      >
        <svg
          class="moodist-icon"
          :viewBox="iconPaths(cat.icon).viewBox"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path
            v-for="(d, i) in iconPaths(cat.icon).paths"
            :key="i"
            :fill="iconPaths(cat.icon).color"
            :d="d"
          />
        </svg>
      </button>
    </div>

    <!-- Play / Pause + Clear -->
    <div class="moodist-controls">
      <button
        type="button"
        class="moodist-play"
        :aria-label="state.playing ? 'Pause' : 'Play'"
        @click="togglePlay"
      >
        {{ state.playing ? "Pause" : "Play" }}
      </button>
      <button
        type="button"
        class="moodist-clear"
        v-tip="'Clear mix'"
        aria-label="Clear mix"
        @click="clear"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M6 7h12v2H6V7zm2 3h8l-.7 10H8.7L8 10zm3-5h2l1 1h4v2H6V6h4l1-1z"
          />
        </svg>
      </button>
    </div>

    <p v-if="categoryTitle" class="moodist-cat-title">{{ categoryTitle }}</p>

    <!-- Scrollable sound rows -->
    <ul class="moodist-list" @wheel.stop>
      <li
        v-for="sound in soundRows"
        :key="sound.id"
        class="moodist-row"
        :class="{ 'moodist-row--active': rowActive(sound.id) }"
        @click="onRowClick(sound.id)"
      >
        <svg
          class="moodist-row-icon"
          :viewBox="iconPaths(sound.icon).viewBox"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <path
            v-for="(d, i) in iconPaths(sound.icon).paths"
            :key="i"
            :fill="iconPaths(sound.icon).color"
            :d="d"
          />
        </svg>
        <span class="moodist-row-label">{{ sound.label }}</span>
        <input
          class="moodist-slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="volumeOf(sound.id)"
          :aria-label="`${sound.label} volume`"
          @click.stop
          @pointerdown.stop
          @input.stop="onVolumeInput(sound.id, $event)"
        />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.moodist {
  width: 100%;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;
  padding: 2px 2px 4px;
  color: rgba(var(--fg-rgb), 0.92);
  cursor: default;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.moodist-cats {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.moodist-cat {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.45);
  cursor: pointer;
}

.moodist-cat .moodist-icon {
  opacity: 0.55;
}

.moodist-cat:hover {
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.75);
}

.moodist-cat:hover .moodist-icon {
  opacity: 0.85;
}

.moodist-cat--active {
  background: rgba(var(--fg-rgb), 0.12);
  border-color: rgba(var(--fg-rgb), 0.18);
  color: rgba(var(--fg-rgb), 0.95);
}

.moodist-cat--active .moodist-icon {
  opacity: 1;
}

.moodist-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-shrink: 0;
}

.moodist-play {
  appearance: none;
  flex: 1;
  padding: 7px 12px;
  border: none;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(var(--fg-rgb), 0.14);
  color: rgba(var(--fg-rgb), 0.95);
}

.moodist-play:hover {
  background: rgba(var(--fg-rgb), 0.2);
}

.moodist-clear {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.04);
  color: rgba(var(--fg-rgb), 0.55);
  cursor: pointer;
  flex-shrink: 0;
}

.moodist-clear:hover {
  background: rgba(var(--fg-rgb), 0.1);
  color: rgba(var(--fg-rgb), 0.85);
}

.moodist-cat-title {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.45);
  flex-shrink: 0;
}

.moodist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.moodist-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px 6px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.4);
  cursor: pointer;
}

.moodist-row:hover {
  background: rgba(var(--fg-rgb), 0.04);
  color: rgba(var(--fg-rgb), 0.7);
}

.moodist-row--active {
  background: rgba(var(--fg-rgb), 0.08);
  border-color: rgba(var(--fg-rgb), 0.14);
  color: rgba(var(--fg-rgb), 0.92);
}

.moodist-row-icon {
  flex-shrink: 0;
  opacity: 0.9;
}

.moodist-row:not(.moodist-row--active) .moodist-row-icon {
  opacity: 0.45;
}

.moodist-row-label {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}

.moodist-slider {
  flex: 1 1 auto;
  min-width: 64px;
  height: 18px;
  margin: 0;
  cursor: pointer;
  accent-color: rgba(var(--fg-rgb), 0.7);
}

.moodist-row:not(.moodist-row--active) .moodist-slider {
  opacity: 0.45;
}
</style>
