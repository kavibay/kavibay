<script setup lang="ts">
/**
 * Settings → AI.
 *
 * One tab per LLM provider: the provider's key on top (the same schema-driven
 * `CredentialEditor` the Credentials panel renders — this panel adds no
 * per-provider form knowledge). Model switches appear only after a key is
 * stored for that tab.
 *
 * Switching a model off hides it from every picker in the app, because the
 * enable state lives in the backend next to the catalog rather than in this
 * panel's `localStorage`.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import KavibaySelect from "@sdk/KavibaySelect.vue";
import CredentialEditor from "../credentials/CredentialEditor.vue";
import {
  listCredentials,
  listCredentialTypes,
  type CredentialSummary,
  type CredentialTypeSchema,
} from "../credentials/credentialsApi";
import {
  getQuickActionModel,
  getQuickActionShortcut,
  getDisabledQuickActionTemplates,
  listLlmCatalog,
  setLlmModelEnabled,
  setQuickActionModel,
  setQuickActionShortcutCapture,
  setQuickActionShortcut,
  setDisabledQuickActionTemplates,
  type LlmModelOption,
} from "./aiApi";
import {
  AI_PROVIDER_TABS,
  credentialTypeForProvider,
  enabledSummary,
  modelsForProvider,
  providerHasKey,
  quickModelChoices,
  quickModelSelection,
  withModelEnabled,
  type AiProviderTab,
} from "./aiPanelLogic";
import { listTextActions } from "../../extensions/textActions";

const models = ref<LlmModelOption[]>([]);
const types = ref<CredentialTypeSchema[]>([]);
const credentials = ref<CredentialSummary[]>([]);
const activeProvider = ref<AiProviderTab["id"]>(AI_PROVIDER_TABS[0].id);
const loading = ref(true);
const error = ref<string | null>(null);
/** Model id currently being written, so its row can show the pending state. */
const toggling = ref<string | null>(null);
/** Quick-action model as stored ("" = automatic) and as currently resolved. */
const quickSelected = ref("");
const quickResolved = ref("");
const quickShortcut = ref("Ctrl+Alt+Q");
const savingQuickShortcut = ref(false);
const recordingQuickShortcut = ref(false);
const disabledQuickTemplates = ref<string[]>([]);
const savingQuickTemplate = ref<string | null>(null);
const quickTemplates = ref<Awaited<ReturnType<typeof listTextActions>>>([]);

const providerModels = computed(() => modelsForProvider(models.value, activeProvider.value));
/** Model switches only appear after this tab's key is stored. */
const showModels = computed(() => providerHasKey(models.value, activeProvider.value));

const quickChoices = computed(() => quickModelChoices(models.value));
const quickValue = computed(() => quickModelSelection(models.value, quickSelected.value));
/** Label of the model "Automatic" currently lands on, for the hint line. */
const quickResolvedLabel = computed(
  () => models.value.find((model) => model.id === quickResolved.value)?.label ?? "",
);

/** Rows for the quick-action model picker, including Automatic. */
const quickOptions = computed(() => [
  {
    value: "",
    label: "Automatic",
    note: quickResolvedLabel.value
      ? `Currently ${quickResolvedLabel.value}`
      : "First set-up model",
  },
  ...quickChoices.value.map((model) => ({
    value: model.id,
    label: model.label,
    note: model.note,
  })),
]);

/** Credential type definition for the open tab, or null while loading. */
const activeType = computed<CredentialTypeSchema | null>(() => {
  const typeId = credentialTypeForProvider(models.value, activeProvider.value);
  return types.value.find((type) => type.id === typeId) ?? null;
});

/** First stored credential of the open tab's type — the UI is single-credential. */
const activeSummary = computed<CredentialSummary | null>(() => {
  const typeId = activeType.value?.id;
  if (!typeId) return null;
  return credentials.value.find((entry) => entry.typeId === typeId) ?? null;
});

/** "2 / 4" badge per tab, so a fully switched-off provider is visible closed. */
function tabSummary(provider: AiProviderTab["id"]): string {
  const { enabled, total } = enabledSummary(models.value, provider);
  return `${enabled}/${total}`;
}

