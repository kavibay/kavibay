<script setup lang="ts">
/**
 * Purpose picker.
 *
 * A native `<select>` is drawn by Windows — system colours, system font, a
 * popup that ignores the app's theme — which on a dark translucent card reads
 * as a hole. This is the same teleported menu the Alarm widget uses for its
 * notifier: a check marks the current choice, and the menu floats above the
 * card so it is never clipped.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  setClickThroughPaused,
  syncInteractiveRegions,
} from "../../core/app/system/clickThrough";
import {
  createCustomPurposeTemplate,
  findPurpose,
  purposesForTemplates,
  type CustomPurposeTemplate,
} from "./onePurposeLlmLogic";

const props = defineProps<{
  purposeId: string;
  customTemplates: CustomPurposeTemplate[];
  hiddenTemplateIds: string[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:purposeId": [value: string];
  "create-template": [template: CustomPurposeTemplate];
  "delete-template": [templateId: string];
}>();

const open = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});
const creating = ref(false);
const title = ref("");
const description = ref("");
const systemPrompt = ref("");
const formError = ref("");
const pendingDeleteId = ref<string | null>(null);

const purposes = computed(() =>
  purposesForTemplates(props.customTemplates, props.hiddenTemplateIds),
);
const current = computed(() =>
  findPurpose(props.purposeId, props.customTemplates, props.hiddenTemplateIds),
);

/** Below the trigger, flipping above when the desktop edge is closer. */
function placeMenu() {
  const trigger = triggerEl.value;
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  const width = Math.min(Math.max(r.width, 200), Math.min(280, window.innerWidth - 16));
  let left = r.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
  if (left < 8) left = 8;

  // Two lines per row plus the creation action — the form is larger, but a
  // conservative estimate keeps it from opening into the desktop edge.
  const estimatedHeight = creating.value ? 390 : purposes.value.length * 50 + 50;
  const gap = 4;
  const spaceBelow = window.innerHeight - r.bottom - 8;
  const placeAbove = spaceBelow < estimatedHeight && r.top > spaceBelow;

  menuStyle.value = {
    position: "fixed",
    left: `${left}px`,
    width: `${width}px`,
    zIndex: "10000",
    ...(placeAbove
      ? { bottom: `${Math.max(8, window.innerHeight - r.top + gap)}px` }
      : { top: `${r.bottom + gap}px` }),
  };
}

async function setOpen(next: boolean) {
  open.value = next;
  if (!next) pendingDeleteId.value = null;
  // Pause click-through while the menu is on document.body (outside the card).
  setClickThroughPaused(next);
  if (next) {
    await nextTick();
    placeMenu();
  }
  await nextTick();
  syncInteractiveRegions();
}

function toggle() {
  if (props.disabled) return;
  void setOpen(!open.value);
}

function choose(id: string) {
  emit("update:purposeId", id);
  void setOpen(false);
}

function requestRemoveTemplate(id: string) {
  if (purposes.value.length <= 1) return;
  pendingDeleteId.value = id;
}

function cancelRemoveTemplate() {
  pendingDeleteId.value = null;
}

function confirmRemoveTemplate() {
  const id = pendingDeleteId.value;
  if (!id) return;
  pendingDeleteId.value = null;
  emit("delete-template", id);
}

async function showCreateForm() {
  pendingDeleteId.value = null;
  creating.value = true;
  formError.value = "";
  await nextTick();
  placeMenu();
  syncInteractiveRegions();
}

function hideCreateForm() {
  creating.value = false;
  formError.value = "";
}

function submitTemplate() {
  const template = createCustomPurposeTemplate(
    {
      title: title.value,
      description: description.value,
      systemPrompt: systemPrompt.value,
    },
    `custom-${crypto.randomUUID()}`,
  );
  if (!template) {
    formError.value = "Title, description and system prompt are required.";
    return;
  }
  emit("create-template", template);
  title.value = "";
  description.value = "";
  systemPrompt.value = "";
  hideCreateForm();
  choose(template.id);
}

function onPointerDown(e: PointerEvent) {
  if (!open.value) return;
  const target = e.target as Node;
  if (triggerEl.value?.contains(target) || menuEl.value?.contains(target)) return;
  void setOpen(false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape" || !open.value) return;
  if (pendingDeleteId.value) {
    cancelRemoveTemplate();
    return;
  }
  void setOpen(false);
}

function onViewportChange() {
  if (open.value) placeMenu();
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && open.value) void setOpen(false);
  },
);

