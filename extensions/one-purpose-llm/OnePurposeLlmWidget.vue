<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches, type WidgetSurface } from "@sdk";
import {
  scheduleRegionSync,
  syncInteractiveRegions,
} from "../../core/app/system/clickThrough";
import {
  buildApiMessages,
  findPurpose,
  isPromptDefault,
  providerLabel,
  resolveSystemPrompt,
  type CustomPurposeTemplate,
} from "./onePurposeLlmLogic";
import type { OnePurposeLlmModel } from "./widgets/onePurposeLlm";
import {
  hasUnknownPlaceholder,
  markSelection,
  restoreText,
  staleTerms,
  unmarkTerm,
} from "./anonymizeLogic";
import OnePurposeLlmAnonymizePopover from "./OnePurposeLlmAnonymizePopover.vue";
import OnePurposeLlmModelPicker from "./OnePurposeLlmModelPicker.vue";
import OnePurposeLlmPurposePicker from "./OnePurposeLlmPurposePicker.vue";
import { consumeOnePurposeLlmInputFocus } from "./widgets/onePurposeLlm";

const props = defineProps<{ model: OnePurposeLlmModel }>();
const model = props.model;
const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");
const boundInstanceId: string = instanceId;
const widgetSurface = inject<WidgetSurface>("widgetSurface", "desk");
const {
  settings,
  update,
  setPrompt,
  resetPrompt,
  setPurpose,
  customTemplates,
  createTemplate,
  hiddenTemplateIds,
  deleteTemplate,
  models,
} = model;

const rootStyle = { width: "100%", height: "100%" };

const purpose = computed(() =>
  findPurpose(settings.value.purposeId, customTemplates.value, hiddenTemplateIds.value),
);
const prompt = computed(() =>
  resolveSystemPrompt(settings.value, customTemplates.value, hiddenTemplateIds.value),
);
const promptEdited = computed(() =>
  !isPromptDefault(settings.value, customTemplates.value, hiddenTemplateIds.value),
);

/** The host's shared catalog — the same list the Widget Wizard reads. */
const selectedModel = computed(() =>
  models.value.find((model) => model.id === settings.value.model),
);
/** Unknown until the catalog has been read, so the banner does not flash. */
const configured = computed(() => selectedModel.value?.configured ?? true);
const providerName = computed(() =>
  selectedModel.value ? providerLabel(selectedModel.value.provider) : "a provider",
);

const streaming = ref(false);
/** Live token buffer; persisted to settings once the run ends. */
const streamed = ref("");
const activeRequestId = ref<string | null>(null);
const copied = ref(false);
const promptCollapsed = computed(() => settings.value.promptCollapsed);
const outputEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
const rootEl = ref<HTMLElement | null>(null);
const expandedWidth = ref<number | null>(null);
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

function focusInput() {
  void nextTick(() => {
    const input = inputEl.value;
    if (!input || input.disabled) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  });
}

function onKavibayFocusWidget(event: Event) {
  // Surface check keeps the desk card from stealing the caret from the inline view.
  if (!widgetFocusRequestMatches(event, boundInstanceId, widgetSurface)) return;
  focusInput();
}

/**
 * The text on screen: live tokens while running, the stored result otherwise —
 * with placeholders mapped back to the values they stood in for.
 */
const output = computed(() =>
  restoreText(
    streaming.value ? streamed.value : settings.value.output,
    settings.value.anonymized,
  ),
);

/**
 * The model returned a placeholder we never issued. It invented or mangled
 * one, so the answer holds a gap the user has to fill — worth saying, since
 * the alternative is `[ANONYMIZED_7]` appearing in a pasted email.
 */
const strayPlaceholder = computed(
  () =>
    settings.value.anonymized.length > 0 &&
    !streaming.value &&
    hasUnknownPlaceholder(output.value, settings.value.anonymized),
);
/** Show waiting UI until the first token arrives. */
const waiting = computed(() => streaming.value && streamed.value.length === 0);
const canRun = computed(
  () => settings.value.input.trim().length > 0 && !streaming.value && Boolean(settings.value.model),
);

/**
 * Read the catalog and keep the selection usable.
 *
 * Re-read before every run rather than listening for a settings change: adding
 * a key is rare, a stale "needs a key" banner right after adding one is
 * annoying, and this is a local SQLite read.
 */
async function loadModels() {
  try {
    await model.loadModels();
  } catch {
    /* keep whatever the picker already shows */
  }
}

