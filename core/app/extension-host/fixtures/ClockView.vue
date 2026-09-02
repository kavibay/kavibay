<script setup lang="ts">
import { computed, type Ref } from "vue";

/**
 * The view half of the Clock widget.
 *
 * The model carries a `Ref<Date>`, and a ref nested inside a prop object is not
 * auto-unwrapped in a template — so it is unwrapped here, explicitly and once,
 * rather than writing `model.now.value` through the markup.
 */
const props = defineProps<{
  model: { now: Ref<Date>; showSeconds: boolean };
}>();

const time = computed(() =>
  props.model.now.value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(props.model.showSeconds ? { second: "2-digit" } : {}),
  }),
);

const date = computed(() =>
  props.model.now.value.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }),
);
</script>

<template>
  <div class="clock">
    <p class="time">{{ time }}</p>
    <p class="date">{{ date }}</p>
  </div>
</template>

<style scoped>
.clock {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  text-align: center;
}

.time {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.date {
  margin: 4px 0 0;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.6);
}
</style>