onMounted(() => {
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("scroll", onViewportChange, true);
  if (open.value) setClickThroughPaused(false);
});
</script>

<template>
  <div class="opl-purpose-picker">
    <button
      ref="triggerEl"
      type="button"
      class="opl-purpose-trigger"
      :class="{ 'opl-purpose-trigger--open': open }"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="`Purpose: ${current.label}`"
      @click="toggle"
      @pointerdown.stop
    >
      <span class="opl-purpose-trigger-label">{{ current.label }}</span>
      <svg
        class="opl-purpose-chevron"
        width="10"
        height="6"
        viewBox="0 0 10 6"
        aria-hidden="true"
      >
        <path
          d="M1 1l4 4 4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <!-- Float above the card so the options are never clipped. -->
    <Teleport to="body">
      <div
        v-if="open"
        ref="menuEl"
        class="opl-purpose-menu"
        :role="creating ? 'dialog' : 'menu'"
        :aria-label="creating ? 'Create template' : 'Purpose'"
        data-interactive
        :style="menuStyle"
        @pointerdown.stop
      >
        <div
          v-if="creating"
          class="opl-template-form"
          role="group"
          aria-label="Create template"
          @keyup.enter.prevent="submitTemplate"
        >
          <p class="opl-template-form-title">Create template</p>
          <label class="opl-template-field">
            <span>Title</span>
            <input v-model="title" type="text" maxlength="80" autocomplete="off" autofocus />
          </label>
          <label class="opl-template-field">
            <span>Description</span>
            <textarea v-model="description" rows="2" maxlength="180" />
          </label>
          <label class="opl-template-field">
            <span>System prompt</span>
            <textarea v-model="systemPrompt" rows="6" maxlength="12000" spellcheck="false" />
          </label>
          <p v-if="formError" class="opl-template-error">{{ formError }}</p>
          <div class="opl-template-actions">
            <button type="button" class="opl-template-cancel" @click="hideCreateForm">Cancel</button>
            <button type="button" class="opl-template-submit" @click="submitTemplate">Create</button>
          </div>
        </div>
        <template v-else>
          <div
            v-for="item in purposes"
            :key="item.id"
            role="menuitemradio"
            tabindex="0"
            class="opl-purpose-item"
            :class="{ 'opl-purpose-item--active': item.id === purposeId }"
            :aria-checked="item.id === purposeId"
            @click="choose(item.id)"
            @keydown.enter.prevent="choose(item.id)"
            @keydown.space.prevent="choose(item.id)"
          >
            <template v-if="pendingDeleteId !== item.id">
              <span class="opl-purpose-check" aria-hidden="true">
                {{ item.id === purposeId ? "✓" : "" }}
              </span>
              <span class="opl-purpose-item-body">
                <span class="opl-purpose-item-label">{{ item.label }}</span>
                <span class="opl-purpose-item-hint">{{ item.hint }}</span>
              </span>
              <button
                type="button"
                class="opl-purpose-delete"
                :aria-label="`Delete ${item.label}`"
                v-tip="purposes.length <= 1 ? 'Keep at least one template' : 'Delete template'"
                :disabled="purposes.length <= 1"
                @click.stop="requestRemoveTemplate(item.id)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </template>
            <div
              v-else
              class="opl-purpose-delete-confirm"
              role="group"
              :aria-label="`Confirm deletion of ${item.label}`"
              @click.stop
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span>Confirm</span>
              <button type="button" aria-label="Cancel deletion" @click.stop="cancelRemoveTemplate">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              </button>
              <button
                type="button"
                class="opl-purpose-delete-confirm-action"
                aria-label="Confirm deletion"
                @click.stop="confirmRemoveTemplate"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
          </div>
          <button type="button" role="menuitem" class="opl-purpose-create" @click="showCreateForm">
            <span aria-hidden="true">+</span>
            Create template
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.opl-purpose-picker {
  min-width: 0;
}

.opl-purpose-trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  padding: 5px 9px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--fill);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.opl-purpose-trigger:hover:not(:disabled),
.opl-purpose-trigger--open {
  background: var(--fill-hover);
}

.opl-purpose-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}

.opl-purpose-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opl-purpose-chevron {
  flex-shrink: 0;
  color: var(--text-faint);
}

.opl-purpose-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  box-sizing: border-box;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 10px;
  background: rgba(var(--surface-bg-rgb), 0.97);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  backdrop-filter: var(--surface-backdrop-filter, blur(14px));
  color: var(--text);
}

