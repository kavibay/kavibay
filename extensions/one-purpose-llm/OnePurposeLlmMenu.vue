<script setup lang="ts">
import { computed, inject } from "vue";
import { isPromptDefault } from "./onePurposeLlmLogic";
import {
  onePurposeLlmModelForInstance,
  onePurposeLlmModelRevision,
} from "./widgets/onePurposeLlm";

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");

const closeWidgetMenu = inject<() => void>("closeWidgetMenu", () => {});
const model = computed(() => {
  // Read for the dependency, not the value — `void` so it is an expression
  // statement lint accepts rather than one it reads as a mistake.
  void onePurposeLlmModelRevision.value;
  return onePurposeLlmModelForInstance(instanceId);
});

const empty = computed(() => {
  const state = model.value?.settings.value;
  return !state || (!state.input && !state.output);
});
const promptEdited = computed(() =>
  model.value
    ? !isPromptDefault(
        model.value.settings.value,
        model.value.customTemplates.value,
        model.value.hiddenTemplateIds.value,
      )
    : false,
);

/** Clear input + result and close the ⋯ menu. */
function onClear() {
  if (empty.value) return;
  model.value?.clearText();
  closeWidgetMenu();
}

/** Restore the shipped prompt for the active purpose. */
function onResetPrompt() {
  if (!promptEdited.value) return;
  model.value?.resetPrompt();
  closeWidgetMenu();
}
</script>

<template>
  <button type="button" role="menuitem" class="opl-menu-item" :disabled="empty" @click="onClear">
    <svg class="opl-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    Clear text
  </button>
  <button
    type="button"
    role="menuitem"
    class="opl-menu-item"
    :disabled="!promptEdited"
    @click="onResetPrompt"
  >
    <svg class="opl-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    Reset system prompt
  </button>
</template>

<style scoped>
.opl-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.opl-menu-item:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.08);
}

.opl-menu-item:disabled {
  cursor: default;
  opacity: 0.4;
}

.opl-menu-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.75;
}
</style>
