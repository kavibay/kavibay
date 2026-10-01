<script setup lang="ts">
/**
 * Settings → AI.
 *
 * A list of LLM providers, one row each: logo, name, and whether it is
 * connected. Opening a row shows its connection (`CredentialAccounts`, the same
 * component the Credentials panel renders — no per-provider form knowledge
 * here) and, once a key is stored, its model switches.
 *
 * A list rather than tabs: tabs showed one provider at a time, so "which of
 * these have I set up?" took three clicks to answer.
 *
 * Switching a model off hides it from every picker in the app, because the
 * enable state lives in the backend next to the catalog rather than in this
 * panel's `localStorage`.
 *
 * Quick actions have their own section (`QuickActionsPanel.vue`).
 */
import { nextTick, onMounted, ref, watch, type ComponentPublicInstance } from "vue";
import { BrandMark } from "@sdk/brand";
import CredentialAccounts from "../credentials/CredentialAccounts.vue";
import {
  listCredentials,
  listCredentialTypes,
  type CredentialSummary,
  type CredentialTypeSchema,
} from "../credentials/credentialsApi";
import { listLlmCatalog, setLlmModelEnabled, type LlmModelOption } from "./aiApi";
import {
  AI_PROVIDER_TABS,
  credentialTypeForProvider,
  modelsForProvider,
  providerHasKey,
  providerStatusLine,
  resolveAiProviderFocus,
  withModelEnabled,
  type AiProviderTab,
} from "./aiPanelLogic";
import { useSettingsModal } from "../useSettingsModal";

type ProviderId = AiProviderTab["id"];

const { aiProvider: focusProvider } = useSettingsModal();
const models = ref<LlmModelOption[]>([]);
const types = ref<CredentialTypeSchema[]>([]);
const credentials = ref<CredentialSummary[]>([]);
/** The one open row, or null with all of them closed. */
const openProvider = ref<ProviderId | null>(resolveAiProviderFocus(focusProvider.value));
const loading = ref(true);
const error = ref<string | null>(null);
/** Model id currently being written, so its row can show the pending state. */
const toggling = ref<string | null>(null);

/** Credential type definition a provider's key form edits, or null while loading. */
function credentialTypeOf(provider: ProviderId): CredentialTypeSchema | null {
  const typeId = credentialTypeForProvider(models.value, provider);
  return types.value.find((type) => type.id === typeId) ?? null;
}

function toggleProvider(provider: ProviderId) {
  openProvider.value = openProvider.value === provider ? null : provider;
}

/** Only the open row renders a key form, so one element is enough. */
const keyEditorEl = ref<HTMLElement | null>(null);
function setKeyEditor(el: Element | ComponentPublicInstance | null) {
  keyEditorEl.value = el instanceof HTMLElement ? el : null;
}

/** Open the provider a caller named, then consume the deep-link. */
function applyProviderFocus(requested: string | null): boolean {
  const next = resolveAiProviderFocus(requested, models.value);
  if (!next) return false;
  openProvider.value = next;
  focusProvider.value = null;
  return true;
}

/**
 * Scroll Settings to the key form and focus the secret field.
 *
 * Must run after `loading` is false — the list is not in the DOM while the
 * panel still says Loading, so a scroll then is a no-op. The scroll parent is
 * `.settings-body`, not the window.
 */
async function revealKeyEditor() {
  await nextTick();
  const card = keyEditorEl.value;
  if (!card) return;
  const scroller = card.closest(".settings-body");
  if (scroller instanceof HTMLElement) {
    const top =
      card.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - 8) });
  } else {
    card.scrollIntoView({ block: "start" });
  }
  const input =
    card.querySelector<HTMLInputElement>("input[type='password']") ??
    card.querySelector<HTMLInputElement>("input");
  input?.focus();
}

async function reload() {
  error.value = null;
  try {
    const [loadedModels, loadedTypes, loadedCredentials] = await Promise.all([
      listLlmCatalog(),
      listCredentialTypes(),
      listCredentials(),
    ]);
    models.value = loadedModels;
    types.value = loadedTypes;
    credentials.value = loadedCredentials;
    const shouldReveal = applyProviderFocus(focusProvider.value);
    loading.value = false;
    if (shouldReveal) await revealKeyEditor();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    loading.value = false;
  }
}

