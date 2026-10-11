<script setup lang="ts">
/**
 * The chat beside a card. Host UI: the widget never sees it, and nothing here
 * goes through the widget's bridge. First use asks for consent, because this
 * is where the widget's data leaves the machine.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import ConnectionSelect from "../settings/credentials/ConnectionSelect.vue";
import { useSettingsModal } from "../settings/useSettingsModal";
import { tauriWidgetCapabilityTransport } from "../extension-host/tauriWidgetCapabilityTransport";
import type { HostExtensionRef } from "../runtime/runtimeTypes";
import type { WidgetInstance } from "./types";
import {
  askWidget, chatDefinition, chatSources, resetWidgetChat, stopWidgetChat, widgetChat, type WidgetChat,
} from "./widgetChatSessions";

interface ModelOption {
  id: string;
  label: string;
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
function send(question = draft.value.trim()) {
  if (!question || !chat.value || chat.value.busy || !definitionId.value) return;
  draft.value = "";
  lastQuestion.value = question;
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
  >
    <header class="chat-head">
      <span class="chat-title">Ask {{ def.title }}</span>
      <button v-if="chat" type="button" :disabled="chat.busy" @click="resetWidgetChat(instance.instanceId)">
        New conversation
      </button>
      <button type="button" aria-label="Close chat" @click="emit('close')">×</button>
    </header>

    <div v-if="!chat" class="chat-consent">
      <p>
        Kavibay sends this widget's data (<strong>{{ sources.join(", ") }}</strong>) to
        <strong>{{ pickedModel?.label ?? "the model you pick" }}</strong>. The widget itself does not see the chat.
      </p>
      <template v-if="models.length > 0">
        <label class="chat-field">
          Model
          <select v-model="picked">
            <option v-for="model in models" :key="model.id" :value="model.id">{{ model.label }}</option>
          </select>
        </label>
        <ConnectionSelect
          v-if="pickedModel"
          :owner="`widget:${instance.instanceId}`"
          :type-ids="[pickedModel.credentialType]"
          @changed="loadModels"
        />
        <button type="button" :disabled="!pickedModel?.configured" @click="emit('grant', picked)">Allow</button>
      </template>
      <button v-else type="button" @click="useSettingsModal().showSection('ai')">
        Set up a model in Settings → AI
      </button>
    </div>

    <template v-else>
      <ol class="chat-lines" aria-live="polite">
        <li v-for="(line, index) in chat.lines" :key="index" :class="`chat-line chat-line--${line.role}`">
          <p v-for="tool in line.tools" :key="tool" class="chat-tool">loading {{ tool }} …</p>
          <p class="chat-text">{{ line.text }}</p>
        </li>
      </ol>
      <p v-if="chat.error" class="chat-error" role="alert">
        {{ chat.error }}
        <button type="button" @click="send(lastQuestion)">Try again</button>
        <button type="button" @click="emit('revoke')">Choose another model</button>
      </p>
      <form class="chat-input" @submit.prevent="send()">
        <textarea
          v-model="draft"
          rows="2"
          placeholder="Ask about this data"
          aria-label="Question"
          @keydown.enter.exact.prevent="send()"
        />
        <button v-if="chat.busy" type="button" @click="stopWidgetChat(instance.instanceId)">Stop</button>
        <button v-else type="submit" :disabled="!draft.trim()">Send</button>
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
  gap: 8px;
  width: 340px;
  max-height: 480px;
  padding: 12px;
  border-radius: var(--surface-radius, 16px);
  background: rgba(var(--surface-bg-rgb), var(--surface-alpha, 0.72));
  border: 1px solid var(--surface-border, var(--border));
  box-shadow: var(--surface-box-shadow);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  color: rgb(var(--fg-rgb));
  font-size: 13px;
  pointer-events: auto;
}
.chat-panel--left {
  left: auto;
  right: calc(100% + 12px);
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chat-title {
  flex: 1;
  font-weight: 600;
}
.chat-lines {
  flex: 1;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.chat-line--user .chat-text {
  font-weight: 600;
}
.chat-text {
  margin: 0 0 8px;
  white-space: pre-wrap;
}
.chat-tool {
  margin: 0 0 4px;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.6);
}
.chat-error {
  margin: 0;
  color: rgb(var(--danger-rgb, 220, 38, 38));
}
.chat-input {
  display: flex;
  gap: 6px;
}
.chat-input textarea {
  flex: 1;
  resize: none;
}
</style>
