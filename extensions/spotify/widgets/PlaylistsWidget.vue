<script setup lang="ts">
// SPDX-License-Identifier: MIT
import type { PlaylistsModel } from "./playlists";

const props = defineProps<{ model: PlaylistsModel }>();
const model = props.model;
const items = model.items;
</script>

<template>
  <div class="spl" data-interactive @pointerdown.stop>
    <p v-if="items.length === 0" class="spl-empty">{{ model.emptyLabel }}</p>
    <ul v-else class="spl-list">
      <li v-for="playlist in items" :key="playlist.id">
        <button
          type="button"
          class="spl-row"
          :title="playlist.url"
          :disabled="!playlist.url"
          @click="model.openPlaylist(playlist)"
        >
          <img
            v-if="playlist.imageUrl"
            class="spl-cover"
            :src="playlist.imageUrl"
            alt=""
          >
          <span v-else class="spl-cover spl-cover--empty" aria-hidden="true" />
          <span class="spl-text">
            <span class="spl-name">{{ playlist.name }}</span>
            <span class="spl-meta">{{ model.meta(playlist) }}</span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.spl {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 8px 10px;
  box-sizing: border-box;
  overflow: hidden;
}
.spl-empty {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.6);
}
.spl-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.spl-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.spl-row:hover,
.spl-row:focus-visible {
  background: rgba(var(--fg-rgb), 0.08);
  outline: none;
}
.spl-row:disabled {
  cursor: default;
  opacity: 0.55;
}
.spl-cover {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  object-fit: cover;
  background: rgba(var(--fg-rgb), 0.08);
}
.spl-cover--empty {
  display: block;
}
.spl-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.spl-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.92);
}
.spl-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.55);
}
</style>
