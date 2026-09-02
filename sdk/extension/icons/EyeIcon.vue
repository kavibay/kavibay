<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `eye`. */
import IconBase from "./IconBase.vue";

withDefaults(defineProps<{ size?: number | string; strokeWidth?: number | string; animated?: boolean }>(), {
  size: 24,
  strokeWidth: 2,
  animated: false,
});
</script>

<template>
  <IconBase :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </IconBase>
</template>
