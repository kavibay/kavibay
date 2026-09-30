<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `wand-sparkles`. */
import IconBase from "./IconBase.vue";

withDefaults(defineProps<{ size?: number | string; strokeWidth?: number | string; animated?: boolean }>(), {
  size: 24,
  strokeWidth: 2,
  animated: false,
});
</script>

<template>
  <IconBase class="lmi-wand-sparkles" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
    <path d="m14 7 3 3" />
    <path d="M5 6v4" />
    <path d="M19 14v4" />
    <path d="M10 2v2" />
    <path d="M7 8H3" />
    <path d="M21 16h-4" />
    <path d="M11 3H9" />
  </IconBase>
</template>

<style>
/* Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-wand-sparkles) {
  --icon-tile-bg: rgba(245, 158, 11, 0.2);
  --icon-tile-fg: #fcd34d;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-wand-sparkles) {
  --icon-tile-bg: rgba(245, 158, 11, 0.16);
  --icon-tile-fg: #92400e;
}
</style>
