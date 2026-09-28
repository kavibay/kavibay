<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { ClipboardCopyIcon, IconBase } from "@sdk/icons";
import { formatTokens, type WizardUsage } from "./widgetWizardLogic";

const props = defineProps<{
  usage: WizardUsage;
  cost: string;
  copyState: "idle" | "copying" | "copied" | "error";
  canExport: boolean;
  showSuggestions: boolean;
}>();
const emit = defineEmits<{
  export: [];
  "update:showSuggestions": [show: boolean];
}>();
const panelId = useId();
const open = ref(false);
const triggerEl = ref<HTMLButtonElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const suggestionsEl = ref<HTMLButtonElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
let closeTimer: ReturnType<typeof setTimeout> | undefined;
const totalTokens = computed(() => props.usage.input + props.usage.cacheWrite + props.usage.cached + props.usage.output);
const usageRows = computed(() => [
  { label: "Fresh input", count: props.usage.input, rate: "" },
  ...(props.usage.cacheWrite > 0 ? [{ label: "Written to cache", count: props.usage.cacheWrite, rate: "1.25×" }] : []),
  ...(props.usage.cached > 0 ? [{ label: "Read from cache", count: props.usage.cached, rate: "0.1×" }] : []),
  { label: "Generated", count: props.usage.output, rate: "" },
]);

function cancelClose() {
  clearTimeout(closeTimer);
}

function positionPanel() {
  const trigger = triggerEl.value?.getBoundingClientRect();
  const panel = panelEl.value;
  if (!trigger || !panel) return;
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const below = trigger.bottom + 6;
  panelStyle.value = {
    left: `${Math.max(8, Math.min(trigger.right - width, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, below + height <= window.innerHeight - 8 ? below : trigger.top - height - 6)}px`,
    visibility: "visible",
  };
}

async function showMenu(focusAction = false) {
  cancelClose();
  if (!open.value) panelStyle.value = { visibility: "hidden" };
  open.value = true;
  await nextTick();
  if (!open.value) return;
  positionPanel();
  if (focusAction) suggestionsEl.value?.focus();
}

function closeMenu(restoreFocus = false) {
  cancelClose();
  if (restoreFocus) triggerEl.value?.focus();
  open.value = false;
}

function contains(target: EventTarget | null) {
  return target instanceof Node && (triggerEl.value?.contains(target) || panelEl.value?.contains(target));
}

function scheduleClose() {
  cancelClose();
  // The panel is teleported, so leave time to cross the gap from its trigger.
  closeTimer = setTimeout(() => {
    if (!contains(document.activeElement)) closeMenu();
  }, 180);
}

function onFocusOut(event: FocusEvent) {
  if (!contains(event.relatedTarget)) closeMenu();
}
function onOutsidePointer(event: PointerEvent) {
  if (!contains(event.target)) closeMenu();
}
function onEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeMenu(true);
}
function onTriggerTab(event: KeyboardEvent) {
  if (!open.value || event.shiftKey) return;
  event.preventDefault();
  void showMenu(true);
}

watch([totalTokens, usageRows, () => props.cost, () => props.copyState, () => props.showSuggestions], async () => {
  await nextTick();
  if (open.value) positionPanel();
});

watch(open, (visible) => {
  if (visible) {
    window.addEventListener("pointerdown", onOutsidePointer, true);
    window.addEventListener("keydown", onEscape, true);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
  } else removeListeners();
});
function removeListeners() {
  window.removeEventListener("pointerdown", onOutsidePointer, true);
  window.removeEventListener("keydown", onEscape, true);
  window.removeEventListener("resize", positionPanel);
  window.removeEventListener("scroll", positionPanel, true);
}
onBeforeUnmount(() => {
  cancelClose();
  removeListeners();
});
</script>

