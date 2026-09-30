<script lang="ts">
// SPDX-License-Identifier: MIT

/** One row in a {@link KavibaySelect}. `note` renders as a dimmed second line. */
export interface KavibaySelectOption {
  value: string | number;
  label: string;
  note?: string;
}
</script>

<script setup lang="ts">
/**
 * The dropdown every widget uses instead of `<select>`.
 *
 * A native `<select>` popup is drawn by Windows, not by us: light background,
 * square corners, its own font and row height. On a dark glass card it reads as
 * a hole. This keeps what the native control gave us — arrows, Enter, Escape,
 * type-to-jump, outside click — and drops the OS chrome.
 *
 * See docs/DESIGN.md ("Dropdowns") for the rule and the package-side markup.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    options: ReadonlyArray<KavibaySelectOption>;
    modelValue: string | number | null | undefined;
    /** Trigger text while nothing is selected. */
    placeholder?: string;
    disabled?: boolean;
    /** `sm` inside a widget, `md` in a settings popover. */
    size?: "sm" | "md";
    /** Which edge the panel lines up with when it is wider than the trigger. */
    align?: "left" | "right";
    ariaLabel?: string;
  }>(),
  {
    placeholder: "Select…",
    disabled: false,
    size: "md",
    align: "left",
    ariaLabel: undefined,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string | number];
  /** The option under the pointer or keyboard highlight while open; `null` once closed. */
  highlight: [value: string | number | null];
}>();

const open = ref(false);
const dropUp = ref(false);
const activeIndex = ref(0);
const rootEl = ref<HTMLElement | null>(null);
const triggerEl = ref<HTMLButtonElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

const selected = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
);
const label = computed(() => selected.value?.label ?? props.placeholder);

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
}

/** Commit a value and close. */
function choose(value: string | number) {
  emit("update:modelValue", value);
  close();
}

function close() {
  open.value = false;
  triggerEl.value?.focus();
}

/** Commit whatever the highlight is on; a no-op for an empty list. */
function chooseActive() {
  const option = props.options[activeIndex.value];
  if (option) choose(option.value);
  else close();
}

/** Move the highlight, wrapping at both ends, and keep it in view. */
function move(delta: number) {
  const count = props.options.length;
  if (count === 0) return;
  activeIndex.value = (activeIndex.value + delta + count) % count;
  scrollActiveIntoView();
}

function scrollActiveIntoView() {
  void nextTick(() => {
    const rows = listEl.value?.children;
    (rows?.[activeIndex.value] as HTMLElement | undefined)?.scrollIntoView({
      block: "nearest",
    });
  });
}

// Type-to-jump, the one affordance of a native select worth keeping by hand.
let typed = "";
let typedTimer: number | undefined;

function onTypeahead(event: KeyboardEvent) {
  if (event.key.length !== 1 || event.key === " ") return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  typed += event.key.toLowerCase();
  window.clearTimeout(typedTimer);
  typedTimer = window.setTimeout(() => {
    typed = "";
  }, 600);
  const hit = props.options.findIndex((option) =>
    option.label.toLowerCase().startsWith(typed),
  );
  if (hit >= 0) {
    activeIndex.value = hit;
    scrollActiveIntoView();
  }
}

/** Open upward when the panel would not fit below — widgets sit anywhere on screen. */
function pickDirection() {
  const rect = triggerEl.value?.getBoundingClientRect();
  if (!rect) return;
  const below = window.innerHeight - rect.bottom;
  dropUp.value = below < 200 && rect.top > below;
}

/** Close when the click lands outside — including on another widget. */
function onWindowPointerDown(event: PointerEvent) {
  if (!rootEl.value?.contains(event.target as Node)) open.value = false;
}

watch(open, async (isOpen) => {
  if (isOpen) {
    pickDirection();
    activeIndex.value = Math.max(
      0,
      props.options.findIndex((option) => option.value === props.modelValue),
    );
    window.addEventListener("pointerdown", onWindowPointerDown, true);
    await nextTick();
    listEl.value?.focus();
    scrollActiveIntoView();
  } else {
    typed = "";
    window.removeEventListener("pointerdown", onWindowPointerDown, true);
  }
});

