<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `panel-left`. */
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
  <IconBase class="lmi-panel-left" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
  </IconBase>
</template>
