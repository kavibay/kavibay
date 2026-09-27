<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { PaletteAnswer, PaletteMessage } from "./usePaletteAnswer";

const props = defineProps<{ answer: PaletteAnswer; messages: PaletteMessage[]; busy: boolean }>();
const emit = defineEmits<{ back: []; stop: []; retry: []; settings: []; followUp: [text: string] }>();
const draft = ref("");
const inputEl = ref<HTMLTextAreaElement | null>(null);
const bodyEl = ref<HTMLElement | null>(null);
const canSend = computed(() => draft.value.trim().length > 0 && !props.busy && !props.answer.needsSetup);
let followLatest = true;

function focusComposer() {
  inputEl.value?.focus();
}
function send() {
  if (!canSend.value) return;
  emit("followUp", draft.value.trim());
  draft.value = "";
  focusComposer();
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  send();
}
function onScroll() {
  const el = bodyEl.value;
  if (el) followLatest = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}
watch([() => props.answer.text, () => props.messages.length], async ([, count], [, previousCount]) => {
  // New questions jump to the latest turn; streamed chunks respect scrolling up.
  if (count !== previousCount) followLatest = true;
  if (!followLatest) return;
  await nextTick();
  const el = bodyEl.value;
  if (el) el.scrollTop = el.scrollHeight;
});
defineExpose({ focusComposer });
</script>

<template>
  <section class="palette-answer" aria-label="AI answer" :aria-busy="busy" @keydown.esc.stop.prevent="$emit('back')">
    <header class="palette-answer-header">
      <button type="button" aria-label="Back to search" @click="$emit('back')">←</button>
      <span>{{ answer.modelLabel || 'AI answer' }}</span>
      <button v-if="busy" type="button" class="palette-answer-stop" @click="$emit('stop')">Stop</button>
    </header>
    <div ref="bodyEl" class="palette-answer-body" @scroll="onScroll">
      <!-- The first question already appears in the search field above. -->
      <p
        v-for="(message, index) in messages.slice(1)"
        :key="index"
        class="palette-answer-text"
        :class="{ 'palette-answer-question': message.role === 'user' }"
        :aria-label="message.role === 'user' ? 'You' : 'AI answer'"
      >{{ message.content }}</p>
      <p v-if="answer.text" class="palette-answer-text">{{ answer.text }}</p>
      <p v-if="busy" class="palette-answer-status" role="status">{{ answer.text ? 'Answering…' : 'Thinking…' }}</p>
      <p v-else-if="answer.phase === 'stopped'" class="palette-answer-status" role="status">Stopped</p>
      <template v-if="answer.phase === 'error'">
        <p role="alert">{{ answer.error }}</p>
        <button v-if="answer.needsSetup" type="button" @click="$emit('settings')">Open AI settings</button>
        <button v-else type="button" @click="$emit('retry')">Try again</button>
      </template>
    </div>
    <form class="palette-answer-composer" @submit.prevent="send">
      <textarea
        ref="inputEl"
        v-model="draft"
        aria-label="Follow-up message"
        placeholder="Ask a follow-up…"
        rows="2"
        @keydown="onKeydown"
      />
      <div class="palette-answer-composer-footer">
        <span>Enter to send · Shift+Enter for a new line</span>
        <button type="submit" class="palette-answer-send" aria-label="Send message" :disabled="!canSend">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.palette-answer {
  display: flex;
  flex-direction: column;
  overflow: auto;
  color: rgba(var(--fg-rgb), 0.9);
}
.palette-answer-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.6);
  font-size: 12px;
}
.palette-answer-stop { margin-left: auto; }
.palette-answer-body {
  flex: 1;
  min-height: 64px;
  overflow: auto;
  padding: 8px 20px 20px;
  user-select: text;
  font-size: 14px;
  line-height: 1.6;
}
.palette-answer-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.palette-answer-question {
  width: fit-content;
  max-width: 85%;
  margin-left: auto;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.07);
}
.palette-answer-status { color: rgba(var(--fg-rgb), 0.5); }
.palette-answer-composer {
  flex-shrink: 0;
  margin: 0 14px 14px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.035);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
}
.palette-answer-composer:focus-within { border-color: rgba(var(--fg-rgb), 0.35); }
.palette-answer-composer textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 0;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
}
.palette-answer-composer textarea::placeholder { color: rgba(var(--fg-rgb), 0.4); }
.palette-answer-composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
  color: rgba(var(--fg-rgb), 0.4);
  font-size: 11px;
}
button {
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.07);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
button:hover { background: rgba(var(--fg-rgb), 0.13); }
button:focus-visible { outline: 1px solid currentColor; outline-offset: 2px; }
.palette-answer-send {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  color: rgba(var(--fg-rgb), 0.9);
}
.palette-answer-send:disabled { opacity: 0.35; cursor: default; }
</style>
