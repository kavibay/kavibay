<script setup lang="ts">
import { computed } from "vue";
import type { ClockModel } from "./clock";

const props = defineProps<{ model: ClockModel }>();
const time = computed(() => props.model.formatted.value.time);
/** The seconds are quieter than hours and minutes (see `secondsRangeOf`). */
const timeParts = computed(() => {
  const range = props.model.formatted.value.secondsRange;
  if (!range) return { head: time.value, seconds: "", tail: "" };
  return {
    head: time.value.slice(0, range[0]),
    seconds: time.value.slice(range[0], range[1]),
    tail: time.value.slice(range[1]),
  };
});
const date = computed(() => props.model.formatted.value.date);
</script>

<template>
  <div class="clock">
    <!-- One line: whitespace around the parts would render as a space. -->
    <!-- prettier-ignore -->
    <p class="clock-time" :aria-label="time">{{ timeParts.head }}<span class="clock-seconds">{{ timeParts.seconds }}</span>{{ timeParts.tail }}</p>
    <p v-if="date" class="clock-date">{{ date }}</p>
  </div>
</template>

<style scoped>
.clock {
  display: flex;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.clock-time {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.clock-seconds {
  color: rgba(var(--fg-rgb), 0.4);
  font-weight: 500;
}

.clock-date {
  margin: 4px 0 0;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.6);
}
</style>

