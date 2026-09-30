<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `moon`. */
import IconBase from "./IconBase.vue";

withDefaults(defineProps<{ size?: number | string; strokeWidth?: number | string; animated?: boolean }>(), {
  size: 24,
  strokeWidth: 2,
  animated: false,
});
</script>

<template>
  <IconBase :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </IconBase>
</template>
