<script setup lang="ts">
/**
 * The Ctrl+Alt+Q menu: pick what to do with the text selected in whatever
 * application the user was just typing in.
 *
 * Rust captured the selection before this window appeared, and Rust pastes the
 * answer back afterwards (`src-tauri/src/quick_action`). Everything in between
 * happens here: pick a row, run the owning extension's handler, hand the
 * result over.
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import FloatingTipHost from "../system/FloatingTipHost.vue";
import {
  listTextActions,
  runTextAction,
  type ResolvedTextAction,
} from "../extensions/textActions";
import {
  appendStreamChunk,
  errorMessage,
  finishStream,
  isBusy,
  MENU_PHASE,
  moveSelection,
  outputText,
  previewText,
  runningActionId,
  type QuickActionPhase,
} from "./quickActionLogic";

const actions = ref<ResolvedTextAction[]>([]);
const disabledTemplates = ref<string[]>([]);
const visibleActions = computed(() =>
  actions.value.filter((action) => !disabledTemplates.value.includes(`${action.extensionId}/${action.actionId}`)),
);

const selection = ref("");
const highlighted = ref(0);
const phase = ref<QuickActionPhase>(MENU_PHASE);
const rootEl = ref<HTMLElement | null>(null);
/** Rust refused this selection outright — show why, offer nothing. */
const blocked = ref(false);
const openingWidget = ref(false);
/** The down-arrow row currently rendering its result in the popup. */
const previewLoadingId = ref<string | null>(null);
const copiedResult = ref(false);
/**
 * True only when the host positively identified a text field. Otherwise the
 * result stays on the clipboard — announced before the pick rather than
 * confirmed after it, so the user is never surprised by where the answer went.
 */
const canReplace = ref(true);

/** Aborts the in-flight handler when the user dismisses the popup. */
let inFlight: AbortController | null = null;
let unlistenOpen: UnlistenFn | undefined;
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

const busy = computed(() => isBusy(phase.value));
const runningId = computed(() => runningActionId(phase.value));
const preview = computed(() => previewText(selection.value));
const errorText = computed(() =>
  phase.value.kind === "error" ? phase.value.message : "",
);
const resultText = computed(() => outputText(phase.value));
const streaming = computed(() => phase.value.kind === "streaming");
const showingOutput = computed(
  () => phase.value.kind === "streaming" || phase.value.kind === "result",
);
const waiting = computed(() => streaming.value && resultText.value.length === 0);
const resultActionTitle = computed(() => {
  const activePhase = phase.value;
  if (activePhase.kind !== "result" && activePhase.kind !== "streaming") return "";
  return actions.value.find((action) => action.actionId === activePhase.actionId)?.title ?? "Result";
});

/**
 * Tell Rust how big the menu is so it can place it at the caret.
 *
 * The size is not known up front: it depends on how many actions the installed
 * extensions declare and on how long the preview line is. Rust waits for this
 * call before it shows the window at all, which is also why the popup never
 * flashes at the wrong position.
 */
async function announceSize() {
  await nextTick();
  const box = rootEl.value?.getBoundingClientRect();
  if (!box) return;
  await invoke("quick_action_ready", {
    width: Math.ceil(box.width),
    height: Math.ceil(box.height),
  }).catch(() => {});
}

async function refreshDisabledTemplates() {
  try {
    disabledTemplates.value = await invoke<string[]>("quick_action_disabled_templates");
  } catch {
    // Fail open: a transient preferences read must not hide every action.
  }
}

/** Custom templates are loaded fresh for each hotkey press. */
async function refreshActions() {
  try {
    actions.value = await listTextActions();
  } catch {
    actions.value = [];
  }
}

async function onOpen(text: string, error: string, replaceable: boolean) {
  selection.value = text;
  highlighted.value = 0;
  openingWidget.value = false;
  previewLoadingId.value = null;
  copiedResult.value = false;
  canReplace.value = replaceable;
  // Rust can refuse a selection before we ever see a menu — an over-long one,
  // because the answer replaces it and a partial rewrite would delete the rest.
  blocked.value = error !== "";
  phase.value = error ? { kind: "error", message: error } : MENU_PHASE;
  await refreshActions();
  await refreshDisabledTemplates();
  await announceSize();
}