watch(focusProvider, (requested) => {
  if (!requested || loading.value) return;
  if (applyProviderFocus(requested)) void revealKeyEditor();
});

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
  } catch (cause) {
    error.value = String(cause);
    input.checked = !next;
  } finally {
    toggling.value = null;
  }
}

onMounted(() => {
  void reload();
});
</script>

<template>
  <div class="ai">
    <Teleport to=".settings-sticky">
    <header class="ai-head">
      <h2 class="ai-title">AI</h2>
      <p class="ai-lead">
        Connect an LLM provider with its API key, then choose which of its models
        Kavibay may use. A model switched off here disappears from every model
        picker in the app — the Widget Wizard included.
      </p>
    </header>
    </Teleport>

    <p v-if="loading" class="ai-note">Loading…</p>
    <p v-else-if="error" class="ai-error">{{ error }}</p>

    <section v-if="!loading" class="settings-section">
      <h3 class="settings-section-title">Providers</h3>

      <div
        v-for="tab in AI_PROVIDER_TABS"
        :key="tab.id"
        class="provider"
        :class="{ 'provider--open': openProvider === tab.id }"
      >
        <button
          type="button"
          class="provider-head"
          :aria-expanded="openProvider === tab.id"
          @click="toggleProvider(tab.id)"
        >
          <span class="provider-tile">
            <BrandMark :provider="credentialTypeForProvider(models, tab.id) ?? tab.id" :size="18" />
          </span>
          <span class="settings-row-copy provider-copy">
            <span class="settings-row-title">{{ tab.label }}</span>
            <span class="settings-row-hint">{{ providerStatusLine(models, tab.id) }}</span>
          </span>
          <span v-if="providerHasKey(models, tab.id)" class="provider-connected">Connected</span>
          <span v-else-if="openProvider !== tab.id" class="provider-setup">Set up</span>
          <svg class="provider-chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        <div v-if="openProvider === tab.id" class="provider-body">
          <div v-if="credentialTypeOf(tab.id)" :ref="setKeyEditor">
            <h4 class="provider-sub">Connection</h4>
            <CredentialAccounts
              :key="credentialTypeOf(tab.id)!.id"
              :type="credentialTypeOf(tab.id)!"
              :credentials="credentials"
              @changed="reload"
            />
          </div>

          <template v-if="providerHasKey(models, tab.id)">
            <h4 class="provider-sub">Models</h4>
            <p class="settings-section-hint">
              Switched-off models are hidden from every picker. Nothing is deleted.
            </p>
            <label
              v-for="model in modelsForProvider(models, tab.id)"
              :key="model.id"
              class="settings-row"
            >
              <span class="settings-row-copy" :class="{ 'ai-off': !model.enabled }">
                <span class="settings-row-title">{{ model.label }}</span>
                <span class="settings-row-hint">{{ model.note }}</span>
                <span class="ai-model-id">{{ model.id }}</span>
              </span>
              <span class="switch">
                <input
                  type="checkbox"
                  :aria-label="`Offer ${model.label}`"
                  :checked="model.enabled"
                  :disabled="toggling === model.id"
                  @change="onToggleModel(model.id, $event)"
                />
                <span class="switch-ui" />
              </span>
            </label>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ai {
  display: flex;
  flex-direction: column;
  gap: 28px;
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

.ai-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
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

/* One provider: a row that opens in place. Hairlines as between settings rows. */
.provider {
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.08);
}

.provider:last-child {
  border-bottom: 0;
}

.provider-head {
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% + 16px);
  margin: 0 -8px;
  padding: 12px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.provider-head:hover,
.provider-head:focus-visible {
  outline: none;
  background: rgba(var(--fg-rgb), 0.04);
}

.provider-tile {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: rgba(var(--fg-rgb), 0.07);
  color: rgba(var(--fg-rgb), 0.9);
}

.provider-copy {
  flex: 1;
}

.provider-connected {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.7);
}

.provider-connected::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4ade80;
}

.provider-setup {
  padding: 4px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.85);
}

.provider-chevron {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: rgba(var(--fg-rgb), 0.45);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 150ms ease;
}

.provider--open .provider-chevron {
  transform: rotate(180deg);
}

/* Indented to the text column, so it reads as belonging to the row above. */
.provider-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 18px 46px;
}

.provider-sub {
  margin: 12px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.92);
}

.ai-off {
  opacity: 0.5;
}

.ai-model-id {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switch input:disabled + .switch-ui {
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .provider-chevron {
    transition: none;
  }
}
</style>
