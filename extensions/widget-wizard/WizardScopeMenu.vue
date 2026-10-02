<script setup lang="ts" generic="T extends string">
/**
 * How much widget to build, as a one-level menu.
 *
 * It was a segmented control, which showed three words and hid the reason to
 * pick one in a tooltip. A menu shows the explanation under each name, and
 * looks like the model menu beside it on the same bar — same class names, so
 * the composer's `:deep(.picker-button)` styling applies to both triggers.
 */
import { computed, nextTick, ref, watch } from "vue";
import WizardChevron from "./WizardChevron.vue";

const props = defineProps<{
  options: readonly { id: T; label: string; hint: string }[];
  modelValue: T;
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [id: T] }>();

const open = ref(false);
const activeIndex = ref(0);
const rootEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

const selected = computed(() => props.options.find((option) => option.id === props.modelValue));

watch(open, async (isOpen) => {
  if (isOpen) window.addEventListener("pointerdown", onWindowPointerDown, true);
  else window.removeEventListener("pointerdown", onWindowPointerDown, true);
  if (!isOpen) return;
  activeIndex.value = Math.max(0, props.options.findIndex((option) => option.id === props.modelValue));
  await nextTick();
  listEl.value?.focus();
});

function choose(id: T) {
  emit("update:modelValue", id);
  open.value = false;
}

function move(delta: number) {
  const count = props.options.length;
  activeIndex.value = (activeIndex.value + delta + count) % count;
}

function onWindowPointerDown(event: PointerEvent) {
  if (!rootEl.value?.contains(event.target as Node)) open.value = false;
}
</script>

<template>
  <div ref="rootEl" class="picker">
    <button
      type="button"
      class="picker-button"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="menu"
      aria-label="How much widget to build"
      @click="open = !open"
    >
      <span class="picker-label">{{ selected?.label }}</span>
      <WizardChevron :direction="open ? 'up' : 'down'" />
    </button>

    <div
      v-if="open"
      ref="listEl"
      class="picker-list"
      role="menu"
      tabindex="-1"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="choose(options[activeIndex].id)"
      @keydown.esc.prevent="open = false"
    >
      <button
        v-for="(option, index) in options"
        :key="option.id"
        type="button"
        role="menuitemradio"
        class="picker-item"
        :class="{
          'picker-item--active': index === activeIndex,
          'picker-item--current': option.id === modelValue,
        }"
        :aria-checked="option.id === modelValue"
        @mouseenter="activeIndex = index"
        @click="choose(option.id)"
      >
        <span class="picker-item-head">
          <span class="picker-item-name">{{ option.label }}</span>
          <span v-if="option.id === modelValue" class="picker-check" aria-hidden="true">✓</span>
        </span>
        <span class="picker-item-note">{{ option.hint }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Mirrors WizardModelMenu's panel; only the anchor differs — this one sits left. */
.picker {
  position: relative;
}

.picker-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-list {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 20;
  min-width: 250px;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: var(--card-bg, rgba(28, 28, 30, 0.98));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  outline: none;
}

.picker-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  text-align: left;
  font: inherit;
  padding: 6px 8px;
  border: none;
  border-radius: 7px;
  background: none;
  color: inherit;
  cursor: pointer;
}

.picker-item--active {
  background: rgba(var(--fg-rgb), 0.1);
}

.picker-item--current .picker-item-name {
  font-weight: 600;
}

.picker-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.picker-item-name {
  font-size: 12px;
  flex: 1;
}

.picker-check {
  opacity: 0.7;
  font-size: 11px;
}

.picker-item-note {
  font-size: 10px;
  opacity: 0.6;
}
</style>
