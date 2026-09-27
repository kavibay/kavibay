<script setup lang="ts">
import PaletteSearchActionIcon from "./PaletteSearchActionIcon.vue";
import { searchActionTitle, type SearchActionId } from "./searchActions";
import type { PaletteAiModel } from "./usePaletteAnswer";
import { ref } from "vue";

const props = defineProps<{ model: PaletteAiModel | null; actions: readonly SearchActionId[] }>();
const emit = defineEmits<{ select: [id: SearchActionId]; back: [] }>();
const root = ref<HTMLElement | null>(null);

function label(id: SearchActionId) {
  return searchActionTitle(id, props.model?.label);
}
function tip(id: SearchActionId, index: number) {
  return `${label(id)} · ${Array(index + 1).fill('Tab').join(', ')}, Enter`;
}

/** Explicit focus also works when macOS excludes buttons from native Tab order. */
function focusFirst() {
  root.value?.querySelector("button")?.focus();
}
function onTab(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const buttons = [...(root.value?.querySelectorAll("button") ?? [])];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.shiftKey && index === 0) emit("back");
  else buttons[(index + (event.shiftKey ? -1 : 1)) % buttons.length]?.focus();
}
defineExpose({ focusFirst });
</script>

<template>
  <div ref="root" class="palette-search-actions" role="group" aria-label="Search elsewhere" @keydown.tab="onTab" @keydown.esc.stop.prevent="$emit('back')">
    <button
      v-for="(id, index) in actions"
      :key="id"
      type="button"
      class="palette-search-action"
      tabindex="-1"
      :aria-label="label(id)"
      v-tip:below="tip(id, index)"
      @click="$emit('select', id)"
    >
      <PaletteSearchActionIcon :action="id" :ai-provider="model?.credentialType" />
    </button>
  </div>
</template>

<style scoped>
.palette-search-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  flex: 0 1 auto;
  max-width: 100%;
  margin-left: auto;
  margin-block: 8px;
  gap: 8px;
}

.palette-search-action {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.7);
  cursor: pointer;
  opacity: 0.7;
  transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
}

/* Tab moves focus through JS; WebKit may not also match :focus-visible. */
.palette-search-action:hover,
.palette-search-action:focus {
  opacity: 1;
  color: rgba(var(--fg-rgb), 0.95);
  background: rgba(var(--fg-rgb), 0.09);
  transform: scale(1.05);
}

.palette-search-action:focus {
  outline: 1px solid rgba(var(--fg-rgb), 0.35);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .palette-search-action { transition: none; }
}
</style>
