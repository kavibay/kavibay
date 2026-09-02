<script setup lang="ts">
/**
 * Subtle pin marker: outline circle when off, filled circle when on.
 */
defineProps<{
  /** When true, render the filled circle. */
  active?: boolean;
}>();
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="11"
    height="11"
    viewBox="0 0 16 16"
    aria-hidden="true"
  >
    <circle
      v-if="active"
      cx="8"
      cy="8"
      r="5"
      fill="currentColor"
    />
    <circle
      v-else
      cx="8"
      cy="8"
      r="5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
    />
  </svg>
</template>
