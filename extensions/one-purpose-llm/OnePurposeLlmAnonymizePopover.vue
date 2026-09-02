<script setup lang="ts">
/**
 * The popover that appears over a selection in the input.
 *
 * Anchored to where the pointer was released rather than to the selection
 * itself: a textarea gives no geometry for its selected range, and the mirror
 * div it would take to compute one is a lot of machinery for a two-button menu
 * that appears next to the cursor either way.
 */
import { onMounted, onUnmounted, watch } from "vue";
import {
  setClickThroughPaused,
  syncInteractiveRegions,
} from "../../core/app/system/clickThrough";

const props = defineProps<{
  /** Viewport coordinates to anchor to. */
  x: number;
  y: number;
  /** What was selected, for the label. */
  selection: string;
  /** How many times it appears in the text. */
  occurrences: number;
}>();

const emit = defineEmits<{
  anonymize: [all: boolean];
  dismiss: [];
}>();

/** Keep the popover on screen. Its size is fixed enough to hardcode. */
function style() {
  const width = 188;
  const height = 76;
  let left = props.x - width / 2;
  if (left < 8) left = 8;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
  // Above the pointer, flipping below when there is no room.
  const above = props.y - height - 10;
  const top = above < 8 ? props.y + 16 : above;
  return {
    position: "fixed" as const,
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    zIndex: "10001",
  };
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("dismiss");
}

// The popover lives on document.body, outside the card's interactive region.
watch(
  () => [props.x, props.y],
  () => void syncInteractiveRegions(),
);

onMounted(() => {
  setClickThroughPaused(true);
  document.addEventListener("keydown", onKeydown);
  void syncInteractiveRegions();
});

onUnmounted(() => {
  setClickThroughPaused(false);
  document.removeEventListener("keydown", onKeydown);
  void syncInteractiveRegions();
});
</script>

<template>
  <Teleport to="body">
    <div
      class="opl-anon"
      role="menu"
      aria-label="Anonymize selection"
      data-interactive
      :style="style()"
      @pointerdown.stop
      @mousedown.prevent
    >
      <p class="opl-anon-term" :title="selection">{{ selection }}</p>
      <div class="opl-anon-actions">
        <button type="button" role="menuitem" class="opl-anon-btn" @click="emit('anonymize', false)">
          Anonymize
        </button>
        <button
          type="button"
          role="menuitem"
          class="opl-anon-btn"
          :disabled="occurrences < 2"
          v-tip="
            occurrences < 2
              ? 'Appears once in this text'
              : `Replaces all ${occurrences} occurrences`
          "
          @click="emit('anonymize', true)"
        >
          All<span v-if="occurrences > 1" class="opl-anon-count">{{ occurrences }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.opl-anon {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  box-sizing: border-box;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 10px;
  background: rgba(var(--surface-bg-rgb), 0.97);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  backdrop-filter: var(--surface-backdrop-filter, blur(14px));
  color: var(--text);
}

.opl-anon-term {
  margin: 0;
  padding: 0 3px;
  font-size: 10px;
  line-height: 1.3;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.opl-anon-actions {
  display: flex;
  gap: 4px;
}

.opl-anon-btn {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 8px;
  border: none;
  border-radius: 7px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.88);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.opl-anon-btn:not(:first-child) {
  flex: 0 0 auto;
}

.opl-anon-btn:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.16);
  color: rgba(var(--fg-rgb), 0.98);
}

.opl-anon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.opl-anon-count {
  padding: 1px 4px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.14);
  font-size: 10px;
  font-weight: 600;
}
</style>