/** Keep the newest streamed text visible. */
async function scrollOutputToBottom() {
  await nextTick();
  const el = outputEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(output, () => void scrollOutputToBottom());

/** Run the active purpose over the input text. */
async function run() {
  const text = settings.value.input.trim();
  if (!text || streaming.value) return;

  await loadModels();
  if (!configured.value || !settings.value.model) {
    return;
  }

  const requestId = crypto.randomUUID();
  const apiMessages = buildApiMessages(
    settings.value,
    text,
    customTemplates.value,
    hiddenTemplateIds.value,
  );
  activeRequestId.value = requestId;
  streamed.value = "";
  update({ output: "" });
  streaming.value = true;

  try {
    // Returns once the host has accepted the request. Tokens arrive through
    // the reviewed capability; the widget never names a Tauri command.
    await model.stream(
      { requestId, model: settings.value.model, messages: apiMessages },
      (event) => {
        if (activeRequestId.value !== requestId) return;
        if (event.type === "chunk") appendOutput(event.text);
        else if (event.type === "error") {
          failRun(event.message);
          endStream(requestId);
        } else if (event.type === "done" || event.type === "cancelled") {
          endStream(requestId);
        }
      },
    );
  } catch (error) {
    if (activeRequestId.value === requestId) {
      failRun(String(error));
      endStream(requestId);
    }
  }
}

/** Stop the in-flight stream; keep any text already received. */
async function cancel() {
  const requestId = activeRequestId.value;
  if (!requestId || !streaming.value) return;
  try {
    await model.cancel(requestId);
  } catch {
    // Still end the local run if the cancel command fails.
  }
  endStream(requestId);
}

function appendOutput(text: string) {
  streamed.value += text;
}

function failRun(message: string) {
  streamed.value = streamed.value
    ? `${streamed.value}\n\nError: ${message}`
    : `Error: ${message}`;
}

/** Shared cleanup when a run finishes, errors, or is cancelled. */
function endStream(requestId: string) {
  if (activeRequestId.value !== requestId) return;
  // One write per run instead of one per token. Stored with the values back in
  // place, so the result survives unmarking a term later.
  update({ output: restoreText(streamed.value, settings.value.anonymized) });
  streaming.value = false;
  activeRequestId.value = null;
  void nextTick().then(() => inputEl.value?.focus());
}

/** Ctrl/Cmd+Enter runs; plain Enter stays a newline (input can be multi-line). */
function onInputKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void run();
  }
}

function onInput(event: Event) {
  const input = (event.target as HTMLTextAreaElement).value;
  // A mark whose value the user has since deleted describes nothing; keeping
  // it would redact a value that is no longer in the text.
  const stale = staleTerms(input, settings.value.anonymized);
  update({
    input,
    ...(stale.length
      ? {
          anonymized: settings.value.anonymized.filter(
            (term) => !stale.some((gone) => gone.id === term.id),
          ),
        }
      : {}),
  });
  dismissAnonymize();
}

/* Anonymize -------------------------------------------------------------- */

const anonymize = ref<{ x: number; y: number; start: number; end: number } | null>(null);

const anonymizeSelection = computed(() =>
  anonymize.value
    ? settings.value.input.slice(anonymize.value.start, anonymize.value.end).trim()
    : "",
);

/** How often the selected value appears — decides whether "All" is offered. */
const anonymizeOccurrences = computed(() => {
  const term = anonymizeSelection.value;
  if (!term) return 0;
  return settings.value.input.split(term).length - 1;
});

function dismissAnonymize() {
  anonymize.value = null;
}

/** Offer the popover when a mouse-up leaves a selection behind. */
function onInputSelect(event: MouseEvent) {
  const field = event.currentTarget as HTMLTextAreaElement;
  const { selectionStart, selectionEnd } = field;
  if (streaming.value || selectionStart == null || selectionStart === selectionEnd) {
    dismissAnonymize();
    return;
  }
  if (!field.value.slice(selectionStart, selectionEnd).trim()) {
    dismissAnonymize();
    return;
  }
  anonymize.value = {
    x: event.clientX,
    y: event.clientY,
    start: selectionStart,
    end: selectionEnd,
  };
}

function applyAnonymize(all: boolean) {
  const pending = anonymize.value;
  if (!pending) return;
  update({
    anonymized: markSelection(
      settings.value.input,
      pending.start,
      pending.end,
      all,
      settings.value.anonymized,
    ),
  });
  dismissAnonymize();
}

