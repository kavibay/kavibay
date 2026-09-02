<script setup lang="ts">
import { computed, type Ref } from "vue";

/**
 * The view half of the Tado temperature widget.
 *
 * `state` is typed as possibly undefined because the model is built before the
 * first subscription callback lands — but this component is never mounted in
 * that window. The runtime holds the skeleton until the query reports success,
 * so by the time anything renders here the data exists. The optional type is
 * honesty about the model, not a state this view has to design for.
 */
interface RoomState { roomId: string; current: number; target: number; heating: boolean }

const props = defineProps<{
  model: { state: Ref<RoomState | undefined>; room: string };
}>();

const state = computed(() => props.model.state.value);
const format = (n: number) => `${n.toFixed(1).replace(/\.0$/, "")}°`;
</script>

<template>
  <div class="tado">
    <p class="room">{{ model.room }}</p>
    <p class="current">{{ state ? format(state.current) : "—" }}</p>
    <p class="target">
      Target {{ state ? format(state.target) : "—" }}
      <span v-if="state?.heating" class="heating">· heating</span>
    </p>
  </div>
</template>

<style scoped>
.tado {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  text-align: center;
}

.room {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--fg-rgb), 0.5);
}

.current {
  margin: 2px 0 0;
  font-size: 30px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.target {
  margin: 2px 0 0;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.6);
}

.heating {
  color: rgba(var(--fg-rgb), 0.8);
}
</style>
