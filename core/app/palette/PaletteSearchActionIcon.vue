<script setup lang="ts">
import BrandMark from "@sdk/brand/BrandMark.vue";
import GoogleMark from "@sdk/brand/GoogleMark.vue";
import DuckDuckGoMark from "@sdk/brand/DuckDuckGoMark.vue";
import OpenAiMark from "@sdk/brand/OpenAiMark.vue";
import ClaudeMark from "@sdk/brand/ClaudeMark.vue";
import ecosiaMark from "@sdk/brand/assets/ecosia.ico";
import braveMark from "@sdk/brand/assets/brave.ico";
import bingMark from "@sdk/brand/assets/bing.ico";
import { SparklesIcon } from "@sdk/icons";
import type { SearchActionId } from "./searchActions";

withDefaults(defineProps<{ action: SearchActionId; aiProvider?: string; size?: number }>(), { size: 22 });
const imageMarks: Partial<Record<SearchActionId, string>> = { ecosia: ecosiaMark, brave: braveMark, bing: bingMark };
</script>

<template>
  <span class="search-action-icon" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <BrandMark v-if="action === 'ai' && aiProvider" :provider="aiProvider" :size="size" />
    <SparklesIcon v-else-if="action === 'ai'" :size="size" />
    <GoogleMark v-else-if="action === 'google'" :size="size" />
    <DuckDuckGoMark v-else-if="action === 'duckduckgo'" :size="size" />
    <OpenAiMark v-else-if="action === 'chatgpt'" :size="size" />
    <ClaudeMark v-else-if="action === 'claude'" :size="size" />
    <img v-else-if="imageMarks[action]" :src="imageMarks[action]" :width="size" :height="size" alt="" :draggable="false" />
    <span v-if="action === 'ai'" class="api-badge">API</span>
  </span>
</template>

<style scoped>
.search-action-icon { position: relative; display: inline-flex; flex: 0 0 auto; }
.api-badge { position: absolute; right: -6px; bottom: -4px; padding: 1px 2px; border: 1px solid rgba(var(--fg-rgb), 0.3); border-radius: 3px; background: rgb(var(--surface-bg-rgb)); color: var(--text); font-family: sans-serif; font-size: 7px; font-weight: 700; line-height: 1; }
</style>
