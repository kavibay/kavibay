<script setup lang="ts">
// SPDX-License-Identifier: MIT
/**
 * Shared shell for every Lucide icon component.
 *
 * Lucide's eight SVG attributes are identical across the whole set, so they
 * live here once — an icon file is then only its shapes plus, if it has one,
 * its motion. That is also what keeps a hand-tweaked stroke width or viewBox
 * from drifting into a single icon and quietly breaking the set's optics.
 *
 * Icons render inline rather than through a URL because animation needs real
 * elements: the host's older `mask: url(icon.svg)` path flattens an SVG into an
 * alpha mask, which has no DOM to address per path.
 */
withDefaults(
  defineProps<{
    /** Rendered box in px. Lucide draws on a 24 grid and scales cleanly. */
    size?: number | string;
    /** Lucide's own default is 2; lower it for large renderings, not small. */
    strokeWidth?: number | string;
    /**
     * Opt into the icon's motion variant. Icons without one simply ignore it,
     * so a caller never has to know which of the set is animated.
     */
    animated?: boolean;
  }>(),
  { size: 24, strokeWidth: 2, animated: false },
);
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="lmi"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    :data-animated="animated ? '' : null"
  >
    <slot />
  </svg>
</template>

<style>
/*
 * Nobody who asked the system to calm down wants four staggered draw-ons every
 * time the selection moves. Covers every icon in the set at once.
 */
@media (prefers-reduced-motion: reduce) {
  .lmi[data-animated] * {
    animation: none !important;
  }
}
</style>
