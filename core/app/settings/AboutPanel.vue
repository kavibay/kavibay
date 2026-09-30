<script setup lang="ts">
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { SquareArrowOutUpRightIcon } from "@sdk/icons";
import { version } from "../../../src-tauri/tauri.conf.json";
import logo from "../../../src-tauri/icons/icon.svg";

const links = ["https://github.com/kavibay/kavibay", "https://www.kavibay.com"];
const linkError = ref("");
</script>

<template>
  <Teleport to=".settings-sticky">
    <h2 class="about-title">About</h2>
  </Teleport>
  <div class="about">
    <img :src="logo" alt="Kavibay logo" width="112" height="112" />
    <h3 class="about-name">Kavibay</h3>
    <p class="about-version">Version {{ version }}</p>
    <a
      v-for="url in links"
      :key="url"
      class="about-link"
      :href="url"
      @click.prevent="linkError = ''; invoke('launch_path', { path: url }).catch(() => {
        linkError = 'Could not open the link. Please open it in your browser.';
      })"
    >
      {{ url.replace('https://', '') }}
      <SquareArrowOutUpRightIcon :size="14" />
    </a>
    <p v-if="linkError" class="settings-section-hint" role="alert">{{ linkError }}</p>
  </div>
</template>

<style scoped>
.about-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.about {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px 0;
  text-align: center;
}

.about-name {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.about-version {
  margin: 0;
  color: rgba(var(--fg-rgb), 0.6);
  font-size: 14px;
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 13px;
  text-underline-offset: 4px;
  overflow-wrap: anywhere;
}

.about-link:hover,
.about-link:focus-visible {
  color: rgb(var(--fg-rgb));
}
</style>