async function reload() {
  error.value = null;
  try {
    const [loadedModels, loadedTypes, loadedCredentials, quick, loadedShortcut, disabledTemplates, loadedTemplates] = await Promise.all([
      listLlmCatalog(),
      listCredentialTypes(),
      listCredentials(),
      getQuickActionModel(),
      getQuickActionShortcut(),
      getDisabledQuickActionTemplates(),
      listTextActions(),
    ]);
    models.value = loadedModels;
    types.value = loadedTypes;
    credentials.value = loadedCredentials;
    quickSelected.value = quick.selected;
    quickResolved.value = quick.resolved;
    quickShortcut.value = loadedShortcut;
    disabledQuickTemplates.value = disabledTemplates;
    quickTemplates.value = loadedTemplates.filter((action) => action.widgetAction);
  } catch (cause) {
    error.value = String(cause);
  } finally {
    loading.value = false;
  }
}

/**
 * Persist one switch, then apply it locally. Writing first means a rejected
 * write leaves the checkbox where it was instead of showing a state the
 * backend does not have.
 */
async function onToggleModel(modelId: string, event: Event) {
  const input = event.target as HTMLInputElement;
  const next = input.checked;
  toggling.value = modelId;
  error.value = null;
  try {
    await setLlmModelEnabled(modelId, next);
    models.value = withModelEnabled(models.value, modelId, next);
    // Switching off the model quick actions were pinned to changes what
    // "Automatic" resolves to — re-read rather than guess.
    await refreshQuickModel();
  } catch (cause) {
    error.value = String(cause);
    input.checked = !next;
  } finally {
    toggling.value = null;
  }
}

async function refreshQuickModel() {
  const quick = await getQuickActionModel();
  quickSelected.value = quick.selected;
  quickResolved.value = quick.resolved;
}

/** Persist the quick-action model; "" means automatic. */
async function onPickQuickModel(modelId: string | number) {
  error.value = null;
  try {
    await setQuickActionModel(String(modelId));
    await refreshQuickModel();
  } catch (cause) {
    error.value = String(cause);
  }
}

/** User-created templates notify the dynamic action catalog in this window. */
async function refreshQuickTemplates() {
  quickTemplates.value = (await listTextActions()).filter((action) => action.widgetAction);
}

function quickTemplateKey(action: { extensionId: string; actionId: string }): string {
  return `${action.extensionId}/${action.actionId}`;
}

async function onToggleQuickTemplate(action: { extensionId: string; actionId: string }, event: Event) {
  const input = event.target as HTMLInputElement;
  const key = quickTemplateKey(action);
  const next = input.checked
    ? disabledQuickTemplates.value.filter((id) => id !== key)
    : [...disabledQuickTemplates.value, key];
  savingQuickTemplate.value = key;
  error.value = null;
  try {
    await setDisabledQuickActionTemplates(next);
    disabledQuickTemplates.value = next;
  } catch (cause) {
    error.value = String(cause);
    input.checked = !input.checked;
  } finally {
    savingQuickTemplate.value = null;
  }
}

function shortcutFromKey(event: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  const modifiers = [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
  ].filter(Boolean);
  if (modifiers.length === 0) return null;
  // `key` is layout-dependent: on a German keyboard Ctrl+Alt+Q can be "@"
  // (AltGr). `code` names the physical key and matches Tauri's shortcut parser.
  const key = event.code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace(/^Numpad/, "Num")
    .replace(" ", "Space");
  if (!key || key === "Unidentified") return null;
  return [...modifiers, key].join("+");
}

/** Capture and persist a native global shortcut as one deliberate keystroke. */
async function captureQuickShortcut(event: KeyboardEvent) {
  if (!recordingQuickShortcut.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    recordingQuickShortcut.value = false;
    await setQuickActionShortcutCapture(false);
    return;
  }
  const shortcut = shortcutFromKey(event);
  if (!shortcut || savingQuickShortcut.value) return;
  savingQuickShortcut.value = true;
  error.value = null;
  try {
    await setQuickActionShortcut(shortcut);
    quickShortcut.value = shortcut;
    recordingQuickShortcut.value = false;
    await setQuickActionShortcutCapture(false);
  } catch (cause) {
    error.value = String(cause);
  } finally {
    savingQuickShortcut.value = false;
  }
}

