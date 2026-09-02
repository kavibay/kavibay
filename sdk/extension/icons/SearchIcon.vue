<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `search`. */
import IconBase from "./IconBase.vue";

withDefaults(
  defineProps<{
    size?: number | string;
    strokeWidth?: number | string;
    animated?: boolean;
  }>(),
  { size: 24, strokeWidth: 2, animated: false },
);
</script>

<template>
  <IconBase class="lmi-search" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path d="m21 21-4.34-4.34" />
    <circle cx="11" cy="11" r="8" />
  </IconBase>
</template>