function removeAnonymized(id: number) {
  update({ anonymized: unmarkTerm(settings.value.anonymized, id) });
}

function onPromptInput(event: Event) {
  setPrompt((event.target as HTMLTextAreaElement).value);
}

function onCreateTemplate(template: CustomPurposeTemplate) {
  createTemplate(template);
}

function onDeleteTemplate(templateId: string) {
  deleteTemplate(templateId);
}

/** Resize the host card so a collapsed prompt removes, rather than empties, its column. */
function requestCardWidth(width: number) {
  window.dispatchEvent(
    new CustomEvent("kavibay:resize-widget", {
      detail: { instanceId: boundInstanceId, width, anchor: "left" },
    }),
  );
}

function collapsePrompt() {
  const card = rootEl.value?.closest<HTMLElement>(".widget-card");
  const width = card?.getBoundingClientRect().width;
  if (width && width > 0) {
    expandedWidth.value = width;
    // Matches the left grid column while keeping the input comfortably usable.
    requestCardWidth(Math.max(340, Math.round(width * 0.56)));
  }
  update({ promptCollapsed: true });
}

function expandPrompt() {
  update({ promptCollapsed: false });
  if (expandedWidth.value) requestCardWidth(expandedWidth.value);
}

async function copyOutput() {
  const text = output.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    if (copyResetTimer != null) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copied.value = false;
      copyResetTimer = null;
    }, 1200);
  } catch {
    /* clipboard may fail without permission */
  }
}

watch(
  () => [settings.value.width, settings.value.height, promptCollapsed.value] as const,
  async () => {
    await nextTick();
    scheduleRegionSync();
  },
);

onMounted(async () => {
  void nextTick().then(() => syncInteractiveRegions());
  window.addEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
  if (consumeOnePurposeLlmInputFocus(boundInstanceId)) focusInput();
  await loadModels();
});

onUnmounted(() => {
  window.removeEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
  if (copyResetTimer != null) clearTimeout(copyResetTimer);
});
</script>

