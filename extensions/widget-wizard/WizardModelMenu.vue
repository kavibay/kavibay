<script setup lang="ts">
/**
 * Model and effort, in one menu.
 *
 * A native `<select>` is drawn by Windows: system colours, system font, and a
 * popup that ignores the app's theme entirely — on a dark translucent widget it
 * reads as a hole. It also cannot show a second line, and the difference
 * between these models is exactly the kind of thing that needs one.
 *
 * TWO CONTROLS BECAME ONE. Model and effort were separate pickers side by side,
 * which spent the width of the composer row on two dropdowns that are read
 * together and answer one question: what is about to run. A trigger that says
 * `5.6 Luna · High` answers it without being opened at all, and the settings
 * behind it are a level down rather than a second thing to look at.
 *
 * The two levels are one list of sections and one list of options, not a
 * hard-coded pair of branches — adding a third dimension later is data, not
 * another copy of the panel.
 *
 * Keyboard behaviour is kept and extended: arrows move, Enter picks, Right or
 * Enter opens a section, Left or Escape steps back out, Escape at the top
 * closes.
 */
import { computed, nextTick, ref, watch } from "vue";
import { effortLabel, type WizardModelOption } from "./widgetWizardLogic";
import WizardChevron from "./WizardChevron.vue";

const props = defineProps<{
  models: WizardModelOption[];
  modelValue: string;
  /** `""` means the provider's own default. */
  effort: string;
  /** Empty for a model that does not take the parameter; the row then hides. */
  effortLevels: readonly string[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [id: string];
  "update:effort": [level: string];
}>();

interface MenuOption {
  value: string;
  label: string;
  note?: string;
  /** Shown as a warning chip; a model with no key still picks. */
  warn?: string;
}

interface MenuSection {
  key: "model" | "effort";
  label: string;
  selected: string;
  options: MenuOption[];
}

const selectedModel = computed(() =>
  props.models.find((model) => model.id === props.modelValue),
);

const sections = computed<MenuSection[]>(() => {
  const list: MenuSection[] = [
    {
      key: "model",
      label: "Model",
      selected: props.modelValue,
      options: props.models.map((model) => ({
        value: model.id,
        label: model.label,
        note: model.note || undefined,
        warn: model.configured ? undefined : "no key",
      })),
    },
  ];
  // Hidden rather than disabled: some models return an error when the parameter
  // is present at all, so for them there is no choice to grey out — there is no
  // setting.
  if (props.effortLevels.length > 0) {
    list.push({
      key: "effort",
      label: "Effort",
      selected: props.effort,
      options: [
        { value: "", label: effortLabel(""), note: "whatever the model does on its own" },
        ...props.effortLevels.map((level) => ({ value: level, label: effortLabel(level) })),
      ],
    });
  }
  return list;
});

/** What a section shows on its own row, on the right. */
function currentLabel(section: MenuSection): string {
  return section.options.find((option) => option.value === section.selected)?.label ?? "";
}

const open = ref(false);
/** Which section is expanded, or `null` at the top level. */
const openSection = ref<MenuSection["key"] | null>(null);
const activeIndex = ref(0);
const rootEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

const current = computed(() =>
  sections.value.find((section) => section.key === openSection.value),
);
/** Whatever list the arrow keys are moving through right now. */
const rows = computed(() => (current.value ? current.value.options.length : sections.value.length));

const triggerModel = computed(() => selectedModel.value?.label ?? "Choose a model");
const triggerEffort = computed(() =>
  props.effortLevels.length > 0 && props.effort ? effortLabel(props.effort) : "",
);

watch(open, async (isOpen) => {
  if (!isOpen) {
    openSection.value = null;
    return;
  }
  activeIndex.value = 0;
  await nextTick();
  listEl.value?.focus();
});

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
}

async function enter(key: MenuSection["key"]) {
  const section = sections.value.find((entry) => entry.key === key);
  if (!section) return;
  openSection.value = key;
  activeIndex.value = Math.max(
    0,
    section.options.findIndex((option) => option.value === section.selected),
  );
  await nextTick();
  listEl.value?.focus();
}

async function back() {
  const key = openSection.value;
  openSection.value = null;
  activeIndex.value = Math.max(
    0,
    sections.value.findIndex((section) => section.key === key),
  );
  await nextTick();
  listEl.value?.focus();
}

function choose(value: string) {
  if (openSection.value === "effort") emit("update:effort", value);
  else emit("update:modelValue", value);
  open.value = false;
}

/** Enter on a section row opens it; on an option row it picks. */
function activate() {
  if (!current.value) {
    const section = sections.value[activeIndex.value];
    if (section) void enter(section.key);
    return;
  }
  const option = current.value.options[activeIndex.value];
  if (option) choose(option.value);
}

