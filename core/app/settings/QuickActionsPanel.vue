<script setup lang="ts">
/**
 * Settings → Quick Actions: the shortcut that rewrites selected text anywhere,
 * the model it runs on, and which templates its menu offers.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import KavibaySelect from "@sdk/KavibaySelect.vue";
import { BrandMark } from "@sdk/brand";
import { SparklesIcon } from "@sdk/icons";
import {
  getDisabledQuickActionTemplates,
  getQuickActionModel,
  getQuickActionShortcut,
  listLlmCatalog,
  setDisabledQuickActionTemplates,
  setQuickActionModel,
  setQuickActionShortcut,
  setQuickActionShortcutCapture,
  type LlmModelOption,
} from "./ai/aiApi";
import {
  altGrCharacter,
  quickModelChoices,
  quickModelSelection,
  shortcutFromKey,
} from "./ai/aiPanelLogic";
import { listTextActions } from "../extensions/textActions";
import { useSettingsModal } from "./useSettingsModal";

const { showSection } = useSettingsModal();

const models = ref<LlmModelOption[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
/** Quick-action model as stored ("" = automatic) and as currently resolved. */
const quickSelected = ref("");
const quickResolved = ref("");
const quickShortcut = ref("Ctrl+Shift+Q");
const savingQuickShortcut = ref(false);
const recordingQuickShortcut = ref(false);
const disabledQuickTemplates = ref<string[]>([]);
const savingQuickTemplate = ref<string | null>(null);
const quickTemplates = ref<Awaited<ReturnType<typeof listTextActions>>>([]);

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

/**
 * Credential type of the model behind a picker value, which names its logo.
 * Automatic ("") shows the model it currently resolves to.
 */
function modelProvider(value: string | number | undefined): string | undefined {
  const id = value === "" ? quickResolved.value : value;
  return models.value.find((model) => model.id === id)?.credentialType;
}

function quickTemplateKey(action: { extensionId: string; actionId: string }): string {
  return `${action.extensionId}/${action.actionId}`;
}

/** What the menu shows right now — the preview follows every switch. */
const menuItems = computed(() =>
  quickTemplates.value.filter(
    (action) => !disabledQuickTemplates.value.includes(quickTemplateKey(action)),
  ),
);