<template>
  <!-- Host WidgetCard owns move / pin / ⋯ chrome; Reset lives in the ⋯ menu. -->
  <div
    ref="rootEl"
    class="opl"
    :class="{ 'opl--prompt-collapsed': promptCollapsed }"
    :style="rootStyle"
    data-interactive
    @pointerdown.stop
  >
    <div v-if="!configured" class="opl-banner">
      <span>{{ providerName }} needs an API key. Add it in Settings → AI.</span>
    </div>

    <div class="opl-purpose">
      <OnePurposeLlmPurposePicker
        :purpose-id="settings.purposeId"
        :custom-templates="customTemplates"
        :hidden-template-ids="hiddenTemplateIds"
        :disabled="streaming"
        @update:purpose-id="setPurpose"
        @create-template="onCreateTemplate"
        @delete-template="onDeleteTemplate"
      />
      <span class="opl-purpose-hint">{{ purpose.hint }}</span>
    </div>

    <section v-if="!promptCollapsed" class="opl-section opl-section--prompt">
        <p class="opl-label">
          <span>System prompt</span>
          <span class="opl-label-actions">
            <button v-if="promptEdited" type="button" class="opl-link" @click="resetPrompt">
              Reset
            </button>
            <button
              type="button"
              class="opl-prompt-toggle"
              aria-label="Hide system prompt"
              v-tip="'Hide system prompt'"
              @click="collapsePrompt"
            >
              <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M8 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </span>
        </p>
        <div class="opl-field opl-field--prompt">
          <textarea
            class="opl-textarea opl-textarea--prompt"
            spellcheck="false"
            aria-label="System prompt"
            :value="prompt"
            :disabled="streaming"
            @wheel.stop
            @input="onPromptInput"
          />
        </div>
    </section>

    <section class="opl-section opl-section--input">
      <p class="opl-label">
        <span>Prompt</span>
        <button
          v-if="promptCollapsed"
          type="button"
          class="opl-prompt-show"
          aria-label="Show system prompt"
          @click="expandPrompt"
        >
          <span>System prompt</span>
          <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </p>
      <div class="opl-field">
        <textarea
          ref="inputEl"
          class="opl-textarea"
          rows="2"
          :placeholder="purpose.inputPlaceholder"
          :value="settings.input"
          :disabled="streaming"
          @input="onInput"
          @keydown="onInputKeydown"
          @mouseup="onInputSelect"
          @blur="dismissAnonymize"
        />

        <!-- What will be redacted, and the only way to take a mark back. A
             mark you cannot see is a mark you cannot trust. -->
        <ul v-if="settings.anonymized.length" class="opl-marks" aria-label="Anonymized values">
          <li v-for="mark in settings.anonymized" :key="mark.id" class="opl-mark">
            <span class="opl-mark-term" :title="mark.term">{{ mark.term }}</span>
            <span v-if="mark.all" class="opl-mark-scope" v-tip="'Every occurrence'">all</span>
            <button
              type="button"
              class="opl-mark-remove"
              :aria-label="`Stop anonymizing ${mark.term}`"
              v-tip="'Remove'"
              @click="removeAnonymized(mark.id)"
            >
              ×
            </button>
          </li>
        </ul>

        <div class="opl-field-footer">
          <OnePurposeLlmModelPicker
            :models="models"
            :model="settings.model"
            :disabled="streaming"
            @update:model="(id: string) => update({ model: id })"
          />
          <button
            v-if="streaming"
            type="button"
            class="opl-run opl-run--stop"
            aria-label="Stop"
            v-tip="'Stop'"
            @click="cancel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
          <button
            v-else
            type="button"
            class="opl-run"
            aria-label="Run"
            v-tip="'Run (Ctrl+Enter)'"
            :disabled="!canRun"
            @click="run"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </section>

    <section class="opl-section opl-section--result">
      <p class="opl-label">
        <span>Result</span>
        <button
          v-if="output && !streaming"
          type="button"
          class="opl-copy"
          :aria-label="copied ? 'Copied' : 'Copy result'"
          v-tip="copied ? 'Copied' : 'Copy result'"
          @click="copyOutput"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </p>
      <div ref="outputEl" class="opl-result" @wheel.stop>
        <div
          v-if="waiting"
          class="opl-thinking"
          aria-live="polite"
          aria-label="Waiting for the result"
        >
          <span>Working</span>
          <span class="opl-thinking-dots" aria-hidden="true"><span /><span /><span /></span>
        </div>
        <p v-else-if="output" class="opl-result-text">{{ output }}</p>
        <p v-else class="opl-empty">Nothing yet.</p>
      </div>
      <p v-if="strayPlaceholder" class="opl-warn">
        The answer contains a placeholder that was never sent — check it before using it.
      </p>
    </section>

    <OnePurposeLlmAnonymizePopover
      v-if="anonymize && anonymizeSelection"
      :x="anonymize.x"
      :y="anonymize.y"
      :selection="anonymizeSelection"
      :occurrences="anonymizeOccurrences"
      @anonymize="applyAnonymize"
      @dismiss="dismissAnonymize"
    />
  </div>
</template>

<style scoped>
/**
 * Two kinds of text live here, and telling them apart should not require
 * reading them: the fields you type into are sunken and outlined, the answer is
 * a raised panel with a marker down its edge. Colours come from the theme
 * tokens so both stay right in light mode.
 */
.opl {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(220px, 0.9fr);
  grid-template-rows: auto auto minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px 12px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  /* Room for host pin / ⋯ when the title row is hidden. */
  padding-top: 4px;
  color: var(--text);
}

.opl-banner {
  grid-column: 1 / -1;
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 7px 8px;
  border-radius: 7px;
  background: var(--fill);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
}

.opl-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.opl-link:hover {
  color: var(--text);
}

/* Purpose --------------------------------------------------------------- */