/** Run one action and hand the result to Rust, which pastes it. */
async function pick(action: ResolvedTextAction) {
  if (busy.value || blocked.value) return;
  phase.value = { kind: "streaming", actionId: action.actionId, text: "" };
  void announceSize();
  inFlight = new AbortController();
  try {
    const result = await runTextAction(
      action,
      selection.value,
      inFlight.signal,
      (chunk) => {
        phase.value = appendStreamChunk(phase.value, action.actionId, chunk);
        void announceSize();
      },
    );
    await invoke("quick_action_apply", { text: result });
    // Rust hid the window; reset so the next hotkey press starts clean.
    phase.value = MENU_PHASE;
    selection.value = "";
  } catch (error) {
    // Back / dismiss already reset the phase; do not replace that with an error.
    if (phase.value.kind === "menu") return;
    phase.value = { kind: "error", message: errorMessage(error) };
    // The error line makes the menu taller — re-place it so it still fits.
    void announceSize();
  } finally {
    inFlight = null;
  }
}

/** Run an action but keep its answer in the dropdown for review. */
async function showResult(action: ResolvedTextAction) {
  if (busy.value || blocked.value || openingWidget.value) return;
  previewLoadingId.value = action.actionId;
  phase.value = { kind: "streaming", actionId: action.actionId, text: "" };
  void announceSize();
  inFlight = new AbortController();
  try {
    const result = await runTextAction(
      action,
      selection.value,
      inFlight.signal,
      (chunk) => {
        phase.value = appendStreamChunk(phase.value, action.actionId, chunk);
        void announceSize();
      },
    );
    copiedResult.value = false;
    phase.value = finishStream(phase.value, action.actionId, result);
    void announceSize();
  } catch (error) {
    if (phase.value.kind === "menu") return;
    phase.value = { kind: "error", message: errorMessage(error) };
    void announceSize();
  } finally {
    inFlight = null;
    previewLoadingId.value = null;
  }
}

/** Return to the action list without changing the selected text. */
function backToMenu() {
  if (phase.value.kind === "streaming") {
    inFlight?.abort();
    inFlight = null;
  } else if (busy.value) {
    return;
  }
  phase.value = MENU_PHASE;
  void announceSize();
}

async function copyResult() {
  if (!resultText.value) return;
  try {
    await navigator.clipboard.writeText(resultText.value);
    copiedResult.value = true;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copiedResult.value = false;
      copyResetTimer = null;
    }, 1400);
  } catch {
    /* Clipboard permission is not guaranteed in this popup. */
  }
}

/** Continue in the owning widget instead of running the headless transform. */
async function openInWidget(action: ResolvedTextAction) {
  if (busy.value || blocked.value || openingWidget.value || !action.widgetAction) return;
  openingWidget.value = true;
  try {
    await invoke("quick_action_open_widget", {
      extensionId: action.extensionId,
      actionId: action.widgetAction.id,
      args: action.widgetAction.args,
    });
  } catch (error) {
    openingWidget.value = false;
    phase.value = { kind: "error", message: errorMessage(error) };
    void announceSize();
  }
}

/** Close without changing anything; Rust restores focus and the clipboard. */
function dismiss() {
  inFlight?.abort();
  inFlight = null;
  phase.value = MENU_PHASE;
  selection.value = "";
  blocked.value = false;
  openingWidget.value = false;
  previewLoadingId.value = null;
  copiedResult.value = false;
  void invoke("quick_action_cancel").catch(() => {});
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    dismiss();
    return;
  }
  if (phase.value.kind === "result" || phase.value.kind === "streaming") return;
  if (busy.value || blocked.value || visibleActions.value.length === 0) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    highlighted.value = moveSelection(highlighted.value, visibleActions.value.length, delta);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const action = visibleActions.value[highlighted.value];
    if (action) void pick(action);
  }
}

/**
 * Clicking anywhere else means "not this after all".
 *
 * Guarded twice, because a blur that arrives at the wrong moment closes the
 * popup as it opens: the listener is wired only after the window has been
 * focused once, and it ignores blurs while no selection is loaded — which is
 * every blur that belongs to a hide we just performed ourselves.
 */
function onBlur() {
  if (!selection.value) return;
  dismiss();
}

