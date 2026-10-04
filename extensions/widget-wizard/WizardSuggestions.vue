<script setup lang="ts">
import type { WizardSuggestion } from "./wizardSuggestions";

defineProps<{ suggestions: readonly WizardSuggestion[] }>();
defineEmits<{ choose: [suggestion: WizardSuggestion] }>();
</script>

<template>
  <div v-if="suggestions.length" class="wizard-suggestions" role="group" aria-label="Suggested next changes">
    <span class="wizard-suggestions-label">Try next</span>
    <button
      v-for="suggestion in suggestions"
      :key="suggestion.label"
      type="button"
      :title="suggestion.prompt"
      @click="$emit('choose', suggestion)"
    >{{ suggestion.label }}</button>
  </div>
</template>

<style scoped>
.wizard-suggestions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;
}

.wizard-suggestions-label {
  flex-shrink: 0;
  margin-right: 2px;
  color: rgba(var(--fg-rgb), 0.4);
  font-size: 10px;
}

button {
  flex: 0 0 auto;
  padding: 5px 9px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.025);
  color: rgba(var(--fg-rgb), 0.65);
  font: inherit;
  font-size: 11px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}

button:hover {
  background: rgba(var(--fg-rgb), 0.07);
  color: rgba(var(--fg-rgb), 0.95);
}

button:focus-visible {
  outline: 1px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 2px;
}
</style>
