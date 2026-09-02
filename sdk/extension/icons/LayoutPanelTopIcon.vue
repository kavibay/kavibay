<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `layout-panel-top`, with its panels arriving from three directions. */
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
  <IconBase
    class="lmi-layout-panel-top"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <rect class="lmi-layout-panel-top-header" rx="1" x="3" y="3" width="18" height="7" />
    <rect class="lmi-layout-panel-top-left" rx="1" x="3" y="14" width="7" height="7" />
    <rect class="lmi-layout-panel-top-right" rx="1" x="14" y="14" width="7" height="7" />
  </IconBase>
</template>

<style>
/* Each panel rests at its final, visible position. */
.lmi-layout-panel-top-header {
  transform: translate(0, 0px);
  opacity: 1;
}

.lmi-layout-panel-top-left,
.lmi-layout-panel-top-right {
  transform: translate(0px, 0);
  opacity: 1;
}

@keyframes lmi-layout-panel-top-header {
  0% { transform: translate(0, -5px); opacity: 0; }
  100% { transform: translate(0, 0px); opacity: 1; }
}

@keyframes lmi-layout-panel-top-left {
  0% { transform: translate(-10px, 0); opacity: 0; }
  100% { transform: translate(0px, 0); opacity: 1; }
}

@keyframes lmi-layout-panel-top-right {
  0% { transform: translate(10px, 0); opacity: 0; }
  100% { transform: translate(0px, 0); opacity: 1; }
}

:is(
  .lmi-layout-panel-top[data-animated]:hover,
  [data-icon-motion]:hover .lmi-layout-panel-top[data-animated],
  [data-icon-motion="on"] .lmi-layout-panel-top[data-animated]
) .lmi-layout-panel-top-header {
  animation-name: lmi-layout-panel-top-header;
  animation-duration: 0.65s;
  animation-timing-function: ease;
  animation-fill-mode: both;
}

:is(
  .lmi-layout-panel-top[data-animated]:hover,
  [data-icon-motion]:hover .lmi-layout-panel-top[data-animated],
  [data-icon-motion="on"] .lmi-layout-panel-top[data-animated]
) .lmi-layout-panel-top-left {
  animation-name: lmi-layout-panel-top-left;
  animation-duration: 0.65s;
  animation-timing-function: ease;
  animation-fill-mode: both;
}

:is(
  .lmi-layout-panel-top[data-animated]:hover,
  [data-icon-motion]:hover .lmi-layout-panel-top[data-animated],
  [data-icon-motion="on"] .lmi-layout-panel-top[data-animated]
) .lmi-layout-panel-top-right {
  animation-name: lmi-layout-panel-top-right;
  animation-duration: 0.65s;
  animation-timing-function: ease;
  animation-fill-mode: both;
}
</style>
