<script setup lang="ts">
withDefaults(
  defineProps<{
    direction?: "down" | "up";
  }>(),
  { direction: "down" },
);
</script>

<template>
  <svg
    class="wizard-chevron"
    :class="{ 'wizard-chevron--up': direction === 'up' }"
    viewBox="0 0 12 12"
    aria-hidden="true"
  >
    <path d="M2 3.5 6 7.5 10 3.5" />
  </svg>
</template>

<style scoped>
.wizard-chevron {
  display: block;
  flex: 0 0 9px;
  width: 9px;
  height: 9px;
  color: currentColor;
  opacity: 0.5;
}

.wizard-chevron--up {
  transform: rotate(180deg);
}

.wizard-chevron path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