<template>
  <button
    ref="triggerEl"
    type="button"
    class="conversation-menu-trigger"
    aria-label="Conversation menu"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-controls="panelId"
    @pointerenter="showMenu()"
    @pointerleave="scheduleClose"
    @focus="showMenu()"
    @blur="onFocusOut"
    @click="showMenu()"
    @keydown.down.prevent="showMenu(true)"
    @keydown.tab="onTriggerTab"
  >
    <IconBase :size="16">
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </IconBase>
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      :id="panelId"
      ref="panelEl"
      class="conversation-menu"
      :style="panelStyle"
      role="dialog"
      aria-label="Conversation options"
      @pointerenter="cancelClose"
      @pointerleave="scheduleClose"
      @focusout="onFocusOut"
    >
      <div class="conversation-menu__stats">
        <p class="conversation-menu__heading">This conversation</p>
        <div class="conversation-menu__summary">
          <p :title="`${totalTokens.toLocaleString()} tokens`"><strong>{{ formatTokens(totalTokens) }}</strong> <span>tokens</span></p>
          <p v-if="cost" class="conversation-menu__cost">{{ cost }}</p>
        </div>
        <dl class="conversation-menu__details">
          <div v-for="row in usageRows" :key="row.label">
            <dt>{{ row.label }} <span v-if="row.rate" class="conversation-menu__rate">{{ row.rate }}</span></dt>
            <dd :title="`${row.count.toLocaleString()} tokens`">{{ formatTokens(row.count) }}</dd>
          </div>
        </dl>
      </div>
      <button
        ref="suggestionsEl"
        type="button"
        class="conversation-menu__toggle"
        role="switch"
        :aria-checked="showSuggestions"
        @click="emit('update:showSuggestions', !showSuggestions)"
        @keydown.shift.tab.prevent="triggerEl?.focus()"
      >
        <span>Show suggestions</span>
        <span class="conversation-menu__switch" :class="{ 'conversation-menu__switch--on': showSuggestions }" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="conversation-menu__export"
        :disabled="!canExport || copyState === 'copying'"
        @click="emit('export')"
      >
        <ClipboardCopyIcon :size="15" />
        <span>Export transcript<span class="conversation-menu__hint">Copy to clipboard</span></span>
      </button>
      <p v-if="copyState === 'copied' || copyState === 'error'" class="conversation-menu__feedback" role="status">
        {{ copyState === 'copied' ? 'Copied to clipboard' : 'Could not copy. Try again.' }}
      </p>
    </div>
  </Teleport>
</template>

<style scoped>
.conversation-menu-trigger {
  display: grid;
  flex: 0 0 auto;
  margin-left: auto;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.5);
  cursor: pointer;
}
.conversation-menu-trigger:hover,
.conversation-menu-trigger[aria-expanded="true"] { background: rgba(var(--fg-rgb), 0.08); color: rgba(var(--fg-rgb), 0.9); }
.conversation-menu-trigger:focus-visible,
.conversation-menu__toggle:focus-visible,
.conversation-menu__export:focus-visible { outline: 1px solid currentColor; outline-offset: -2px; }
.conversation-menu {
  position: fixed;
  z-index: 10000;
  box-sizing: border-box;
  width: min(300px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  border-radius: 10px;
  background: var(--surface-popup, rgba(27, 28, 31, 0.98));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
  color: rgb(var(--fg-rgb));
  font-size: 12px;
}
.conversation-menu__stats { padding: 9px 9px 12px; border-bottom: 1px solid rgba(var(--fg-rgb), 0.1); }
.conversation-menu p { margin: 0; }
.conversation-menu__heading { color: rgba(var(--fg-rgb), 0.6); font-size: 11px; }
.conversation-menu__summary { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 7px; font-variant-numeric: tabular-nums; }
.conversation-menu__summary strong { font-size: 20px; font-weight: 600; letter-spacing: -0.03em; }
.conversation-menu__summary span { margin-left: 3px; color: rgba(var(--fg-rgb), 0.5); font-size: 11px; }
.conversation-menu__cost { color: rgba(var(--fg-rgb), 0.8); }
.conversation-menu__details { display: grid; gap: 5px; margin: 12px 0 0; font-size: 11px; line-height: 1.4; }
.conversation-menu__details > div { display: flex; justify-content: space-between; gap: 12px; }
.conversation-menu__details dt { color: rgba(var(--fg-rgb), 0.6); }
.conversation-menu__details dd { flex-shrink: 0; margin: 0; color: rgba(var(--fg-rgb), 0.85); font-variant-numeric: tabular-nums; }
.conversation-menu__rate { margin-left: 3px; color: rgba(var(--fg-rgb), 0.35); font-size: 10px; }
.conversation-menu__toggle,
.conversation-menu__export {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
  padding: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.conversation-menu__toggle { justify-content: space-between; }
.conversation-menu__toggle:hover,
.conversation-menu__export:hover:not(:disabled) { background: rgba(var(--fg-rgb), 0.08); }
.conversation-menu__switch {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 26px;
  height: 16px;
  padding: 2px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.15);
}
.conversation-menu__switch::after {
  content: "";
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.65);
  transition: transform 120ms ease;
}
.conversation-menu__switch--on { background: rgba(var(--fg-rgb), 0.4); }
.conversation-menu__switch--on::after { transform: translateX(10px); background: rgb(var(--fg-rgb)); }
.conversation-menu__export:disabled { opacity: 0.4; cursor: default; }
.conversation-menu__hint { display: block; padding-top: 3px; font-size: 10px; opacity: 0.5; }
.conversation-menu .conversation-menu__feedback { padding: 4px 8px 6px; font-size: 11px; opacity: 0.7; }
</style>
