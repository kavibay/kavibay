<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches, type WidgetSurface } from "@sdk";
import type { SnippetsModel } from "./widgets/snippets";

const props = defineProps<{ model: SnippetsModel }>();

const injectedInstanceId = inject<string>("widgetInstanceId");
if (!injectedInstanceId) throw new Error("widgetInstanceId missing");
// Narrowed once: the throw above does not carry into nested function bodies,
// and every listener in here needs a plain string.
const instanceId: string = injectedInstanceId;
const widgetSurface = inject<WidgetSurface>("widgetSurface", "desk");

const { snippets, collapsed, toggleCollapsed, add, update, remove } = props.model;
const rootEl = ref<HTMLElement | null>(null);

/** Focus the name field of a row after it is added. */
async function focusName(id: string) {
  await nextTick();
  const input = rootEl.value?.querySelector<HTMLInputElement>(
    `input[data-snippet-name="${CSS.escape(id)}"]`,
  );
  input?.focus();
  input?.select();
}

/** Add a row and put the caret in its name. */
async function addAndFocus() {
  const id = add();
  await focusName(id);
}

function onKavibayFocusWidget(event: Event) {
  if (!widgetFocusRequestMatches(event, instanceId, widgetSurface)) return;
  if (snippets.value.length === 0) {
    void addAndFocus();
    return;
  }
  void focusName(snippets.value[0]!.id);
}

onMounted(() => window.addEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget));
onBeforeUnmount(() => window.removeEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget));
</script>

<template>
  <!-- Stop card-drag from stealing focus while editing a template. -->
  <div
    ref="rootEl"
    class="snippets"
    :class="{ 'snippets--inline': widgetSurface === 'inline' }"
    @pointerdown.stop
  >
    <ul class="snippets-list" aria-label="Snippets" @wheel.stop>
      <!-- One card per snippet: the fields are borderless so the card is the
           only frame, and the card's focus ring shows which one is being edited. -->
      <li
        v-for="row in snippets"
        :key="row.id"
        class="snippets-row"
        :class="{ 'snippets-row--collapsed': collapsed.includes(row.id) }"
      >
        <button
          type="button"
          class="snippets-toggle"
          :aria-label="collapsed.includes(row.id) ? 'Expand snippet' : 'Collapse snippet'"
          :aria-expanded="!collapsed.includes(row.id)"
          @click="toggleCollapsed(row.id)"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <input
          :data-snippet-name="row.id"
          class="snippets-name"
          type="text"
          :value="row.name"
          placeholder="Snippet name"
          autocomplete="off"
          spellcheck="false"
          aria-label="Snippet name"
          @input="update(row.id, { name: ($event.target as HTMLInputElement).value })"
        />
        <button
          type="button"
          class="snippets-delete"
          aria-label="Delete snippet"
          @click="remove(row.id)"
        >
          <svg class="snippets-trash" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <g class="snippets-trash-lid">
              <path d="M3 6h18" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </g>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          </svg>
        </button>
        <!-- Folded: one line of the template, so the card is still recognisable. -->
        <button
          v-if="collapsed.includes(row.id)"
          type="button"
          class="snippets-preview"
          @click="toggleCollapsed(row.id)"
        >{{ row.template || "Empty template" }}</button>
        <textarea
          v-else
          class="snippets-template"
          :value="row.template"
          placeholder="Hi {name}, thanks for reaching out!"
          spellcheck="false"
          rows="2"
          aria-label="Snippet template"
          @input="update(row.id, { template: ($event.target as HTMLTextAreaElement).value })"
        />
      </li>
      <li class="snippets-add-item">
        <button type="button" class="snippets-add" @click="addAndFocus">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          <span>Add snippet</span>
        </button>
        <p class="snippets-hint">Write <code>{name}</code> where a value goes; the palette asks for it.</p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.snippets {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  color: rgba(var(--fg-rgb), 0.92);
  font-family: system-ui, sans-serif;
}

/* The desk card pads its body; the palette panel does not, so pad here. */
.snippets--inline {
  padding: 12px 14px 14px;
}

.snippets-list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  min-height: 0;
  flex: 1;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/*
 * One grid per card: chevron | content | trash. Both icons sit in fixed columns
 * centred on the name's line, and the template shares the name's column, so
 * every left edge in the card lines up.
 */
