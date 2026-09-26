<script setup lang="ts">
import { computed } from "vue";
import { headerLabel, idleHint, nowPlayingView } from "./nowPlayingLogic";
import type { NowPlayingModel } from "./widgets/nowPlaying";

const props = defineProps<{ model: NowPlayingModel }>();
const { info, error, onPrev, onPlayPause, onNext, onOpenSource, onConnect } = props.model;
const label = computed(() => headerLabel(info.value));
const view = computed(() => nowPlayingView(info.value));
const active = computed(() => view.value === "session");
</script>

<template>
  <div class="np" :class="{ 'np--empty': !active }">
    <div class="np-header">
      <div class="np-source">
        <span class="np-glyph" aria-hidden="true">♪</span>
        <span class="np-app">{{ label }}</span>
      </div>
      <button
        type="button"
        class="np-chevron"
        v-tip="'Open source app'"
        aria-label="Open source app"
        :disabled="!active"
        @pointerdown.stop
        @click.stop="onOpenSource"
      >
        ›
      </button>
    </div>

    <div class="np-main">
      <div class="np-meta">
        <template v-if="view === 'session'">
          <p class="np-title">{{ info.title || "Unknown title" }}</p>
          <p class="np-artist">{{ info.artist || "Unknown artist" }}</p>
        </template>
        <template v-else-if="view === 'needsConsent'">
          <p class="np-title np-title--muted">{{ info.player }} is open</p>
          <button
            type="button"
            class="np-connect"
            @pointerdown.stop
            @click.stop="onConnect"
          >
            Connect {{ info.player }}
          </button>
        </template>
        <template v-else-if="view === 'denied'">
          <p class="np-title np-title--muted">No access to {{ info.player }}</p>
          <p class="np-artist">
            Allow Kavibay under System Settings › Privacy &amp; Security › Automation.
          </p>
        </template>
        <template v-else>
          <p class="np-title np-title--muted">Nothing playing</p>
          <p class="np-artist">{{ idleHint(info) }}</p>
        </template>
      </div>
      <div class="np-art" aria-hidden="true">
        <img
          v-if="active && info.album_art_data_url"
          class="np-art-img"
          :src="info.album_art_data_url"
          alt=""
        />
      </div>
    </div>

    <div class="np-controls">
      <button
        type="button"
        class="np-btn"
        aria-label="Previous"
        :disabled="!active"
        @pointerdown.stop
        @click.stop="onPrev"
      >
        ⏮
      </button>
      <button
        type="button"
        class="np-btn np-btn--main"
        :aria-label="info.is_playing ? 'Pause' : 'Play'"
        :disabled="!active"
        @pointerdown.stop
        @click.stop="onPlayPause"
      >
        {{ active && info.is_playing ? "⏸" : "▶" }}
      </button>
      <button
        type="button"
        class="np-btn"
        aria-label="Next"
        :disabled="!active"
        @pointerdown.stop
        @click.stop="onNext"
      >
        ⏭
      </button>
    </div>

    <p v-if="error && !info.has_session" class="np-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.np {
  box-sizing: border-box;
  width: 320px;
  padding: 20px 22px 18px;
  background: #282828;
  color: #fff;
  line-height: 1.3;
  font-family: inherit;
}

.np-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.np-source {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.np-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #1db954;
  color: #000;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.np--empty .np-glyph {
  background: #555;
  color: transparent;
}

.np-app {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np--empty .np-app {
  color: rgba(var(--fg-rgb), 0.55);
}

.np-chevron {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: #3a3a3a;
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.08s ease, background 0.12s ease;
}

.np-chevron:hover:not(:disabled) {
  background: #454545;
}

.np-chevron:active:not(:disabled) {
  transform: scale(0.92);
}

.np-chevron:disabled {
  color: rgba(var(--fg-rgb), 0.35);
  cursor: default;
}

.np-connect {
  margin-top: 8px;
  padding: 6px 12px;
  border: none;
  border-radius: 8px;
  background: #3a3a3a;
  color: #fff;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: transform 0.08s ease, background 0.12s ease;
}

.np-connect:hover {
  background: #454545;
}

.np-connect:active {
  transform: scale(0.96);
}

.np-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.np-meta {
  min-width: 0;
  flex: 1;
}

.np-title {
  margin: 0 0 4px;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-title--muted {
  font-size: 20px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.45);
}

.np-artist {
  margin: 0;
  font-size: 14px;
  color: rgba(var(--fg-rgb), 0.65);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np--empty .np-artist {
  color: rgba(var(--fg-rgb), 0.3);
}

.np-art {
  width: 72px;
  height: 72px;
  border-radius: 12px;
  flex-shrink: 0;
  background: #3a3a3a;
  overflow: hidden;
}

.np-art-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.np-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 36px;
}

.np-btn {
  border: none;
  padding: 0;
  background: transparent;
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.08s ease, opacity 0.12s ease;
}

.np-btn--main {
  font-size: 22px;
}

.np-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.np-btn:active:not(:disabled) {
  transform: scale(0.88);
}

.np-btn:disabled {
  color: rgba(var(--fg-rgb), 0.25);
  cursor: default;
}

.np-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: #ff8080;
}
</style>