async function reload() {
  error.value = null;
  try {
    const [loadedModels, quick, loadedShortcut, disabledTemplates, loadedTemplates] = await Promise.all([
      listLlmCatalog(),
      getQuickActionModel(),
      getQuickActionShortcut(),
      getDisabledQuickActionTemplates(),
      listTextActions(),
    ]);
    models.value = loadedModels;
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

/** Persist the quick-action model; "" means automatic. */
async function onPickQuickModel(modelId: string | number) {
  error.value = null;
  try {
    await setQuickActionModel(String(modelId));
    const quick = await getQuickActionModel();
    quickSelected.value = quick.selected;
    quickResolved.value = quick.resolved;
  } catch (cause) {
    error.value = String(cause);
  }
}

/** User-created templates notify the dynamic action catalog in this window. */
async function refreshQuickTemplates() {
  quickTemplates.value = (await listTextActions()).filter((action) => action.widgetAction);
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
  // Refused here rather than registered and regretted: Ctrl+Alt is AltGr, and
  // the damage shows up later, in another application, as a character that
  // stopped working for no visible reason. Recording stays on so the next press
  // is simply the better shortcut.
  const blocked = altGrCharacter(event);
  if (blocked) {
    error.value = `Ctrl+Alt is AltGr on this keyboard — that combination types "${blocked}", and a global shortcut would take it away in every app. Try Ctrl+Shift instead.`;
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
  <div class="quick">
    <Teleport to=".settings-sticky">
    <header class="quick-head">
      <h2 class="quick-title">Quick Actions</h2>
      <p class="quick-lead">
        Select text in any app and press {{ quickShortcut }} to rewrite it with AI.
      </p>
      <!-- The menu as it opens over a selection; mirrors QuickActionMenu.vue. -->
      <div class="glass-stage" aria-hidden="true">
        <div class="qa-scene">
          <p class="qa-doc">
            Thanks for the update, <mark class="qa-selection">i will looks into it tomorow</mark>
            and get back to you.
          </p>
          <div class="qa-menu">
            <p class="qa-preview">i will looks into it tomorow</p>
            <div
              v-for="(action, index) in menuItems.slice(0, 3)"
              :key="quickTemplateKey(action)"
              class="qa-item"
              :class="{ 'qa-item--highlighted': index === 0 }"
            >
              <span class="qa-item-label">{{ action.title }}</span>
              <span v-if="action.subtitle" class="qa-item-sub">{{ action.subtitle }}</span>
            </div>
            <p v-if="menuItems.length === 0" class="qa-empty">No quick actions installed</p>
          </div>
        </div>
      </div>
    </header>
    </Teleport>

    <p v-if="loading" class="quick-note">Loading…</p>
    <p v-else-if="error" class="quick-error">{{ error }}</p>

    <template v-if="!loading">
      <!-- Nothing can run without a model; say so first, with the way out. -->
      <div v-if="quickChoices.length === 0" class="quick-empty">
        <span class="quick-empty-tile" data-icon-tile>
          <SparklesIcon :size="18" />
        </span>
        <span class="quick-empty-copy">
          <span class="quick-empty-title">No AI provider set up</span>
          <span class="quick-empty-text">
            Quick actions run on a model from Anthropic, OpenAI or Cloudflare. Add a key
            for one of them in Settings → AI, then pick its model here.
          </span>
        </span>
        <button type="button" class="quick-action" @click="showSection('ai')">Set up AI</button>
      </div>

      <section class="settings-section">
        <h3 class="settings-section-title">Trigger</h3>

        <div class="settings-row">
          <span class="settings-row-copy">
            <span class="settings-row-title">Shortcut</span>
            <span class="settings-row-hint">
              {{
                recordingQuickShortcut
                  ? "Press the new shortcut now, or Escape to cancel."
                  : "Needs Ctrl, Alt, Shift or Super. Ctrl+Alt is AltGr on many layouts and is refused."
              }}
            </span>
          </span>
          <span class="shortcut">
            <kbd class="shortcut-keys">{{ quickShortcut }}</kbd>
            <button
              type="button"
              class="quick-action"
              :class="{ 'quick-action--recording': recordingQuickShortcut }"
              :disabled="savingQuickShortcut"
              @click="beginQuickShortcutCapture($event)"
            >
              {{ recordingQuickShortcut ? "Press shortcut…" : "Change" }}
            </button>
          </span>
        </div>

        <div v-if="quickChoices.length > 0" class="settings-row">
          <span class="settings-row-copy">
            <span class="settings-row-title">Model</span>
            <span class="settings-row-hint">
              <template v-if="quickValue">Text selected anywhere is rewritten by this model.</template>
              <template v-else>
                Uses the first set-up model{{
                  quickResolvedLabel ? ` — currently ${quickResolvedLabel}` : ""
                }}.
              </template>
              Add another provider's key in
              <button type="button" class="quick-link" @click="showSection('ai')">Settings → AI</button>
              to choose from its models too.
            </span>
          </span>
          <KavibaySelect
            class="row-select"
            aria-label="Quick action model"
            align="right"
            :options="quickOptions"
            :model-value="quickValue"
            @update:model-value="onPickQuickModel"
          >
            <template #value="{ option }">
              <span class="model-value">
                <BrandMark :provider="modelProvider(option?.value)" :size="14" />
                {{ option?.label }}
              </span>
            </template>
            <template #option="{ option }">
              <span class="model-option">
                <span class="model-mark">
                  <BrandMark :provider="modelProvider(option.value)" :size="16" />
                </span>
                <span class="model-option-text">
                  <span class="model-option-label">{{ option.label }}</span>
                  <span v-if="option.note" class="model-option-note">{{ option.note }}</span>
                </span>
              </span>
            </template>
          </KavibaySelect>
        </div>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">Menu</h3>
        <p class="settings-section-hint">Templates the menu offers. Switched-off ones stay installed.</p>

        <label
          v-for="action in quickTemplates"
          :key="quickTemplateKey(action)"
          class="settings-row"
        >
          <span
            class="settings-row-copy"
            :class="{ 'quick-off': disabledQuickTemplates.includes(quickTemplateKey(action)) }"
          >
            <span class="settings-row-title">{{ action.title }}</span>
            <span v-if="action.subtitle" class="settings-row-hint">{{ action.subtitle }}</span>
          </span>
          <span class="switch">
            <input
              type="checkbox"
              :aria-label="`Show ${action.title} in the menu`"
              :checked="!disabledQuickTemplates.includes(quickTemplateKey(action))"
              :disabled="savingQuickTemplate === quickTemplateKey(action)"
              @change="onToggleQuickTemplate(action, $event)"
            />
            <span class="switch-ui" />
          </span>
        </label>

        <p v-if="quickTemplates.length === 0" class="settings-section-hint">
          No templates installed.
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.quick {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding-bottom: 8px;
}

.quick-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quick-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.quick-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.quick-note,
.quick-error {
  margin: 0;
  font-size: 13px;
}

.quick-note {
  color: rgba(var(--fg-rgb), 0.5);
}

.quick-error {
  color: rgba(255, 140, 140, 0.95);
}

.quick-empty {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border: 1px dashed rgba(var(--fg-rgb), 0.16);
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.03);
}

/* Same tile as the AI entry in the nav; SparklesIcon colours it. */
.quick-empty-tile {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  color: var(--icon-tile-fg, currentColor);
  background: var(--icon-tile-bg, rgba(var(--fg-rgb), 0.08));
}

.quick-empty-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.quick-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.92);
}

.quick-empty-text {
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.quick-off {
  opacity: 0.5;
}

.quick-link {
  padding: 0;
  border: 0;
  background: none;
  color: rgba(var(--fg-rgb), 0.8);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.shortcut {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.shortcut-keys {
  padding: 5px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  border-radius: 7px;
  background: rgba(var(--fg-rgb), 0.05);
  color: rgba(var(--fg-rgb), 0.85);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.quick-action {
  flex: none;
  padding: 6px 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.quick-action:hover:not(:disabled),
.quick-action:focus-visible {
  background: rgba(var(--fg-rgb), 0.06);
  outline: none;
}

.quick-action--recording {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

.quick-action:disabled {
  cursor: default;
  opacity: 0.55;
}

/* Borderless dropdown, as in Appearance: just the value and a caret. */
.row-select {
  flex: none;
}

.row-select :deep(.ssel-trigger) {
  gap: 8px;
  border-color: transparent;
  background: transparent;
  font-size: 13px;
}

.row-select :deep(.ssel-trigger:hover:not(:disabled)) {
  border-color: transparent;
  background: rgba(var(--fg-rgb), 0.06);
}

/* Model notes are a sentence long; the default panel only fits a word per line. */
.row-select :deep(.ssel-panel) {
  width: 320px;
  max-width: none;
  max-height: 340px;
}

.model-value {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.model-option {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
}

.model-mark {
  flex: none;
  display: grid;
  place-items: center;
  width: 16px;
  height: 18px;
}

.model-option-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.model-option-label {
  line-height: 1.35;
}

.model-option-note {
  font-size: 11px;
  line-height: 1.35;
  color: rgba(var(--fg-rgb), 0.5);
}

/* Preview: a line of text in some app, and the menu opened beside the selection. */
.glass-stage {
  display: grid;
  place-items: center;
  height: 150px;
  margin-top: 12px;
  border-radius: 14px;
  background: #16181d url("../assets/share-canvas/nebula.png") center / cover;
}

.qa-scene {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.qa-doc {
  width: 220px;
  margin: 8px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(var(--surface-bg-rgb), 0.92);
  color: rgba(var(--fg-rgb), 0.75);
  font-size: 12px;
  line-height: 1.5;
}

.qa-selection {
  border-radius: 2px;
  background: rgba(59, 130, 246, 0.45);
  color: rgba(var(--fg-rgb), 0.95);
}

/* Same values as .qa-menu and its rows in QuickActionMenu.vue. */
.qa-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 240px;
  padding: 4px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 10px;
  background: rgba(var(--surface-bg-rgb), 0.97);
  box-shadow: 0 10px 28px rgba(var(--shadow-rgb), calc(0.45 * var(--shadow-scale, 1)));
  color: rgba(var(--fg-rgb), 0.92);
}

.qa-preview {
  margin: 0;
  padding: 5px 8px 6px;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.45);
  font-size: 11px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qa-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 7px;
  color: rgba(var(--fg-rgb), 0.82);
  font-size: 12px;
  font-weight: 500;
}

.qa-item--highlighted {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.95);
}

.qa-item-label {
  flex: none;
}

.qa-item-sub {
  flex: 1 1 auto;
  min-width: 0;
  color: rgba(var(--fg-rgb), 0.42);
  font-size: 11px;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qa-empty {
  margin: 0;
  padding: 6px 8px;
  color: rgba(var(--fg-rgb), 0.45);
  font-size: 11px;
}
</style>
