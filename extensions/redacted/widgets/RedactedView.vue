<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { RedactedModel } from "./redacted";

const props = defineProps<{ model: RedactedModel }>();
const rootEl = ref<HTMLElement | null>(null);

function cardForRoot(): HTMLElement | null {
  return rootEl.value?.closest<HTMLElement>(".widget-card") ?? null;
}

/**
 * The privacy guarantee includes the card's rounded corners, not only the
 * child body. This is still generic surface styling: no host branch knows
 * what Redacted is, and the contract view owns its presentation.
 */
function applyCardSurface() {
  const card = cardForRoot();
  if (!card) return;
  const radius = `${props.model.config.borderRadius}px`;
  card.style.background = props.model.config.color;
  card.style.backdropFilter = "none";
  card.style.setProperty("-webkit-backdrop-filter", "none");
  card.style.borderColor =
    getComputedStyle(document.documentElement).getPropertyValue("--border").trim() ||
    "rgba(255, 255, 255, 0.08)";
  card.style.borderRadius = radius;
  card.style.setProperty("--surface-radius", radius);
}

function clearCardSurface() {
  const card = cardForRoot();
  if (!card) return;
  card.style.background = "";
  card.style.backdropFilter = "";
  card.style.removeProperty("-webkit-backdrop-filter");
  card.style.borderColor = "";
  card.style.borderRadius = "";
  card.style.removeProperty("--surface-radius");
}

onMounted(async () => {
  await nextTick();
  applyCardSurface();
});

onBeforeUnmount(clearCardSurface);
</script>

<template>
  <div
    ref="rootEl"
    class="redacted"
    :style="{
      backgroundColor: model.config.color,
      borderRadius: `${model.config.borderRadius}px`,
    }"
    role="img"
    aria-label="Opaque privacy cover"
  />
</template>

<style scoped>
.redacted {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  cursor: grab;
  touch-action: none;
}
</style>
