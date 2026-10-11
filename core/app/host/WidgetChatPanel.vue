<script setup lang="ts">
/**
 * The chat beside a card. Host UI: the widget never sees it, and nothing here
 * goes through the widget's bridge. First use asks for consent, because this
 * is where the widget's data leaves the machine.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import KavibaySelect from "@sdk/KavibaySelect.vue";
import ConnectionSelect from "../settings/credentials/ConnectionSelect.vue";
import { useSettingsModal } from "../settings/useSettingsModal";
import { AI_PROVIDER_TABS } from "../settings/ai/aiPanelLogic";
import { tauriWidgetCapabilityTransport } from "../extension-host/tauriWidgetCapabilityTransport";
import type { HostExtensionRef } from "../runtime/runtimeTypes";
import type { WidgetInstance } from "./types";
import {
  askWidget, chatDefinition, chatSources, resetWidgetChat, stopWidgetChat, widgetChat, type WidgetChat,
} from "./widgetChatSessions";

interface ModelOption {
  id: string;
  label: string;
  /** Who receives the data: the catalog provider, not the model's vendor. */
  provider: string;
  credentialType: string;
  configured: boolean;
  enabled: boolean;
  tools: boolean;
}

const props = defineProps<{ instance: WidgetInstance; def: HostExtensionRef }>();
const emit = defineEmits<{ grant: [model: string]; revoke: []; close: [] }>();

const definitionId = computed(() => chatDefinition(props.def));
const sources = computed(() => (definitionId.value ? chatSources(definitionId.value) : []));

const chat = ref<WidgetChat | null>(null);
watch(
  () => props.instance.chat?.model,
  (model) => { chat.value = model ? widgetChat(props.instance.instanceId, model) : null; },
  { immediate: true },
);

// --- consent ---
const models = ref<ModelOption[]>([]);
const picked = ref("");
const pickedModel = computed(() => models.value.find((model) => model.id === picked.value));
const currentModel = computed(() => models.value.find((model) => model.id === chat.value?.model));
const recipient = computed(() => {
  const provider = pickedModel.value?.provider;
  return AI_PROVIDER_TABS.find((tab) => tab.id === provider)?.label ?? provider;
});

async function loadModels() {
  const all = (await tauriWidgetCapabilityTransport.llmModels(props.instance.instanceId)) as ModelOption[];
  models.value = all.filter((model) => model.enabled && model.tools);
  if (!pickedModel.value) {
    picked.value = models.value.find((model) => model.configured)?.id ?? models.value[0]?.id ?? "";
  }
}

// --- chat ---
const draft = ref("");
const lastQuestion = ref("");
const input = ref<HTMLTextAreaElement | null>(null);
const messages = ref<HTMLOListElement | null>(null);
const followLatest = ref(true);

function onScroll() {
  const list = messages.value;
  if (list) followLatest.value = list.scrollHeight - list.scrollTop - list.clientHeight < 32;
}

// Follow streaming answers until the person scrolls back to read earlier messages.
watch(
  () => {
    const lines = chat.value?.lines;
    const last = lines?.[lines.length - 1];
    return [lines?.length, last?.text, last?.tools.length, chat.value?.busy];
  },
  async () => {
    if (!followLatest.value) return;
    await nextTick();
    if (messages.value) messages.value.scrollTop = messages.value.scrollHeight;
  },
);

watch(draft, async () => {
  await nextTick();
  if (!input.value) return;
  input.value.style.height = "auto";
  input.value.style.height = `${Math.min(input.value.scrollHeight, 120)}px`;
});

watch(() => Boolean(chat.value), async (allowed) => {
  if (allowed) { await nextTick(); input.value?.focus({ preventScroll: true }); }
});

function newConversation() {
  resetWidgetChat(props.instance.instanceId);
  followLatest.value = true;
  void nextTick(() => input.value?.focus({ preventScroll: true }));
}

function send(question = draft.value.trim()) {
  if (!question || !chat.value || chat.value.busy || !definitionId.value) return;
  draft.value = "";
  lastQuestion.value = question;
  followLatest.value = true;
  void askWidget(props.instance.instanceId, definitionId.value, question);
}

// Opens to the right; flips left when that would leave the screen.
const panel = ref<HTMLElement | null>(null);
const flip = ref(false);
onMounted(async () => {
  void loadModels();
  await nextTick();
  const rect = panel.value?.getBoundingClientRect();
  flip.value = Boolean(rect && rect.right > window.innerWidth);
  if (messages.value) messages.value.scrollTop = messages.value.scrollHeight;
  input.value?.focus({ preventScroll: true });
});
</script>

