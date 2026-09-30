<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Lucide `notebook-pen`: the binding rings draw in down the spine while the pen
 * comes down onto the page.
 *
 * The pen slides rather than drawing itself. Tracing its outline would have
 * been the cheaper move, but a pen that arrives says "write here", and that is
 * the whole reason this icon is on a notes widget.
 */
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
    class="lmi-notebook-pen"
    :size="size"
    :stroke-width="strokeWidth"
    :animated="animated"
  >
    <!-- The book stays put: it carries the silhouette. -->
    <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
    <path class="lmi-notebook-pen-ring" d="M2 6h4" pathLength="1" />
    <path class="lmi-notebook-pen-ring lmi-notebook-pen-r2" d="M2 10h4" pathLength="1" />
    <path class="lmi-notebook-pen-ring lmi-notebook-pen-r3" d="M2 14h4" pathLength="1" />
    <path class="lmi-notebook-pen-ring lmi-notebook-pen-r4" d="M2 18h4" pathLength="1" />
    <path
      class="lmi-notebook-pen-pen"
      d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"
    />
  </IconBase>
</template>

<style>
/* Kraft paper and a blue pen. Tile colours — see ListTodoIcon.vue for how the
   host reads them. */
[data-icon-tile]:has(> .lmi-notebook-pen) {
  --icon-tile-bg: rgba(200, 162, 122, 0.3);
  --icon-tile-fg: #f3e1c7;
  --lmi-notes-pen: #93c5fd;
}

html[data-color-mode="light"] [data-icon-tile]:has(> .lmi-notebook-pen) {
  --icon-tile-bg: rgba(168, 121, 72, 0.2);
  --icon-tile-fg: #6b4423;
  --lmi-notes-pen: #2563eb;
}

.lmi-notebook-pen-pen {
  stroke: var(--lmi-notes-pen, currentColor);
}

/* Resting state is each animation's end state, so the static variant is right
   without the keyframes ever running. */
.lmi-notebook-pen-ring {
  opacity: 1;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}

.lmi-notebook-pen-pen {
  transform: translate(0, 0);
  opacity: 1;
}

/* Inert until a trigger supplies an animation-name. */
.lmi-notebook-pen-r2 {
  animation-delay: 0.06s;
}

.lmi-notebook-pen-r3 {
  animation-delay: 0.12s;
}

.lmi-notebook-pen-r4 {
  animation-delay: 0.18s;
}

.lmi-notebook-pen-pen {
  animation-delay: 0.16s;
}

@keyframes lmi-notebook-pen-ring {
  0% {
    opacity: 0;
    stroke-dasharray: 0 1;
    stroke-dashoffset: 0;
  }
  100% {
    opacity: 1;
    stroke-dasharray: 1 1;
    stroke-dashoffset: 0;
  }
}

/*
 * Retracted along the pen's own axis, which runs lower-left to upper-right, so
 * the approach follows the barrel instead of cutting across it. Distances are
 * user units — a transform on an SVG element works in the local coordinate
 * system, so the travel stays proportional at every size.
 */
@keyframes lmi-notebook-pen-pen {
  0% {
    transform: translate(2.5px, -2.5px);
    opacity: 0;
  }
  55% {
    opacity: 1;
  }
  100% {
    transform: translate(0, 0);
    opacity: 1;
  }
}

/*
 * Same three ways in as every other animated icon — see ClipboardListIcon.vue.
 * No animation-delay in here: this block out-specifies the delay classes above
 * and would flatten the whole stagger onto one start time.
 */
:is(
  .lmi-notebook-pen[data-animated]:hover,
  [data-icon-motion]:hover .lmi-notebook-pen[data-animated],
  [data-icon-motion="on"] .lmi-notebook-pen[data-animated]
)
  .lmi-notebook-pen-ring {
  animation-name: lmi-notebook-pen-ring;
  animation-duration: 0.3s;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}

:is(
  .lmi-notebook-pen[data-animated]:hover,
  [data-icon-motion]:hover .lmi-notebook-pen[data-animated],
  [data-icon-motion="on"] .lmi-notebook-pen[data-animated]
)
  .lmi-notebook-pen-pen {
  animation-name: lmi-notebook-pen-pen;
  animation-duration: 0.42s;
  /* Settles rather than stops — a hand putting a pen down decelerates. */
  animation-timing-function: cubic-bezier(0.22, 0.9, 0.3, 1);
  animation-fill-mode: both;
}
</style>