.opl-purpose {
  grid-column: 1 / -1;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.opl-purpose-hint {
  min-width: 0;
  flex: 1;
  font-size: 11px;
  line-height: 1.3;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Section headings ------------------------------------------------------ */

.opl-section {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}

/* The answer takes whatever room the fields above it leave. */
.opl-section--result {
  grid-column: 1;
  grid-row: 4;
  min-height: 0;
}

.opl-section--input {
  grid-column: 1;
  grid-row: 3;
}

.opl-section--input .opl-field {
  flex: 1;
  min-height: 0;
}

.opl-section--input .opl-textarea {
  flex: 1;
  min-height: 0;
  max-height: none;
}

/* Keep the editable instructions visible beside both input and answer. */
.opl-section--prompt {
  grid-column: 2;
  grid-row: 3 / 5;
  min-width: 0;
  min-height: 0;
}

.opl-section--prompt .opl-field {
  flex: 1;
  min-height: 0;
}

/* The card itself shrinks to this one-column layout while the prompt is hidden. */
.opl--prompt-collapsed {
  grid-template-columns: minmax(0, 1fr);
}

.opl--prompt-collapsed .opl-section--input,
.opl--prompt-collapsed .opl-section--result {
  grid-column: 1 / -1;
}

.opl-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 20px;
  margin: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.opl-label .opl-link {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: none;
}

.opl-copy {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
}

.opl-copy:hover {
  background: rgba(var(--fg-rgb), 0.1);
  color: var(--text);
}

.opl-label-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.opl-prompt-show {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-faint);
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
}

.opl-prompt-show:hover {
  color: var(--text);
}

.opl-prompt-toggle {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
}

.opl-prompt-toggle:hover {
  background: rgba(var(--fg-rgb), 0.1);
  color: var(--text);
}

/* Editable: sunken and outlined ----------------------------------------- */

.opl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  box-sizing: border-box;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  /* Recessed against the card — a hole you type into. */
  background: var(--inset-bg);
}

.opl-field:focus-within {
  border-color: rgba(var(--fg-rgb), 0.45);
}

.opl-field-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.opl-textarea {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  max-height: 140px;
  padding: 0;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  scrollbar-width: none;
}

.opl-textarea::-webkit-scrollbar {
  width: 0;
}

.opl-textarea::placeholder {
  color: var(--text-faint);
}

.opl-textarea:disabled {
  opacity: 0.6;
}

/* The instructions are supporting text until you go to change them. */
.opl-textarea--prompt {
  flex: 1;
  min-height: 0;
  max-height: none;
  resize: none;
  color: var(--text-muted);
}

.opl-field:focus-within .opl-textarea--prompt {
  color: var(--text);
}

/* Anonymized values ------------------------------------------------------ */

.opl-marks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.opl-mark {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 3px 2px 7px;
  border-radius: 999px;
  /* Same green as the Alarm menu's check: this value is handled. */
  border: 1px solid rgba(95, 173, 140, 0.45);
  background: rgba(95, 173, 140, 0.14);
  font-size: 10px;
  line-height: 1.4;
}

.opl-mark-term {
  min-width: 0;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.opl-mark-scope {
  flex-shrink: 0;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.opl-mark-remove {
  flex-shrink: 0;
  display: grid;
  width: 14px;
  height: 14px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-faint);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.opl-mark-remove:hover {
  background: rgba(var(--fg-rgb), 0.14);
  color: var(--text);
}

.opl-warn {
  margin: 4px 0 0;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(220, 160, 90, 0.95);
}

/* Generated: raised, marked down the edge -------------------------------- */

.opl-result {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 44px;
  padding: 8px 10px;
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* Sits on the card rather than in it, and carries a marker no editable
     field has: the answer is not something you type into. */
  border-left: 2px solid rgba(var(--fg-rgb), 0.5);
  border-radius: 3px 10px 10px 3px;
  background: var(--fill-hover);
  scrollbar-width: none;
}
.opl-result::-webkit-scrollbar {
  width: 0;
}
.opl-result:hover {
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
.opl-result:hover::-webkit-scrollbar {
  width: 8px;
}
.opl-result:hover::-webkit-scrollbar-thumb {
  background: var(--scrollbar);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.opl-result-text {
  margin: 0;
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  /* The point of the widget is to take this away with you. */
  user-select: text;
  cursor: text;
}

.opl-empty {
  margin: auto 0;
  color: var(--text-faint);
  font-size: 12px;
}

.opl-thinking {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.opl-thinking-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.opl-thinking-dots span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  animation: opl-dot 1.1s ease-in-out infinite;
}

.opl-thinking-dots span:nth-child(2) {
  animation-delay: 0.15s;
}

.opl-thinking-dots span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes opl-dot {
  0%,
  80%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

/* Run -------------------------------------------------------------------- */

.opl-run {
  display: grid;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: var(--fill-hover);
  color: var(--text);
  cursor: pointer;
}

.opl-run:disabled {
  cursor: default;
  opacity: 0.4;
}

.opl-run:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.24);
}

.opl-run--stop {
  color: rgba(220, 90, 90, 0.95);
}

.opl-run--stop:hover {
  background: rgba(220, 90, 90, 0.28);
}
</style>
