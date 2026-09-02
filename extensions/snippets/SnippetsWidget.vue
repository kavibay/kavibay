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

const { snippets, add, update, remove } = props.model;
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
  <div ref="rootEl" class="snippets" @pointerdown.stop>
    <ul class="snippets-list" aria-label="Snippets" @wheel.stop>
      <li v-for="row in snippets" :key="row.id" class="snippets-row">
        <input
          :data-snippet-name="row.id"
          class="snippets-name"
          type="text"
          :value="row.name"
          placeholder="Name"
          autocomplete="off"
          spellcheck="false"
          aria-label="Snippet name"
          @input="update(row.id, { name: ($event.target as HTMLInputElement).value })"
        />
        <textarea
          class="snippets-template"
          :value="row.template"
          placeholder="hallo {name} wie geht's?"
          spellcheck="false"
          rows="2"
          aria-label="Snippet template"
          @input="update(row.id, { template: ($event.target as HTMLTextAreaElement).value })"
        />
        <button
          type="button"
          class="snippets-delete"
          aria-label="Delete snippet"
          @click="remove(row.id)"
        >
          <svg class="snippets-trash" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <g class="snippets-trash-lid">
              <path fill="currentColor" d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
            </g>
            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z" />
          </svg>
        </button>
      </li>
      <li class="snippets-add-item">
        <button type="button" class="snippets-add" @click="addAndFocus">Add snippet</button>
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
  color: rgba(var(--fg-rgb), 0.92);
  font-family: system-ui, sans-serif;
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

.snippets-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(var(--fg-rgb), 0.06);
}

.snippets-name {
  grid-column: 1;
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.95);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  outline: none;
}

.snippets-template {
  grid-column: 1 / -1;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.9);
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  resize: none;
  outline: none;
}

.snippets-name:focus,
.snippets-template:focus {
  border-color: rgba(var(--fg-rgb), 0.28);
}

.snippets-delete {
  grid-column: 2;
  grid-row: 1;
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.35);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border-radius: 4px;
  cursor: pointer;
  align-self: center;
}

.snippets-delete:hover,
.snippets-delete:focus-visible {
  color: rgba(var(--fg-rgb), 0.85);
  background: rgba(var(--fg-rgb), 0.08);
}

.snippets-trash {
  overflow: visible;
  display: block;
}

.snippets-trash-lid {
  transform-origin: 5px 5px;
  transition: transform 0.16s ease;
}

.snippets-delete:hover .snippets-trash-lid,
.snippets-delete:focus-visible .snippets-trash-lid {
  transform: rotate(-28deg) translate(-0.5px, -1px);
}

.snippets-add-item {
  flex: 0 0 auto;
}

.snippets-add {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 14px;
  border: 1.5px dashed rgba(var(--fg-rgb), 0.22);
  border-radius: 10px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.snippets-add:hover,
.snippets-add:focus-visible {
  color: rgba(var(--fg-rgb), 0.9);
  border-color: rgba(var(--fg-rgb), 0.4);
  background: rgba(var(--fg-rgb), 0.04);
}
</style>