.snippets-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 28px;
  column-gap: 6px;
  row-gap: 4px;
  align-items: center;
  padding: 8px 8px 10px 6px;
  border-radius: 10px;
  background: rgba(var(--fg-rgb), 0.04);
  border: 1px solid rgba(var(--fg-rgb), 0.08);
  transition: border-color 0.12s ease, background 0.12s ease;
}

.snippets-row--collapsed {
  padding-bottom: 8px;
}

.snippets-row:focus-within {
  border-color: rgba(var(--fg-rgb), 0.24);
  background: rgba(var(--fg-rgb), 0.06);
}

.snippets-toggle,
.snippets-delete {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.snippets-toggle {
  grid-column: 1;
  color: rgba(var(--fg-rgb), 0.5);
}

.snippets-toggle svg {
  display: block;
  transition: transform 0.15s ease;
}

.snippets-row--collapsed .snippets-toggle svg {
  transform: rotate(-90deg);
}

.snippets-toggle:hover,
.snippets-toggle:focus-visible {
  color: rgba(var(--fg-rgb), 0.9);
  background: rgba(var(--fg-rgb), 0.08);
  outline: none;
}

.snippets-name,
.snippets-template,
.snippets-preview {
  grid-column: 2;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  outline: none;
}

.snippets-name {
  height: 24px;
  color: rgba(var(--fg-rgb), 0.95);
  font-size: 13px;
  font-weight: 600;
}

/* Under the name and across the trash column, so long templates get the width. */
.snippets-template {
  grid-column: 2 / 4;
  color: rgba(var(--fg-rgb), 0.75);
  font-size: 12px;
  line-height: 1.45;
  /* Drag the lower-right corner for longer templates; two lines is the floor. */
  resize: vertical;
  min-height: calc(2 * 1.45em);
}

.snippets-name::placeholder,
.snippets-template::placeholder {
  color: rgba(var(--fg-rgb), 0.35);
}

/* Folded: one line of the template, so the card is still recognisable. */
.snippets-preview {
  grid-column: 2 / 4;
  color: rgba(var(--fg-rgb), 0.45);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.snippets-preview:hover {
  color: rgba(var(--fg-rgb), 0.7);
}

/* Quiet until the card is hovered or being edited. */
.snippets-delete {
  grid-column: 3;
  justify-self: end;
  color: rgba(var(--fg-rgb), 0.4);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.snippets-row:hover .snippets-delete,
.snippets-row:focus-within .snippets-delete {
  opacity: 1;
}

.snippets-delete:hover,
.snippets-delete:focus-visible {
  color: rgba(var(--fg-rgb), 0.9);
  background: rgba(var(--fg-rgb), 0.08);
  outline: none;
}

.snippets-trash {
  overflow: visible;
  display: block;
}

.snippets-trash-lid {
  transform-origin: 4px 6px;
  transition: transform 0.16s ease;
}

.snippets-delete:hover .snippets-trash-lid,
.snippets-delete:focus-visible .snippets-trash-lid {
  transform: rotate(-20deg) translate(-0.5px, -1px);
}

.snippets-add-item {
  flex: 0 0 auto;
}

.snippets-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  border: 0;
  border-radius: 10px;
  background: rgba(var(--fg-rgb), 0.04);
  color: rgba(var(--fg-rgb), 0.6);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.snippets-add:hover,
.snippets-add:focus-visible {
  color: rgba(var(--fg-rgb), 0.92);
  background: rgba(var(--fg-rgb), 0.09);
  outline: none;
}

/* Inset like the card text above it rather than flush with the card edge. */
.snippets-hint {
  margin: 10px 0 0;
  padding: 0 6px;
  color: rgba(var(--fg-rgb), 0.4);
  font-size: 11px;
  line-height: 1.4;
}

.snippets-hint code {
  padding: 0 3px;
  border-radius: 4px;
  background: rgba(var(--fg-rgb), 0.08);
  font-family: ui-monospace, monospace;
}

@media (prefers-reduced-motion: reduce) {
  .snippets-row,
  .snippets-delete,
  .snippets-toggle svg,
  .snippets-trash-lid { transition: none; }
}
</style>