<template>
  <section
    ref="panel"
    class="chat-panel"
    :class="{ 'chat-panel--left': flip }"
    data-interactive
    aria-label="Chat about this widget's data"
    @pointerdown.stop
    @keydown.stop
    @keydown.esc.prevent="emit('close')"
  >
    <header class="chat-head">
      <div class="chat-heading">
        <span class="chat-title">Ask {{ def.title }}</span>
        <span class="chat-subtitle">{{ currentModel?.label ?? "Widget data" }}</span>
      </div>
      <button v-if="chat" class="chat-action" type="button" :disabled="chat.busy" aria-label="New conversation" v-tip="'New conversation'" @click="newConversation">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l1-5L18 2l4 4-7 7-5 1Z" /></svg>
      </button>
      <button class="chat-action" type="button" aria-label="Close chat" v-tip="'Close chat'" @click="emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <div v-if="!chat" class="chat-consent">
      <p>
        Kavibay sends this widget's data (<strong>{{ sources.join(", ") }}</strong>) to
        <template v-if="pickedModel"><strong>{{ recipient }}</strong> ({{ pickedModel.label }})</template>
        <template v-else>the provider of the model you pick</template>. The widget itself does not see the chat.
      </p>
      <template v-if="models.length > 0">
        <div class="chat-field">
          <span>Model</span>
          <KavibaySelect :model-value="picked" :options="models.map(model => ({ value: model.id, label: model.label }))" aria-label="Chat model" @update:model-value="picked = String($event)" />
        </div>
        <ConnectionSelect
          v-if="pickedModel"
          :owner="`widget:${instance.instanceId}`"
          :type-ids="[pickedModel.credentialType]"
          @changed="loadModels"
        />
        <button class="chat-button chat-button--primary" type="button" :disabled="!pickedModel?.configured" @click="emit('grant', picked)">Allow and start chat</button>
      </template>
      <button v-else class="chat-button" type="button" @click="useSettingsModal().showSection('ai')">
        Set up a model in Settings → AI
      </button>
    </div>

    <template v-else>
      <div v-if="chat.lines.length === 0" class="chat-empty">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11a8 8 0 0 1-8 8H7l-4 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z" /><path d="M7 9h10M7 13h7" /></svg>
        <p>What would you like to know?</p>
        <span>Ask a question about {{ def.title }}.<br />Answers use this widget's data.</span>
      </div>
      <ol v-else ref="messages" class="chat-lines" aria-label="Conversation" aria-live="polite" @scroll="onScroll">
        <li v-for="(line, index) in chat.lines" :key="index" :class="`chat-line chat-line--${line.role}`">
          <p v-if="line.text" class="chat-text">{{ line.text }}</p>
          <p v-if="chat.busy && index === chat.lines.length - 1 && !line.text" class="chat-status" role="status">
            <span class="chat-spinner" aria-hidden="true" />
            {{ line.tools.length ? "Reading widget data…" : "Thinking…" }}
          </p>
          <details v-if="line.tools.length" class="chat-sources">
            <summary>{{ line.tools.length }} data {{ line.tools.length === 1 ? "lookup" : "lookups" }}</summary>
            <code v-for="(tool, toolIndex) in line.tools" :key="toolIndex">{{ tool }}</code>
          </details>
        </li>
      </ol>
      <div v-if="chat.error" class="chat-error" role="alert">
        <p>{{ chat.error }}</p>
        <div class="chat-error-actions">
          <button class="chat-button" type="button" :disabled="chat.busy" @click="send(lastQuestion)">Try again</button>
          <button class="chat-button" type="button" @click="emit('revoke')">Choose another model</button>
        </div>
      </div>
      <form class="chat-composer" @submit.prevent="send()">
        <div class="chat-input">
          <textarea
            ref="input"
            v-model="draft"
            rows="2"
            placeholder="Ask about this data"
            aria-label="Question"
            @keydown.enter.exact="if (!$event.isComposing) { $event.preventDefault(); send(); }"
          />
          <button v-if="chat.busy" class="chat-send chat-send--stop" type="button" aria-label="Stop answer" v-tip="'Stop answer'" @click="stopWidgetChat(instance.instanceId)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
          <button v-else class="chat-send" type="submit" :disabled="!draft.trim()" aria-label="Send question" v-tip="'Send question'">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
          </button>
        </div>
        <span class="chat-hint">Enter to send · Shift+Enter for a new line</span>
      </form>
    </template>
  </section>
</template>

