<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `alarm-clock`, with its hands and bells ringing briefly. */
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
    class="lmi-alarm-clock"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <g class="lmi-alarm-clock-g">
      <circle cx="12" cy="13" r="8" />
      <line class="lmi-alarm-clock-hand lmi-alarm-clock-line1" x1="12" y1="9" x2="12" y2="13" />
      <line class="lmi-alarm-clock-hand lmi-alarm-clock-line2" x1="14" y1="15" x2="12" y2="13" />
      <path class="lmi-alarm-clock-bell" d="M5 3 2 6" />
      <path class="lmi-alarm-clock-bell" d="m22 6-3-3" />
      <path d="M6.38 18.7 4 21" />
      <path d="M17.64 18.67 20 21" />
    </g>
  </IconBase>
</template>

<style>
/* The static state matches the final animation frame, so it renders correctly
   when motion is not requested. */
.lmi-alarm-clock-g {
  transform-box: view-box;
  transform-origin: center;
  transform: translate(0px, 0px);
}

.lmi-alarm-clock-hand {
  transform-box: fill-box;
  transform: rotate(0deg);
}

.lmi-alarm-clock-line1 {
  transform-origin: bottom left;
}

.lmi-alarm-clock-line2 {
  transform-origin: top left;
}

.lmi-alarm-clock-bell {
  transform: translate(0px, 0);
}

@keyframes lmi-alarm-clock-hand-shake {
  0% { transform: rotate(0deg); }
  9.09% { transform: rotate(5deg); }
  18.18% { transform: rotate(-5deg); }
  27.27% { transform: rotate(5deg); }
  36.36% { transform: rotate(-5deg); }
  45.45% { transform: rotate(5deg); }
  54.55% { transform: rotate(-5deg); }
  63.64% { transform: rotate(5deg); }
  72.73% { transform: rotate(-5deg); }
  81.82% { transform: rotate(5deg); }
  90.91% { transform: rotate(-5deg); }
  100% { transform: rotate(0deg); }
}

@keyframes lmi-alarm-clock-bell-shake {
  0% { transform: translate(0px, 0); }
  9.09% { transform: translate(1px, 0); }
  18.18% { transform: translate(-1px, 0); }
  27.27% { transform: translate(1px, 0); }
  36.36% { transform: translate(-1px, 0); }
  45.45% { transform: translate(1px, 0); }
  54.55% { transform: translate(-1px, 0); }
  63.64% { transform: translate(1px, 0); }
  72.73% { transform: translate(-1px, 0); }
  81.82% { transform: translate(1px, 0); }
  90.91% { transform: translate(-1px, 0); }
  100% { transform: translate(0px, 0); }
}

@keyframes lmi-alarm-clock-group {
  0% { transform: translate(0px, 0px); }
  9.09% { transform: translate(2%, -5%); }
  18.18% { transform: translate(-2%, -5%); }
  27.27% { transform: translate(2%, -5%); }
  36.36% { transform: translate(-2%, -5%); }
  45.45% { transform: translate(2%, -5%); }
  54.55% { transform: translate(-2%, -5%); }
  63.64% { transform: translate(2%, -5%); }
  72.73% { transform: translate(-2%, -5%); }
  81.82% { transform: translate(2%, -5%); }
  90.91% { transform: translate(-2%, 0px); }
  100% { transform: translate(0px, 0px); }
}

:is(
  .lmi-alarm-clock[data-animated]:hover,
  [data-icon-motion]:hover .lmi-alarm-clock[data-animated],
  [data-icon-motion="on"] .lmi-alarm-clock[data-animated]
) .lmi-alarm-clock-hand {
  animation-name: lmi-alarm-clock-hand-shake;
  animation-duration: 0.78s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}

:is(
  .lmi-alarm-clock[data-animated]:hover,
  [data-icon-motion]:hover .lmi-alarm-clock[data-animated],
  [data-icon-motion="on"] .lmi-alarm-clock[data-animated]
) .lmi-alarm-clock-bell {
  animation-name: lmi-alarm-clock-bell-shake;
  animation-duration: 0.78s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}

:is(
  .lmi-alarm-clock[data-animated]:hover,
  [data-icon-motion]:hover .lmi-alarm-clock[data-animated],
  [data-icon-motion="on"] .lmi-alarm-clock[data-animated]
) .lmi-alarm-clock-g {
  animation-name: lmi-alarm-clock-group;
  animation-duration: 0.78s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
</style>
