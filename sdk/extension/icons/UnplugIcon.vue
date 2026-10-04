<script setup lang="ts">
// SPDX-License-Identifier: MIT
/** Lucide `unplug`, plugged in and yanked out with a spark on hover. */
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
  <IconBase class="lmi-unplug" :size="size" :stroke-width="strokeWidth" :animated="animated">
    <g class="lmi-unplug-socket">
      <path d="m19 5 3-3" />
      <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
    </g>
    <g class="lmi-unplug-plug">
      <path d="m2 22 3-3" />
      <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
      <path d="M7.5 13.5 10 11" />
      <path d="M10.5 16.5 13 14" />
    </g>
    <!-- Not in Lucide: the spark, a zigzag centred in the gap between prong
         tips and socket face, running across the plug's axis. Invisible at
         rest, so the static icon is plain `unplug`. -->
    <path class="lmi-unplug-spark" d="M11.4 8.9 13.75 10l-1 1.5 2.35 1.1" />
  </IconBase>
</template>

<style>
[data-icon-tile]:has(> .lmi-unplug) {
  --icon-tile-bg: linear-gradient(150deg, rgba(220, 38, 38, 0.28), rgba(127, 29, 29, 0.34));
  --icon-tile-fg: #fecaca;
  --lmi-unplug-spark: #fbbf24;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-unplug) {
  --icon-tile-bg: rgba(220, 38, 38, 0.13);
  --icon-tile-fg: #991b1b;
  --lmi-unplug-spark: #d97706;
}

/* The yank overshoots past the 24 grid for a frame; clipping it there would
   read as a glitch, not a pull. */
.lmi-unplug {
  overflow: visible;
}

.lmi-unplug-plug,
.lmi-unplug-socket {
  transform: translate(0, 0);
}

.lmi-unplug-spark {
  stroke: var(--lmi-unplug-spark, currentColor);
  transform-box: view-box;
  transform-origin: 13.25px 10.75px;
  transform: scale(0.4);
  opacity: 0;
}

/*
 * Both halves travel along the plug's diagonal: in until the prongs sit in the
 * socket, a beat held, then out past rest and a small settle. The socket is the
 * same curve mirrored, so the gap stays centred on the spark.
 */
@keyframes lmi-unplug-plug {
  0% { transform: translate(0, 0); }
  22%,
  42% { transform: translate(1.6px, -1.6px); }
  62% { transform: translate(-1.3px, 1.3px); }
  80% { transform: translate(0.3px, -0.3px); }
  100% { transform: translate(0, 0); }
}

@keyframes lmi-unplug-socket {
  0% { transform: translate(0, 0); }
  22%,
  42% { transform: translate(-1.6px, 1.6px); }
  62% { transform: translate(1.3px, -1.3px); }
  80% { transform: translate(-0.3px, 0.3px); }
  100% { transform: translate(0, 0); }
}

/* Fires the moment the contact breaks and widens with the gap, so the rays
   never sit on a half; gone before the halves settle. */
@keyframes lmi-unplug-spark {
  0%,
  44% { transform: scale(0.4); opacity: 0; }
  52% { transform: scale(0.9); opacity: 1; }
  60% { transform: scale(1.2); opacity: 1; }
  72%,
  100% { transform: scale(1.45); opacity: 0; }
}

:is(
  .lmi-unplug[data-animated]:hover,
  [data-icon-motion]:hover .lmi-unplug[data-animated],
  [data-icon-motion="on"] .lmi-unplug[data-animated]
) .lmi-unplug-plug {
  animation: lmi-unplug-plug 0.7s cubic-bezier(0.3, 0, 0.2, 1) both;
}

:is(
  .lmi-unplug[data-animated]:hover,
  [data-icon-motion]:hover .lmi-unplug[data-animated],
  [data-icon-motion="on"] .lmi-unplug[data-animated]
) .lmi-unplug-socket {
  animation: lmi-unplug-socket 0.7s cubic-bezier(0.3, 0, 0.2, 1) both;
}

:is(
  .lmi-unplug[data-animated]:hover,
  [data-icon-motion]:hover .lmi-unplug[data-animated],
  [data-icon-motion="on"] .lmi-unplug[data-animated]
) .lmi-unplug-spark {
  animation: lmi-unplug-spark 0.7s ease-out both;
}
</style>