<style scoped>
.chat-panel {
  position: absolute;
  top: 0;
  left: calc(100% + 12px);
  z-index: 5;
  display: flex;
  flex-direction: column;
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: min(560px, calc(100vh - 32px));
  padding: 0;
  border-radius: var(--surface-radius, 16px);
  background: rgba(var(--surface-bg-rgb), var(--surface-alpha, 0.72));
  border: 1px solid var(--border);
  box-shadow: var(--surface-box-shadow);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  color: rgb(var(--fg-rgb));
  font-size: 13px;
  pointer-events: auto;
  line-height: 1.55;
}
.chat-panel--left {
  left: auto;
  right: calc(100% + 12px);
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.chat-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.chat-title {
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-subtitle, .chat-hint {
  font-size: 11px;
  color: var(--text-muted);
}
.chat-action, .chat-button, .chat-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 0;
  border-radius: 9px;
  font: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.chat-action {
  width: 30px;
  height: 30px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
}
.chat-action:hover, .chat-button:hover {
  background: var(--fill-hover);
  color: var(--text);
}
button:focus-visible, summary:focus-visible {
  outline: 2px solid var(--border-strong);
  outline-offset: 2px;
}
button:disabled {
  opacity: 0.35;
  cursor: default;
}
svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.chat-lines {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 18px 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.chat-line {
  flex-shrink: 0;
  min-width: 0;
}
.chat-line--user {
  align-self: flex-end;
  max-width: 90%;
}
.chat-line--user .chat-text {
  padding: 9px 12px;
  border-radius: 13px 13px 4px 13px;
  background: var(--fill);
  font-weight: 500;
}
.chat-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text);
}
.chat-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}
.chat-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--border-strong);
  border-top-color: currentColor;
  border-radius: 50%;
  corner-shape: round;
  animation: chat-spin 0.8s linear infinite;
}
@keyframes chat-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .chat-spinner { animation: none; }
}
.chat-sources {
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 11px;
}
.chat-sources summary {
  width: fit-content;
  cursor: pointer;
}
.chat-sources code {
  display: block;
  padding: 6px 8px;
  margin-top: 4px;
  background: var(--fill);
  border-radius: 6px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 10px;
}
.chat-empty {
  padding: 36px 24px;
  text-align: center;
}
.chat-empty svg {
  width: 28px;
  height: 28px;
  color: var(--text-faint);
  stroke-width: 1.4;
}
.chat-empty p {
  margin: 12px 0 4px;
  font-weight: 500;
}
.chat-empty span {
  font-size: 12px;
  color: var(--text-muted);
}
.chat-error {
  margin: 0 16px 12px;
  padding: 12px;
  min-height: 0;
  max-height: 160px;
  overflow-y: auto;
  flex-shrink: 0;
  border-radius: 10px;
  background: rgba(var(--danger-rgb, 220, 38, 38), 0.08);
  color: rgb(var(--danger-rgb, 220, 38, 38));
  font-size: 12px;
  overflow-wrap: anywhere;
}
.chat-error p { margin: 0 0 10px; }
.chat-error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chat-button {
  padding: 7px 10px;
  color: var(--text);
  background: var(--fill);
  font-size: 12px;
}
.chat-button--primary {
  background: rgb(var(--fg-rgb));
  color: rgb(var(--surface-bg-rgb));
}
.chat-button--primary:hover {
  background: rgba(var(--fg-rgb), 0.85);
  color: rgb(var(--surface-bg-rgb));
}
.chat-composer {
  padding: 12px 16px 14px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.chat-input {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 8px;
  background: var(--fill);
  border: 1px solid transparent;
  border-radius: 12px;
}
.chat-input:focus-within { border-color: var(--border-strong); }
.chat-hint {
  display: block;
  margin-top: 6px;
  font-size: 10px;
}
.chat-input textarea {
  flex: 1;
  min-width: 0;
  padding: 2px 4px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  line-height: 1.5;
  resize: none;
  max-height: 120px;
}
.chat-input textarea::placeholder { color: var(--text-muted); }
.chat-send {
  width: 30px;
  height: 30px;
  padding: 0;
  background: rgb(var(--fg-rgb));
  color: rgb(var(--surface-bg-rgb));
}
.chat-send:hover { background: rgba(var(--fg-rgb), 0.85); }
.chat-send:disabled { background: var(--fill-hover); color: var(--text-muted); opacity: 0.6; }
.chat-send--stop svg { fill: currentColor; stroke: none; }
.chat-consent {
  padding: 16px;
  overflow-y: auto;
  min-height: 0;
  color: var(--text-muted);
}
.chat-consent p { margin: 0 0 16px; }
.chat-consent strong { color: var(--text); font-weight: 500; }
.chat-consent .chat-button { margin-top: 14px; }
.chat-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 12px;
}
</style>
