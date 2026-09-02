<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `server-plus`. */
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
  <IconBase class="lmi-server-plus" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <path d="M12.5 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2" />
    <path d="M16 12h6" />
    <path d="M19 9v6" />
    <path d="M22 18v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h8.5" />
    <path d="M6 18h.01" />
    <path d="M6 6h.01" />
  </IconBase>
</template>
