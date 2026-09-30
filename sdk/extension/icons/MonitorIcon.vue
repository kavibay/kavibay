<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `monitor`. */
import IconBase from "./IconBase.vue";

withDefaults(defineProps<{ size?: number | string; strokeWidth?: number | string; animated?: boolean }>(), {
  size: 24,
  strokeWidth: 2,
  animated: false,
});
</script>

<template>
  <IconBase :size="size" :stroke-width="strokeWidth" :animated="animated">
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </IconBase>
</template>
