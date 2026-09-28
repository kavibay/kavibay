<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { SettingsIcon } from "@sdk/icons";
import PaletteWidgetIcon from "./PaletteWidgetIcon.vue";
import type { PaletteTypeCatalogEntry } from "./paletteResults";

defineProps<{ widgets: readonly PaletteTypeCatalogEntry[]; activeId: string | null }>();
const emit = defineEmits<{ select: [id: string]; enter: []; back: []; settings: [] }>();
const root = ref<HTMLElement | null>(null);
const focusedId = ref<string | null>(null);

function onFocus(id: string) {
  focusedId.value = id;
  emit("select", id);
}

/**
 * Resting on a shortcut for a while reveals a way to change the shortcuts.
 * Not shown up front: the row is for opening widgets, and a gear beside them
 * all the time would be one more icon to read past every time.
 */
const SETTINGS_DWELL_MS = 3000;
const showSettings = ref(false);
let dwellTimer: ReturnType<typeof setTimeout> | undefined;

function startDwell() {
  if (showSettings.value) return;
  clearTimeout(dwellTimer);
  dwellTimer = setTimeout(() => (showSettings.value = true), SETTINGS_DWELL_MS);
}

function stopDwell() {
  clearTimeout(dwellTimer);
}

function leaveRow() {
  stopDwell();
  showSettings.value = false;
}

onBeforeUnmount(stopDwell);

function focusFirst() {
  root.value?.querySelector("button")?.focus();
}
function onNavigationKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const isTab = event.key === "Tab";
  if (!isTab && (event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight"))) return;
  const buttons = [...(root.value?.querySelectorAll("button") ?? [])];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  event.stopPropagation();
  const backwards = event.key === "ArrowLeft" || (isTab && event.shiftKey);
  if (backwards && index === 0) emit("back");
  else {
    const next = index + (backwards ? -1 : 1);
    // Tab cycles through shortcuts; arrows follow their visual positions.
    buttons[isTab ? next % buttons.length : next]?.focus();
  }
}
defineExpose({ focusFirst });
</script>

<template>
  <div ref="root" class="widget-shortcuts" role="group" aria-label="Widget shortcuts" @keydown="onNavigationKeydown" @keydown.esc.stop.prevent="$emit('back')" @pointerleave="leaveRow">
    <button
      v-for="widget in widgets"
      :key="widget.id"
      type="button"
      class="widget-shortcut"
      tabindex="-1"
      :aria-label="`Show ${widget.title} in palette`"
      :aria-pressed="activeId === widget.id"
      :data-icon-motion="focusedId === widget.id ? 'on' : ''"
      v-tip:below="`${widget.title} · ←/→ or Tab to preview, Enter to use`"
      @focus="onFocus(widget.id)"
      @blur="focusedId = null"
      @click="$emit('select', widget.id)"
      @pointerenter="startDwell"
      @pointerleave="stopDwell"
      @keydown.enter.stop.prevent="$emit('enter')"
      @keydown.down.stop.prevent="$emit('enter')"
    >
      <PaletteWidgetIcon :widget="widget" animated />
    </button>
    <Transition name="shortcut-settings">
      <button
        v-if="showSettings"
        type="button"
        class="widget-shortcut widget-shortcut--settings"
        tabindex="-1"
        aria-label="Widget shortcut settings"
        v-tip:below="'Shortcut settings'"
        @click="$emit('settings')"
      >
        <SettingsIcon :size="16" />
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.widget-shortcuts { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; flex: 0 1 auto; max-width: 100%; margin-left: auto; margin-block: 8px; gap: 8px; }
.widget-shortcut { display: grid; place-items: center; width: 36px; height: 36px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: rgba(var(--fg-rgb), 0.7); cursor: pointer; opacity: 0.7; transition: transform 120ms ease, opacity 120ms ease, background 120ms ease; }
.widget-shortcut[aria-pressed="true"] { opacity: 1; background: rgba(var(--fg-rgb), 0.06); }
.widget-shortcut:hover, .widget-shortcut:focus { opacity: 1; color: rgba(var(--fg-rgb), 0.95); background: rgba(var(--fg-rgb), 0.09); transform: scale(1.05); }
.widget-shortcut:focus { outline: 1px solid rgba(var(--fg-rgb), 0.35); outline-offset: 2px; }
.widget-shortcut--settings { opacity: 0.55; }
.shortcut-settings-enter-active, .shortcut-settings-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.shortcut-settings-enter-from, .shortcut-settings-leave-to { opacity: 0; transform: translateX(-4px); }
@media (prefers-reduced-motion: reduce) { .widget-shortcut, .shortcut-settings-enter-active, .shortcut-settings-leave-active { transition: none; } }
</style>
