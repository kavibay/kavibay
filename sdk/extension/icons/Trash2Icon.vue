<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `trash-2`. */
import IconBase from "./IconBase.vue";

withDefaults(defineProps<{ size?: number | string; strokeWidth?: number | string; animated?: boolean }>(), {
  size: 24,
  strokeWidth: 2,
  animated: false,
});
</script>

<template>
  <IconBase :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </IconBase>
</template>
