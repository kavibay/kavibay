<script setup lang="ts">
import { computed } from "vue";
import type { ClockModel } from "./clock";

const props = defineProps<{ model: ClockModel }>();
const time = computed(() => props.model.formatted.value.time);
const date = computed(() => props.model.formatted.value.date);
</script>

<template>
  <div class="clock">
    <p class="clock-time">{{ time }}</p>
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

.clock-date {
  margin: 4px 0 0;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.6);
}
</style>

