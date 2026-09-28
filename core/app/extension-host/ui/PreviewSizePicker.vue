<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import IconBase from "@sdk/icons/IconBase.vue";
import { MAX_PREVIEW_SIZE, MIN_PREVIEW_SIZE, PREVIEW_PRESETS, validPreviewDimension,
  type PreviewFormat, type PreviewFraming, type PreviewSize } from "./previewSize";

const props = defineProps<{ modelValue: PreviewFraming | null; currentSize: PreviewSize; disabled: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: PreviewFraming] }>();
const panelId = useId();
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const widthInput = ref<HTMLInputElement | null>(null);
const open = ref(false);
const maxPanelHeight = ref(320);
const custom = ref(false);
const currentSize = computed(() => props.modelValue ?? props.currentSize);
const width = ref<number | string>(0);
const height = ref<number | string>(0);
const valid = computed(() => validPreviewDimension(Number(width.value)) && validPreviewDimension(Number(height.value)));
const options = [
  { format: "landscape", label: "Landscape", detail: "16:9" },
  { format: "portrait", label: "Portrait", detail: "9:16" },
  { format: "custom", label: "Custom", detail: "" },
] as const;

function close(restoreFocus = false): boolean {
  if (!open.value) return false;
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
  return true;
}
defineExpose({ close });

async function toggle(): Promise<void> {
  if (props.disabled || close()) return;
  width.value = Math.round(currentSize.value.width);
  height.value = Math.round(currentSize.value.height);
  custom.value = props.modelValue?.format === "custom";
  if (trigger.value) {
    const bounds = trigger.value.getBoundingClientRect();
    const zoom = bounds.height / trigger.value.offsetHeight || 1;
    maxPanelHeight.value = Math.max(0, (bounds.top - 12) / zoom - 8);
  }
  open.value = true;
  await nextTick();
  (root.value?.querySelector<HTMLButtonElement>("[aria-pressed='true']")
    ?? root.value?.querySelector<HTMLButtonElement>(".size-option"))?.focus();
}

async function select(format: PreviewFormat): Promise<void> {
  if (props.disabled) return;
  if (format === "custom") {
    custom.value = true;
    await nextTick();
    widthInput.value?.focus();
    widthInput.value?.select();
    return;
  }
  emit("update:modelValue", { format, ...PREVIEW_PRESETS[format] });
  close(true);
}

function applyCustom(): void {
  if (props.disabled || !valid.value) return;
  emit("update:modelValue", { format: "custom", width: Number(width.value), height: Number(height.value) });
  close(true);
}

function moveFocus(event: KeyboardEvent, index: number): void {
  let next = index;
  if (event.key === "ArrowDown") next = (index + 1) % options.length;
  else if (event.key === "ArrowUp") next = (index + options.length - 1) % options.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = options.length - 1;
  else return;
  event.preventDefault();
  root.value?.querySelectorAll<HTMLButtonElement>(".size-option")[next]?.focus();
}

function onOutside(event: Event): void {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close();
}
function onBlur(): void { close(); }
watch(() => props.disabled, (disabled) => { if (disabled) close(); });
onMounted(() => {
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("focusin", onOutside);
  // Focusing a sandboxed widget does not dispatch pointer events in the host.
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", onBlur);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("focusin", onOutside);
  window.removeEventListener("blur", onBlur);
  window.removeEventListener("resize", onBlur);
});
</script>

