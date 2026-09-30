<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `folder`. */
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
  <IconBase class="lmi-folder" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <!-- A sheet behind the front. Only painted inside a tile; outside it the
         Lucide mark is unchanged. -->
    <rect class="lmi-folder-paper" x="11.5" y="3.5" width="8.5" height="7" rx="1" />
    <path class="lmi-folder-body" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </IconBase>
</template>

<style>
/* A blue folder with paper in it. Tile colours — see ListTodoIcon.vue for how the host reads them. */
[data-icon-tile]:has(> .lmi-folder) {
  --icon-tile-bg: rgba(59, 130, 246, 0.2);
  --icon-tile-fg: #bfdbfe;
  --lmi-folder-fill: #60a5fa;
  --lmi-folder-paper: #f8fafc;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-folder) {
  --icon-tile-bg: rgba(59, 130, 246, 0.14);
  --icon-tile-fg: #1e3a8a;
  --lmi-folder-fill: #3b82f6;
  --lmi-folder-paper: #ffffff;
}

.lmi-folder-body {
  fill: var(--lmi-folder-fill, none);
  stroke: var(--lmi-folder-fill, currentColor);
}

.lmi-folder-paper {
  fill: var(--lmi-folder-paper, none);
  stroke: none;
  transform: translateY(0);
}

/* Down into the folder, up a little too far, then home: filed. */
@keyframes lmi-folder-paper {
  0% { transform: translateY(3px); }
  60% { transform: translateY(-1.5px); }
  100% { transform: translateY(0); }
}

/* Same three ways in as every other animated icon — see ClipboardListIcon.vue. */
:is(
  .lmi-folder[data-animated]:hover,
  [data-icon-motion]:hover .lmi-folder[data-animated],
  [data-icon-motion="on"] .lmi-folder[data-animated]
)
  .lmi-folder-paper {
  animation-name: lmi-folder-paper;
  animation-duration: 0.45s;
  animation-timing-function: cubic-bezier(0.22, 0.9, 0.3, 1);
  animation-fill-mode: both;
}
</style>
