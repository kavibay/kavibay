<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `server`. */
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
  <IconBase class="lmi-server" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
    <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
    <path d="M6 6h.01" />
    <path d="M6 18h.01" />
  </IconBase>
</template>