watch([open, activeIndex], ([isOpen, index]) => {
  emit("highlight", isOpen ? (props.options[index]?.value ?? null) : null);
});

onBeforeUnmount(() => {
  window.clearTimeout(typedTimer);
  window.removeEventListener("pointerdown", onWindowPointerDown, true);
});
</script>

<template>
  <div
    ref="rootEl"
    class="ssel"
    :class="[`ssel--${size}`, { 'ssel--open': open }]"
    @pointerdown.stop
  >
    <button
      ref="triggerEl"
      type="button"
      class="ssel-trigger"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown.down.prevent="open = true"
    >
      <span class="ssel-value" :class="{ 'ssel-value--empty': !selected }">
        <slot name="value" :option="selected">{{ label }}</slot>
      </span>
      <svg class="ssel-caret" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
    </button>

    <div
      v-if="open"
      ref="listEl"
      class="ssel-panel"
      :class="[`ssel-panel--${align}`, { 'ssel-panel--up': dropUp }]"
      role="listbox"
      tabindex="-1"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.home.prevent="((activeIndex = 0), scrollActiveIntoView())"
      @keydown.end.prevent="((activeIndex = options.length - 1), scrollActiveIntoView())"
      @keydown.enter.prevent="chooseActive()"
      @keydown.space.prevent="chooseActive()"
      @keydown.tab="close()"
      @keydown.esc.prevent="close()"
      @keydown="onTypeahead"
    >
      <p v-if="options.length === 0" class="ssel-empty">Nothing to choose</p>
      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        role="option"
        class="ssel-item"
        :class="{ 'ssel-item--active': index === activeIndex }"
        :aria-selected="option.value === modelValue"
        @mouseenter="activeIndex = index"
        @click="choose(option.value)"
      >
        <span class="ssel-check" aria-hidden="true">{{
          option.value === modelValue ? "✓" : ""
        }}</span>
        <!-- A rich row, e.g. a font sample or a shadow swatch; defaults to label + note. -->
        <slot name="option" :option="option">
          <span class="ssel-item-text">
            <span class="ssel-item-label">{{ option.label }}</span>
            <span v-if="option.note" class="ssel-item-note">{{ option.note }}</span>
          </span>
        </slot>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ssel {
  position: relative;
}

.ssel-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  text-align: left;
  letter-spacing: normal;
  text-transform: none;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.92);
  cursor: pointer;
}

.ssel-trigger:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.32);
  border-color: rgba(var(--fg-rgb), 0.2);
}

.ssel-trigger:disabled {
  opacity: 0.4;
  cursor: default;
}

.ssel--md .ssel-trigger {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 400;
}

.ssel--sm .ssel-trigger {
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 400;
}

.ssel-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ssel-value--empty {
  color: rgba(var(--fg-rgb), 0.45);
}

.ssel-caret {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  opacity: 0.5;
}

.ssel--open .ssel-caret {
  transform: rotate(180deg);
}

.ssel-panel {
  position: absolute;
  top: calc(100% + 4px);
  z-index: 20;
  min-width: 100%;
  max-width: 260px;
  max-height: 220px;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 4px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 10px;
  background: rgba(var(--surface-bg-rgb), 0.98);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  outline: none;
}

.ssel-panel--left {
  left: 0;
}

.ssel-panel--right {
  right: 0;
}

.ssel-panel--up {
  top: auto;
  bottom: calc(100% + 4px);
}

.ssel-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  box-sizing: border-box;
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
  text-align: left;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.9);
  cursor: pointer;
}

.ssel--sm .ssel-item {
  font-size: 12px;
}

.ssel-item--active {
  background: rgba(var(--fg-rgb), 0.1);
}

.ssel-check {
  flex: 0 0 auto;
  width: 11px;
  line-height: 1.35;
  opacity: 0.9;
}

.ssel-item-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ssel-item-label {
  line-height: 1.35;
}

.ssel-item-note {
  font-size: 10px;
  opacity: 0.6;
}

.ssel-empty {
  margin: 0;
  padding: 8px;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
}
</style>