function move(delta: number) {
  const count = rows.value;
  if (count === 0) return;
  activeIndex.value = (activeIndex.value + delta + count) % count;
}

function onEscape() {
  if (openSection.value) void back();
  else open.value = false;
}

/** Close when the click lands outside — including on another widget. */
function onWindowPointerDown(event: PointerEvent) {
  if (!rootEl.value?.contains(event.target as Node)) open.value = false;
}

watch(open, (isOpen) => {
  if (isOpen) window.addEventListener("pointerdown", onWindowPointerDown, true);
  else window.removeEventListener("pointerdown", onWindowPointerDown, true);
});
</script>

<template>
  <div ref="rootEl" class="picker">
    <!--
      Says what will run without being opened: the model, and the effort beside
      it when one is set. Dimmed, because the effort qualifies the model rather
      than being a second thing of equal weight.
    -->
    <button
      type="button"
      class="picker-button"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="toggle"
    >
      <span class="picker-label">{{ triggerModel }}</span>
      <span v-if="triggerEffort" class="picker-effort">{{ triggerEffort }}</span>
      <span v-if="selectedModel && !selectedModel.configured" class="picker-warn">no key</span>
      <WizardChevron />
    </button>

    <div
      v-if="open"
      ref="listEl"
      class="picker-list"
      role="menu"
      tabindex="-1"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.right.prevent="activate()"
      @keydown.left.prevent="onEscape()"
      @keydown.enter.prevent="activate()"
      @keydown.esc.prevent="onEscape()"
    >
      <!-- Top level: one row per setting, with what it currently says. -->
      <template v-if="!current">
        <button
          v-for="(section, index) in sections"
          :key="section.key"
          type="button"
          role="menuitem"
          class="picker-row"
          :class="{ 'picker-item--active': index === activeIndex }"
          @mouseenter="activeIndex = index"
          @click="enter(section.key)"
        >
          <span class="picker-row-name">{{ section.label }}</span>
          <span class="picker-row-value">{{ currentLabel(section) }}</span>
          <span class="picker-row-more" aria-hidden="true">›</span>
        </button>
      </template>

      <!--
        One level down. The heading repeats which setting this is, so a panel
        that has replaced the one behind it still says what it is for.
      -->
      <template v-else>
        <button type="button" class="picker-back" @click="back()">
          <span aria-hidden="true">‹</span> {{ current.label }}
        </button>
        <button
          v-for="(option, index) in current.options"
          :key="option.value"
          type="button"
          role="menuitemradio"
          class="picker-item"
          :class="{
            'picker-item--active': index === activeIndex,
            'picker-item--current': option.value === current.selected,
            'picker-item--locked': Boolean(option.warn),
          }"
          :aria-checked="option.value === current.selected"
          @mouseenter="activeIndex = index"
          @click="choose(option.value)"
        >
          <span class="picker-item-head">
            <span class="picker-item-name">{{ option.label }}</span>
            <span v-if="option.warn" class="picker-warn">{{ option.warn }}</span>
            <span v-if="option.value === current.selected" class="picker-check" aria-hidden="true">
              ✓
            </span>
          </span>
          <span v-if="option.note" class="picker-item-note">{{ option.note }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
}

.picker-button {
  display: flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 11px;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: rgba(var(--fg-rgb), 0.07);
  color: inherit;
  cursor: pointer;
  max-width: 240px;
}

.picker-button:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.12);
}

.picker-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.picker-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The effort qualifies the model, so it reads as a subtitle rather than a peer. */
.picker-effort {
  opacity: 0.55;
  white-space: nowrap;
}

.picker-warn {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(220, 160, 90, 0.2);
  color: rgba(235, 190, 130, 0.95);
  white-space: nowrap;
}

.picker-list {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 20;
  min-width: 250px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: var(--card-bg, rgba(28, 28, 30, 0.98));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  outline: none;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  font: inherit;
  font-size: 12px;
  text-align: left;
  padding: 6px 8px;
  border: none;
  border-radius: 7px;
  background: none;
  color: inherit;
  cursor: pointer;
}

.picker-row-name {
  flex: 1;
}

.picker-row-value {
  opacity: 0.55;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-row-more {
  opacity: 0.4;
  font-size: 11px;
}

.picker-back {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  font: inherit;
  font-size: 10px;
  text-align: left;
  padding: 4px 8px 6px;
  margin-bottom: 2px;
  border: none;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 0;
  background: none;
  color: inherit;
  opacity: 0.55;
  cursor: pointer;
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

.picker-item--active,
.picker-row.picker-item--active {
  background: rgba(var(--fg-rgb), 0.1);
}

.picker-item--current .picker-item-name {
  font-weight: 600;
}

.picker-item--locked {
  opacity: 0.6;
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