.opl-purpose-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 7px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.82);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.opl-purpose-item:hover,
.opl-purpose-item:focus-visible {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.95);
}

.opl-purpose-item--active {
  color: rgba(var(--fg-rgb), 0.95);
}

.opl-purpose-check {
  width: 12px;
  flex: 0 0 12px;
  margin-top: 1px;
  font-size: 11px;
  line-height: 1.35;
  color: #5fad8c;
}

.opl-purpose-item-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.opl-purpose-item-label {
  font-weight: 600;
  line-height: 1.35;
}

.opl-purpose-item-hint {
  font-size: 11px;
  line-height: 1.3;
  color: var(--text-faint);
}

.opl-purpose-delete {
  display: grid;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin: 1px 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-faint);
  font: inherit;
  opacity: 0;
  cursor: pointer;
}

.opl-purpose-delete svg {
  width: 12px;
  height: 12px;
}

.opl-purpose-item:hover .opl-purpose-delete,
.opl-purpose-item:focus-within .opl-purpose-delete {
  opacity: 1;
}

.opl-purpose-delete:hover:not(:disabled),
.opl-purpose-delete:focus-visible {
  background: rgba(220, 90, 90, 0.16);
  color: rgba(220, 90, 90, 0.95);
}

.opl-purpose-delete:disabled {
  cursor: default;
}

/* Match the widget menu's in-place destructive confirmation: the row itself
   swaps, so the pointer never has to travel to a separate dialog. */
.opl-purpose-delete-confirm {
  display: grid;
  flex: 1;
  grid-template-columns: 14px minmax(0, 1fr) 22px 22px;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 28px;
  padding: 0 3px 0 7px;
  border-radius: 7px;
  background: rgba(224, 122, 95, 0.14);
  box-shadow: inset 0 0 0 1px rgba(224, 122, 95, 0.1);
  color: #e07a5f;
  font-size: 11px;
  font-weight: 600;
}

.opl-purpose-delete-confirm > svg {
  width: 14px;
  height: 14px;
}

.opl-purpose-delete-confirm > span {
  min-width: 0;
}

.opl-purpose-delete-confirm button {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.85);
  cursor: pointer;
}

.opl-purpose-delete-confirm button svg {
  width: 12px;
  height: 12px;
}

.opl-purpose-delete-confirm button:hover,
.opl-purpose-delete-confirm button:focus-visible {
  border-color: rgba(var(--fg-rgb), 0.28);
  background: rgba(var(--fg-rgb), 0.14);
}

.opl-purpose-delete-confirm .opl-purpose-delete-confirm-action {
  border-color: transparent;
  background: #e07a5f;
  color: #251c1b;
}

.opl-purpose-delete-confirm .opl-purpose-delete-confirm-action:hover,
.opl-purpose-delete-confirm .opl-purpose-delete-confirm-action:focus-visible {
  background: #ee9279;
}

.opl-purpose-create {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  margin-top: 2px;
  padding: 7px 8px;
  border: 0;
  border-top: 1px solid rgba(var(--fg-rgb), 0.1);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.opl-purpose-create:hover,
.opl-purpose-create:focus-visible {
  color: var(--text);
}

.opl-purpose-create span {
  display: grid;
  width: 12px;
  place-items: center;
  color: #5fad8c;
  font-size: 16px;
  font-weight: 400;
}

.opl-template-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 5px 4px 4px;
}

.opl-template-form-title {
  margin: 0 0 1px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.opl-template-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.opl-template-field input,
.opl-template-field textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  outline: none;
  background: var(--inset-bg);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: normal;
  line-height: 1.35;
  text-transform: none;
}

.opl-template-field textarea {
  resize: vertical;
}

.opl-template-field input:focus,
.opl-template-field textarea:focus {
  border-color: rgba(var(--fg-rgb), 0.45);
}

.opl-template-error {
  margin: -2px 0 0;
  color: rgba(220, 90, 90, 0.95);
  font-size: 10px;
  line-height: 1.3;
}

.opl-template-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.opl-template-cancel,
.opl-template-submit {
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.opl-template-cancel {
  background: transparent;
  color: var(--text-muted);
}

.opl-template-submit {
  background: rgba(var(--fg-rgb), 0.15);
  color: var(--text);
}

.opl-template-cancel:hover,
.opl-template-submit:hover {
  background: rgba(var(--fg-rgb), 0.24);
  color: var(--text);
}
</style>
