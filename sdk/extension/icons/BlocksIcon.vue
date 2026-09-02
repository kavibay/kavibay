<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `blocks`. */
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
  <IconBase class="lmi-blocks" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path
      d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2"
    />
    <rect x="14" y="2" width="8" height="8" rx="1" />
  </IconBase>
</template>
