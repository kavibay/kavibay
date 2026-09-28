<script setup lang="ts">
// SPDX-License-Identifier: MIT
import IconBase from "../icons/IconBase.vue";

withDefaults(defineProps<{ label?: string; disabled?: boolean }>(), {
  label: "Close dialog",
  disabled: false,
});
</script>

<template>
  <button type="button" class="dialog-close-button" :aria-label="label" :disabled="disabled">
    <IconBase :size="16"><path d="m6 6 12 12M6 18 18 6" /></IconBase>
  </button>
</template>

<style scoped>
.dialog-close-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  cursor: pointer;
  transition: background 120ms, color 120ms;
}

.dialog-close-button:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.9);
}

.dialog-close-button:focus-visible {
  outline: 1px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 2px;
  color: rgba(var(--fg-rgb), 0.95);
}

.dialog-close-button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
