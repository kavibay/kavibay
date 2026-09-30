<script setup lang="ts">
/**
 * The input fields of one credential type, and the button that submits them.
 *
 * Schema-driven: every input, label and hint comes from the type definition in
 * Rust — no per-integration knowledge here, which is the point of the
 * credentials abstraction. `CredentialAccounts` decides what submitting means
 * (save, or save and sign in) and where the form sits.
 */
import { invoke } from "@tauri-apps/api/core";
import type { CredentialSummary, CredentialTypeSchema } from "./credentialsApi";
import { fieldPlaceholder, type FormValues } from "./credentialsLogic";

const props = defineProps<{
  type: CredentialTypeSchema;
  /** The saved connection being edited, or null for a new one. */
  summary: CredentialSummary | null;
  /** The name only matters once there is more than one connection to tell apart. */
  showName: boolean;
  submitLabel: string;
  submitDisabled: boolean;
  cancellable: boolean;
}>();
const emit = defineEmits<{ submit: []; cancel: [] }>();
const name = defineModel<string>("name", { required: true });
const values = defineModel<FormValues>("values", { required: true });

/** Opens the provider's setup docs in the system browser. */
async function openDocs() {
  if (props.type.docsUrl) await invoke("launch_path", { path: props.type.docsUrl });
}
</script>

<template>
  <form class="cf" @submit.prevent="emit('submit')">
    <label v-if="showName" class="cf-field">
      <span class="cf-label">Name</span>
      <input v-model="name" type="text" autocomplete="off" :placeholder="type.displayName" />
      <span class="cf-help">Shown wherever you pick an account — e.g. Work, Personal.</span>
    </label>
    <label v-for="field in type.fields" :key="field.key" class="cf-field">
      <span class="cf-label">
        {{ field.label }}<span v-if="field.required" class="cf-req">*</span>
      </span>
      <input
        v-model="values[field.key]"
        :type="field.kind === 'password' ? 'password' : 'text'"
        autocomplete="off"
        spellcheck="false"
        :placeholder="fieldPlaceholder(field, summary)"
      />
      <span v-if="field.help" class="cf-help">{{ field.help }}</span>
    </label>

    <div class="cf-actions">
      <button type="submit" class="settings-btn settings-btn--primary" :disabled="submitDisabled">
        {{ submitLabel }}
      </button>
      <button v-if="cancellable" type="button" class="settings-btn settings-btn--quiet" @click="emit('cancel')">
        Cancel
      </button>
      <button v-if="type.docsUrl" type="button" class="cf-docs" :title="type.docsUrl" @click="openDocs">
        Setup guide
      </button>
    </div>
    <slot />
  </form>
</template>

<style scoped>
.cf {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 480px;
}

.cf-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.cf-label {
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.7);
}

.cf-req {
  margin-left: 3px;
  color: rgba(255, 160, 120, 0.9);
}

.cf-field input {
  padding: 7px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(var(--inset-rgb), 0.25);
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
}

.cf-field input:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.3);
}

.cf-help {
  font-size: 11px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.45);
}

.cf-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cf-docs {
  margin-left: auto;
  padding: 0;
  border: 0;
  background: none;
  color: rgba(var(--fg-rgb), 0.6);
  font: inherit;
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.cf-docs:hover,
.cf-docs:focus-visible {
  outline: none;
  color: rgba(var(--fg-rgb), 0.9);
}
</style>
