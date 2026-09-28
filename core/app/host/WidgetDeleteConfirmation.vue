<script setup lang="ts">
import { inject, nextTick, onMounted, onUnmounted, ref } from "vue";
import { scheduleRegionSync } from "../system/clickThrough";
import { WIDGET_REMOVAL_KEY, type WidgetRemovalRequest } from "./widgetRemoval";

const props = defineProps<{ request: WidgetRemovalRequest }>();
const removal = inject(WIDGET_REMOVAL_KEY);
const root = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
const request = props.request;
const previousFocus = document.activeElement;

function answer(confirmed: boolean) {
  removal?.answer(request, confirmed);
}

/** Only an outside press cancels; a button press may focus the card in WebKit. */
function onOutsidePointer(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) answer(false);
}

/** Escape cancels just this question, without closing the cockpit. */
function onEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  answer(false);
}

onMounted(async () => {
  document.addEventListener("pointerdown", onOutsidePointer, true);
  document.addEventListener("keydown", onEscape, true);
  await nextTick();
  cancelButton.value?.focus({ preventScroll: true });
  scheduleRegionSync();
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onOutsidePointer, true);
  document.removeEventListener("keydown", onEscape, true);
  answer(false);
  if (
    previousFocus instanceof HTMLElement && previousFocus.isConnected &&
    document.activeElement === document.body
  ) {
    previousFocus.focus({ preventScroll: true });
  }
  scheduleRegionSync();
});
</script>

<template>
  <div
    ref="root"
    class="delete-confirmation"
    role="group"
    aria-label="Confirm widget deletion"
    aria-description="Deletes the widget and its content from every desk. Undo cannot restore its content."
    data-interactive
    @pointerdown.stop
    @click.stop
    @keydown.stop
    @contextmenu.stop.prevent
  >
    <span class="delete-label">Delete?</span>
    <button
      ref="cancelButton"
      type="button"
      class="delete-button"
      aria-label="Cancel delete"
      v-tip="'Cancel'"
      @click="answer(false)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
    </button>
    <button
      type="button"
      class="delete-button delete-button--confirm"
      aria-label="Confirm delete widget and its content"
      v-tip="'Delete widget and its content from every desk\nUndo cannot restore its content'"
      @click="answer(true)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>
    </button>
  </div>
</template>

<style scoped>
.delete-confirmation {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

.delete-label {
  padding: 0 7px;
  color: rgba(var(--fg-rgb), 0.85);
  font-size: 12px;
  font-weight: 500;
}

.delete-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.65);
  cursor: pointer;
}

.delete-button:hover {
  background: rgba(var(--fg-rgb), 0.1);
  color: rgb(var(--fg-rgb));
}

.delete-button:focus-visible {
  outline: 1px solid rgba(var(--fg-rgb), 0.5);
  outline-offset: -2px;
}

.delete-button--confirm {
  color: #e07a5f;
  background: rgba(224, 122, 95, 0.12);
}

.delete-button--confirm:hover {
  color: #f09b83;
  background: rgba(224, 122, 95, 0.22);
}

svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