async function beginQuickShortcutCapture(event: MouseEvent) {
  error.value = null;
  try {
    await setQuickActionShortcutCapture(true);
    recordingQuickShortcut.value = true;
    (event.currentTarget as HTMLButtonElement | null)?.blur();
  } catch (cause) {
    error.value = String(cause);
  }
}

onMounted(() => {
  void reload();
  window.addEventListener("keydown", captureQuickShortcut, true);
  window.addEventListener("kavibay:text-actions-changed", refreshQuickTemplates);
});

onUnmounted(() => {
  window.removeEventListener("keydown", captureQuickShortcut, true);
  window.removeEventListener("kavibay:text-actions-changed", refreshQuickTemplates);
  void setQuickActionShortcutCapture(false);
});
</script>

<template>
  <div class="ai">
    <header class="ai-head">
      <h2 class="ai-title">AI</h2>
      <p class="ai-lead">
        Keys and models for the LLM providers. A model switched off here disappears
        from every model picker in the app — the Widget Wizard included.
      </p>
    </header>

    <p v-if="loading" class="ai-note">Loading…</p>
    <p v-else-if="error" class="ai-error">{{ error }}</p>

    <template v-if="!loading">
      <section class="ai-block">
        <h3 class="ai-block-title">Quick actions</h3>
        <p class="ai-block-hint">
          Rewrites the current selection from anywhere, via the shortcut below.
        </p>

        <div class="ai-group">
          <span class="ai-field-label">Shortcut</span>
          <div class="ai-shortcut-row">
            <output id="ai-quick-shortcut" class="ai-shortcut-value">{{ quickShortcut }}</output>
            <button
              type="button"
              class="ai-action"
              :class="{ 'ai-action--recording': recordingQuickShortcut }"
              :disabled="savingQuickShortcut"
              @click="beginQuickShortcutCapture($event)"
            >
              {{ recordingQuickShortcut ? "Press shortcut…" : "Set new hotkey" }}
            </button>
          </div>
          <p class="ai-field-hint">
            {{
              recordingQuickShortcut
                ? "Press the new shortcut now, or Escape to cancel."
                : "Ctrl, Alt, Shift, or Super is required."
            }}
          </p>

          <span class="ai-field-label">Model</span>
          <KavibaySelect
            size="md"
            aria-label="Quick action model"
            :options="quickOptions"
            :model-value="quickValue"
            :disabled="quickChoices.length === 0"
            @update:model-value="onPickQuickModel"
          />
          <p class="ai-field-hint">
            <template v-if="quickChoices.length === 0">
              Add a key below before quick actions can run.
            </template>
            <template v-else-if="quickValue">
              Text selected anywhere is rewritten by this model.
            </template>
            <template v-else>
              Uses the first set-up model{{
                quickResolvedLabel ? ` — currently ${quickResolvedLabel}` : ""
              }}.
            </template>
          </p>
        </div>

        <div v-if="quickTemplates.length > 0" class="ai-templates">
          <span class="ai-field-label">Templates in the menu</span>
          <label
            v-for="action in quickTemplates"
            :key="quickTemplateKey(action)"
            class="toggle"
            :class="{ 'toggle--off': disabledQuickTemplates.includes(quickTemplateKey(action)) }"
          >
            <span class="toggle-copy">
              <span class="toggle-title">{{ action.title }}</span>
              <span v-if="action.subtitle" class="toggle-hint">{{ action.subtitle }}</span>
            </span>
            <span class="switch">
              <input
                type="checkbox"
                :checked="!disabledQuickTemplates.includes(quickTemplateKey(action))"
                :disabled="savingQuickTemplate === quickTemplateKey(action)"
                @change="onToggleQuickTemplate(action, $event)"
              />
              <span class="switch-ui" />
            </span>
          </label>
        </div>
      </section>

      <section class="ai-block">
        <h3 class="ai-block-title">Providers</h3>
        <div class="ai-tabs" role="tablist">
          <button
            v-for="tab in AI_PROVIDER_TABS"
            :key="tab.id"
            type="button"
            role="tab"
            class="ai-tab"
            :class="{ 'ai-tab--active': activeProvider === tab.id }"
            :aria-selected="activeProvider === tab.id"
            @click="activeProvider = tab.id"
          >
            {{ tab.label }}
            <span class="ai-tab-count">{{ tabSummary(tab.id) }}</span>
          </button>
        </div>

        <CredentialEditor
          v-if="activeType"
          :key="activeType.id"
          :type="activeType"
          :summary="activeSummary"
          @changed="reload"
        />
      </section>

      <section v-if="showModels" class="ai-block">
        <h3 class="ai-block-title">Models</h3>
        <p class="ai-block-hint">
          Only switched-on models are offered to widgets. Nothing is deleted —
          switching one back on makes it available again immediately.
        </p>

        <label
          v-for="model in providerModels"
          :key="model.id"
          class="toggle"
          :class="{ 'toggle--off': !model.enabled }"
        >
          <span class="toggle-copy">
            <span class="toggle-title">{{ model.label }}</span>
            <span class="toggle-hint">{{ model.note }}</span>
            <span class="toggle-id">{{ model.id }}</span>
          </span>
          <span class="switch">
            <input
              type="checkbox"
              :checked="model.enabled"
              :disabled="toggling === model.id"
              @change="onToggleModel(model.id, $event)"
            />
            <span class="switch-ui" />
          </span>
        </label>

        <p v-if="providerModels.length === 0" class="ai-block-hint">
          No models for this provider.
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ai {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding-bottom: 8px;
}

