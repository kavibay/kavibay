<script setup lang="ts">
import type { ColorPickerModel } from "./widgets/colorPicker";

const props = defineProps<{ model: ColorPickerModel }>();
const {
  picking, pickError, copiedKey, hex, rgbCss, hslCss, swatchStyle,
  copyValue, startPick, cancelPick,
} = props.model;
</script>

<template>
  <div class="color-picker" @pointerdown.stop>
    <div class="color-picker-swatch" :style="swatchStyle" aria-hidden="true" />

    <div class="color-picker-formats">
      <button
        type="button"
        class="color-picker-row color-picker-row--primary"
        @click="copyValue('hex', hex)"
      >
        <span class="color-picker-label">Hex</span>
        <span class="color-picker-value">{{
          copiedKey === "hex" ? "Copied" : hex
        }}</span>
      </button>
      <button
        type="button"
        class="color-picker-row"
        @click="copyValue('rgb', rgbCss)"
      >
        <span class="color-picker-label">RGB</span>
        <span class="color-picker-value">{{
          copiedKey === "rgb" ? "Copied" : rgbCss
        }}</span>
      </button>
      <button
        type="button"
        class="color-picker-row"
        @click="copyValue('hsl', hslCss)"
      >
        <span class="color-picker-label">HSL</span>
        <span class="color-picker-value">{{
          copiedKey === "hsl" ? "Copied" : hslCss
        }}</span>
      </button>
    </div>

    <p v-if="pickError" class="color-picker-error">{{ pickError }}</p>

    <div class="color-picker-actions">
      <button
        type="button"
        class="color-picker-btn color-picker-btn--accent"
        @click="copyValue('hex', hex)"
      >
        {{ copiedKey === "hex" ? "Copied" : "Copy" }}
      </button>
      <button
        v-if="!picking"
        type="button"
        class="color-picker-btn color-picker-btn--ghost"
        @click="startPick"
      >
        Pick
      </button>
      <button
        v-else
        type="button"
        class="color-picker-btn color-picker-btn--ghost"
        @click="cancelPick"
      >
        Cancel
      </button>
    </div>
  </div>
</template>

<style scoped>
.color-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 168px;
}

.color-picker-swatch {
  width: 100%;
  height: 36px;
  border-radius: 6px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
}

.color-picker-formats {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.color-picker-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 3px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.75);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.color-picker-row:hover {
  background: rgba(var(--fg-rgb), 0.06);
}

.color-picker-row--primary {
  color: #fff;
  font-weight: 600;
}

.color-picker-label {
  opacity: 0.55;
  font-size: 11px;
}

.color-picker-value {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.color-picker-error {
  margin: 0;
  font-size: 11px;
  color: #e07a5f;
}

.color-picker-actions {
  display: flex;
  flex-direction: row;
  gap: 6px;
}

.color-picker-btn {
  flex: 1;
  padding: 6px 10px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.color-picker-btn--accent {
  background: rgba(var(--fg-rgb), 0.14);
  color: #fff;
}

.color-picker-btn--ghost {
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
}

.color-picker-btn--ghost:hover {
  color: rgba(var(--fg-rgb), 0.9);
}
</style>