<template>
  <div ref="root" class="preview-size-picker">
    <button ref="trigger" type="button" class="size-trigger" aria-label="Preview size"
      :title="`Preview size · ${Math.round(currentSize.width)} × ${Math.round(currentSize.height)}`" :disabled="disabled"
      aria-haspopup="dialog" :aria-expanded="open" :aria-controls="panelId" @mousedown.prevent @click="toggle">
      <IconBase :size="16"><path d="M8 3H3v5m13 13h5v-5M3 3l6 6m12 12-6-6" /><path d="M14 3h5a2 2 0 0 1 2 2v5M3 14v5a2 2 0 0 0 2 2h5" /></IconBase>
    </button>
    <div v-if="open" :id="panelId" class="size-panel" :style="{ maxHeight: `${maxPanelHeight}px` }" role="dialog" aria-label="Preview size options">
      <div class="size-heading">Preview size</div>
      <div role="group" aria-label="Preview format">
        <!-- WebKit otherwise focuses the dialog on mouse-down, dismissing this panel before click. -->
        <button v-for="(option, index) in options" :key="option.format" type="button" class="size-option"
          :aria-pressed="custom ? option.format === 'custom' : modelValue?.format === option.format"
          @mousedown.prevent @click="select(option.format)" @keydown="moveFocus($event, index)">
          <IconBase :size="17" :stroke-width="1.5">
            <rect v-if="option.format === 'landscape'" x="2" y="6" width="20" height="12" rx="2" />
            <rect v-else-if="option.format === 'portrait'" x="6" y="2" width="12" height="20" rx="2" />
            <template v-else><path d="M8 3H3v5m13 13h5v-5M3 3l6 6m12 12-6-6" /><path d="M14 3h7v7M3 14v7h7" /></template>
          </IconBase>
          <span class="size-option-label">{{ option.label }}</span>
          <span class="size-option-detail">{{ option.detail }}</span>
          <IconBase :size="13" class="size-check"><path d="m5 12 4 4L19 6" /></IconBase>
        </button>
      </div>
      <form v-if="custom" class="size-custom" @submit.prevent="applyCustom">
        <div class="size-fields">
          <label>Width
            <span class="size-input"><input ref="widthInput" v-model="width" type="number" aria-label="Preview width"
              :min="MIN_PREVIEW_SIZE" :max="MAX_PREVIEW_SIZE" step="1" required /><span>px</span></span>
          </label>
          <span class="size-times" aria-hidden="true">×</span>
          <label>Height
            <span class="size-input"><input v-model="height" type="number" aria-label="Preview height"
              :min="MIN_PREVIEW_SIZE" :max="MAX_PREVIEW_SIZE" step="1" required /><span>px</span></span>
          </label>
        </div>
        <div class="size-custom-footer">
          <span>{{ MIN_PREVIEW_SIZE }}–{{ MAX_PREVIEW_SIZE }} px</span>
          <button type="submit" class="size-apply" :disabled="!valid" @mousedown.prevent>Apply</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.preview-size-picker { position: relative; flex-shrink: 0; }
button { display: inline-flex; align-items: center; border: 0; border-radius: 7px; background: transparent; color: rgba(var(--fg-rgb), 0.7); font: inherit; font-size: 11px; cursor: pointer; }
button:hover:not(:disabled), .size-trigger[aria-expanded="true"] { background: rgba(var(--fg-rgb), 0.08); color: rgba(var(--fg-rgb), 0.95); }
button:focus-visible { outline: 2px solid rgba(var(--fg-rgb), 0.6); outline-offset: 2px; }
button:disabled { opacity: 0.4; cursor: default; }
.size-trigger { width: 30px; height: 30px; justify-content: center; padding: 0; box-shadow: inset 0 0 0 1px rgba(var(--fg-rgb), 0.08); }
.size-panel { position: absolute; z-index: 3; right: 0; bottom: calc(100% + 8px); width: 236px; overflow-y: auto; padding: 6px; box-sizing: border-box; border: 1px solid rgba(var(--fg-rgb), 0.13); border-radius: 12px; background: rgb(var(--surface-bg-rgb)); box-shadow: 0 8px 32px #0006, 0 1px 4px #0003; }
.size-heading { padding: 5px 8px 9px; font-size: 10px; font-weight: 600; color: rgba(var(--fg-rgb), 0.4); }
.size-option { width: 100%; gap: 10px; padding: 9px 8px; text-align: left; }
.size-option-label { flex: 1; }
.size-option-detail { color: rgba(var(--fg-rgb), 0.35); font-size: 10px; font-variant-numeric: tabular-nums; }
.size-check { opacity: 0; }
.size-option[aria-pressed="true"] { color: rgba(var(--fg-rgb), 0.95); background: rgba(var(--fg-rgb), 0.05); }
.size-option[aria-pressed="true"] .size-check { opacity: 1; }
.size-custom { margin-top: 6px; padding: 10px 8px 4px; border-top: 1px solid rgba(var(--fg-rgb), 0.08); }
.size-fields { display: flex; align-items: flex-end; gap: 7px; }
.size-fields label { display: flex; flex: 1; flex-direction: column; gap: 6px; min-width: 0; font-size: 10px; color: rgba(var(--fg-rgb), 0.55); }
.size-times { padding-bottom: 8px; color: rgba(var(--fg-rgb), 0.3); font-size: 12px; }
.size-input { display: flex; align-items: center; gap: 3px; padding: 7px 8px; border: 1px solid rgba(var(--fg-rgb), 0.12); border-radius: 6px; background: rgba(var(--fg-rgb), 0.035); }
.size-input:focus-within { border-color: rgba(var(--fg-rgb), 0.5); }
.size-input input { width: 100%; min-width: 0; border: 0; outline: none; padding: 0; background: transparent; color: rgba(var(--fg-rgb), 0.9); font: inherit; font-size: 11px; font-variant-numeric: tabular-nums; appearance: textfield; }
.size-input input::-webkit-inner-spin-button, .size-input input::-webkit-outer-spin-button { appearance: none; margin: 0; }
.size-input > span { color: rgba(var(--fg-rgb), 0.3); }
.size-custom-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; font-size: 9px; color: rgba(var(--fg-rgb), 0.35); }
.size-apply { padding: 6px 13px; background: rgba(var(--fg-rgb), 0.09); color: rgba(var(--fg-rgb), 0.9); }
</style>