function armBlurDismiss() {
  window.addEventListener("blur", onBlur);
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("focus", armBlurDismiss, { once: true });
  unlistenOpen = await listen<{ text: string; error?: string; canReplace?: boolean }>(
    "quickaction:open",
    (event) => {
      void onOpen(
        event.payload?.text ?? "",
        event.payload?.error ?? "",
        event.payload?.canReplace !== false,
      );
    },
  );
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("focus", armBlurDismiss);
  window.removeEventListener("blur", onBlur);
  unlistenOpen?.();
  if (copyResetTimer) clearTimeout(copyResetTimer);
});
</script>

<template>
  <div ref="rootEl" class="qa-menu" role="menu" aria-label="Quick actions">
    <div v-if="showingOutput" class="qa-result-head">
      <button type="button" class="qa-back" aria-label="Back to actions" v-tip="'Back'" @click="backToMenu">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M19 12H6m6-6-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <p class="qa-result-action">{{ resultActionTitle }}</p>
    </div>
    <p class="qa-preview" :title="selection">{{ preview }}</p>

    <div
      v-show="!showingOutput"
      v-for="(action, index) in blocked ? [] : visibleActions"
      :key="`${action.extensionId}/${action.actionId}`"
      role="menuitem"
      class="qa-item"
      :class="{
        'qa-item--highlighted': index === highlighted && !busy,
        'qa-item--running': runningId === action.actionId,
      }"
      @mouseenter="highlighted = index"
    >
      <button
        type="button"
        class="qa-item-main"
        :disabled="busy || openingWidget"
        v-tip="canReplace ? 'Replace selected text with result' : 'Copy result to clipboard'"
        @click="pick(action)"
      >
        <span class="qa-item-label">{{ action.title }}</span>
        <span v-if="action.subtitle" class="qa-item-sub">{{ action.subtitle }}</span>
      </button>
      <button
        v-if="!busy && previewLoadingId !== action.actionId"
        type="button"
        class="qa-result-open"
        aria-label="Show result here"
        v-tip="'Show result in menu'"
        :disabled="busy || openingWidget"
        @click="showResult(action)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v13m-6-6 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button
        v-if="!busy && action.widgetAction"
        type="button"
        class="qa-widget-open"
        aria-label="Open in widget"
        v-tip="'Open in widget'"
        :disabled="busy || openingWidget"
        @click="openInWidget(action)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <span v-if="busy" class="qa-loading-slot">
        <span v-if="runningId === action.actionId" class="qa-spinner" aria-hidden="true" />
      </span>
    </div>

    <div v-if="showingOutput" class="qa-result" aria-live="polite">
      <div
        v-if="waiting"
        class="qa-thinking"
        aria-live="polite"
        aria-label="Waiting for the result"
      >
        <span>Working</span>
        <span class="qa-thinking-dots" aria-hidden="true"><span /><span /><span /></span>
      </div>
      <p v-else>{{ resultText }}</p>
      <button
        v-if="resultText && !streaming"
        type="button"
        class="qa-result-copy"
        :aria-label="copiedResult ? 'Copied' : 'Copy result'"
        v-tip="copiedResult ? 'Copied' : 'Copy result'"
        @click="copyResult"
      >
        <svg v-if="!copiedResult" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.8" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <p v-if="!showingOutput && !blocked && !canReplace" class="qa-hint">
      No text field — the result goes to the clipboard
    </p>
    <p v-if="!showingOutput && !blocked && visibleActions.length === 0" class="qa-empty">
      No quick actions installed
    </p>
    <p v-if="errorText" class="qa-error" role="alert">{{ errorText }}</p>
  </div>
  <FloatingTipHost />
</template>

<style scoped>
/* Same glass menu as the alarm widget's notify dropdown — this is a menu that
   happens to be its own window, and it should not look like a second one. */
.qa-menu {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 10px;
  min-width: 200px;
  max-width: 320px;
  background: rgba(var(--surface-bg-rgb), 0.97);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  box-shadow: 0 10px 28px rgba(var(--shadow-rgb), calc(0.45 * var(--shadow-scale, 1)));
  backdrop-filter: var(--surface-backdrop-filter, blur(14px));
  color: rgba(var(--fg-rgb), 0.92);
}