.ai-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.ai-lead,
.ai-block-hint,
.ai-field-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.ai-field-hint {
  font-size: 12px;
}

.ai-note,
.ai-error {
  margin: 0;
  font-size: 13px;
}

.ai-note {
  color: rgba(var(--fg-rgb), 0.5);
}

.ai-error {
  color: rgba(255, 140, 140, 0.95);
}

.ai-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ai-block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.ai-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.035);
}

.ai-field-label {
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.55);
}

.ai-shortcut-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-shortcut-value {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 10px;
  background: rgba(var(--inset-rgb), 0.28);
  color: rgba(var(--fg-rgb), 0.8);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-action {
  flex: none;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.ai-action:hover:not(:disabled),
.ai-action:focus-visible {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
  outline: none;
}

.ai-action--recording {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

.ai-action:disabled {
  cursor: default;
  opacity: 0.55;
}

.ai-templates {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
}

.ai-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  justify-content: center;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.6);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.ai-tab:hover {
  color: rgba(var(--fg-rgb), 0.9);
}

.ai-tab--active {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
  color: rgba(var(--fg-rgb), 0.95);
}

.ai-tab-count {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.1);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.55);
}

.ai-tab--active .ai-tab-count {
  color: rgba(var(--fg-rgb), 0.7);
}

.toggle {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
  cursor: pointer;
}

.toggle:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.toggle--off {
  opacity: 0.58;
}

.toggle-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.toggle-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.toggle-hint {
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.45);
}

.toggle-id {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switch {
  position: relative;
  display: inline-flex;
  flex: none;
  margin-top: 1px;
}

.switch input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.switch-ui {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.15);
}

.switch-ui::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.85);
}

.switch input:checked + .switch-ui {
  background: rgba(var(--fg-rgb), 0.82);
}

.switch input:checked + .switch-ui::after {
  background: rgb(var(--surface-bg-rgb));
  transform: translateX(16px);
}

.switch input:focus-visible + .switch-ui {
  outline: 2px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 2px;
}

.switch input:disabled + .switch-ui {
  opacity: 0.5;
}

@media (max-width: 560px) {
  .ai-tabs {
    flex-direction: column;
  }
}
</style>
