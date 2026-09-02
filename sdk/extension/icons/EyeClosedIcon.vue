<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `eye-closed`. */
import IconBase from "./IconBase.vue";

withDefaults(defineProps<{ size?: number | string; strokeWidth?: number | string; animated?: boolean }>(), {
  size: 24,
  strokeWidth: 2,
  animated: false,
});
</script>

<template>
  <IconBase :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path d="m15 18-.722-3.25" />
    <path d="M2 8a10.645 10.645 0 0 0 20 0" />
    <path d="m20 15-1.726-2.05" />
    <path d="m4 15 1.726-2.05" />
    <path d="m9 18 .722-3.25" />
  </IconBase>
</template>