.qa-preview {
  margin: 0;
  padding: 5px 8px 6px;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(var(--fg-rgb), 0.45);
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.08);
  overflow-wrap: anywhere;
}

.qa-item {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.82);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
}

.qa-result-head {
  display: flex;
  align-items: flex-start;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.08);
}

.qa-result-head .qa-preview {
  flex: 1;
  border-bottom: 0;
}

.qa-result-action {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 7px 8px;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qa-back,
.qa-result-open {
  display: grid;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  cursor: pointer;
}

.qa-back {
  margin: 4px 0 0 4px;
}

.qa-result-open {
  margin-right: 4px;
}

.qa-item--highlighted,
.qa-item:focus-within {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.95);
}

.qa-item-main {
  display: flex;
  flex: 1 1 auto;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  padding: 7px 4px 7px 8px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.qa-item-main:disabled,
.qa-widget-open:disabled,
.qa-result-open:disabled {
  cursor: default;
  opacity: 0.45;
}

.qa-item-label {
  flex: 0 0 auto;
}

.qa-item-sub {
  flex: 1 1 auto;
  font-size: 11px;
  font-weight: 400;
  color: rgba(var(--fg-rgb), 0.42);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.qa-spinner {
  flex: 0 0 auto;
  align-self: center;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  /* Opts out of the inherited corner shape: this one spins, and a rotating
     squircle visibly wobbles where a circle is rotationally symmetric. */
  corner-shape: round;
  border: 1.5px solid rgba(var(--fg-rgb), 0.25);
  border-top-color: rgba(var(--fg-rgb), 0.8);
  animation: qa-spin 0.7s linear infinite;
}

/* Keep the menu's measured width stable while its two action buttons hide. */
.qa-loading-slot {
  display: flex;
  flex: 0 0 56px;
  align-items: center;
  justify-content: flex-end;
  box-sizing: border-box;
  padding-right: 4px;
}

.qa-widget-open {
  display: grid;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  margin-right: 0;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}

.qa-result-open {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}

/* A quiet menu reads as text first; its secondary actions appear only for the
   row the pointer or keyboard is currently working with. */
.qa-item:hover .qa-widget-open,
.qa-item:hover .qa-result-open,
.qa-item--highlighted .qa-widget-open,
.qa-item--highlighted .qa-result-open,
.qa-item:focus-within .qa-widget-open,
.qa-item:focus-within .qa-result-open {
  opacity: 1;
  pointer-events: auto;
}

.qa-widget-open:hover:not(:disabled),
.qa-widget-open:focus-visible,
.qa-result-open:hover:not(:disabled),
.qa-result-open:focus-visible,
.qa-back:hover,
.qa-back:focus-visible {
  background: rgba(var(--fg-rgb), 0.12);
  color: rgba(var(--fg-rgb), 0.95);
}

.qa-result {
  position: relative;
  max-height: 240px;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 12px;
  line-height: 1.45;
}

.qa-result p {
  margin: 0;
  padding-right: 26px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.qa-thinking {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 12px;
  white-space: nowrap;
}

.qa-thinking-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.qa-thinking-dots span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  animation: qa-dot 1.1s ease-in-out infinite;
}

.qa-thinking-dots span:nth-child(2) {
  animation-delay: 0.15s;
}

.qa-thinking-dots span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes qa-dot {
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

.qa-result-copy {
  position: absolute;
  right: 5px;
  bottom: 5px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: rgba(var(--surface-bg-rgb), 0.88);
  color: rgba(var(--fg-rgb), 0.7);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease;
}

.qa-result:hover .qa-result-copy,
.qa-result-copy:focus-visible {
  opacity: 1;
}

.qa-result-copy:hover {
  background: rgba(var(--fg-rgb), 0.16);
  color: rgba(var(--fg-rgb), 0.95);
}

@keyframes qa-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .qa-spinner {
    animation-duration: 2.4s;
  }
  .qa-thinking-dots span {
    animation: none;
    opacity: 0.7;
  }
}

.qa-empty,
.qa-error,
.qa-hint {
  margin: 0;
  padding: 6px 8px;
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.qa-empty {
  color: rgba(var(--fg-rgb), 0.45);
}

.qa-hint {
  color: rgba(var(--fg-rgb), 0.5);
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
}

.qa-error {
  color: #e0796f;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
}
</style>
