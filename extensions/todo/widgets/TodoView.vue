<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, type ComputedRef } from "vue";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches, type WidgetSurface } from "@sdk";
import { placementFromYRatio, type DropPlacement } from "../todoLogic";
import type { TodoModel } from "./todo";

const props = defineProps<{ model: TodoModel }>();
const widgetSurface = inject<WidgetSurface>("widgetSurface", "desk");
const hostSized = inject<ComputedRef<boolean>>("widgetHostSized", computed(() => false));
const rootEl = ref<HTMLElement | null>(null);
const draggingId = ref<string | null>(null);
const dropTargetId = ref<string | null>(null);
const dropPlacement = ref<DropPlacement | null>(null);
const dragPointerId = ref<number | null>(null);
const dragHandle = ref<HTMLElement | null>(null);
let dragGhost: { element: HTMLElement; offsetX: number; offsetY: number; scale: number } | null = null;
// A flat list has nothing to collapse, so it does not reserve the chevron column.
const hasNesting = computed(() => props.model.rows.value.some((row) => row.hasChildren));

const rootStyle = computed(() =>
  hostSized.value
    ? { width: "100%", height: "100%" }
    : { width: `${props.model.state.value.width}px`, height: `${props.model.state.value.height}px` },
);

function focusRow(id: string, end = false) {
  void nextTick(() => {
    const input = rootEl.value?.querySelector<HTMLInputElement>(`input[data-todo-id="${CSS.escape(id)}"]`);
    if (!input) return;
    input.focus();
    if (end) input.setSelectionRange(input.value.length, input.value.length);
    else input.select();
  });
}

function visibleIndex(id: string) {
  return props.model.rows.value.findIndex((row) => row.id === id);
}

function onInputKeydown(event: KeyboardEvent, id: string) {
  const item = props.model.itemById.value.get(id);
  if (!item) return;
  const input = event.target as HTMLInputElement;
  const caret = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? caret;
  const mod = event.metaKey || event.ctrlKey;

  if (event.key === "Enter" && mod) {
    event.preventDefault();
    props.model.setDoneToggle(id);
    focusRow(id, true);
  } else if (event.key === "Enter") {
    event.preventDefault();
    focusRow(props.model.addAfter(id));
  } else if (event.key === "Tab") {
    event.preventDefault();
    if (event.shiftKey) props.model.outdent(id);
    else props.model.indent(id);
    focusRow(id, true);
  } else if (event.key === "Escape") {
    event.preventDefault();
    input.blur();
  } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && mod) {
    event.preventDefault();
    props.model.moveSibling(id, event.key === "ArrowUp" ? -1 : 1);
    focusRow(id, true);
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const next = props.model.rows.value[visibleIndex(id) + (event.key === "ArrowUp" ? -1 : 1)];
    if (next) focusRow(next.id, true);
  } else if (event.key === "ArrowLeft" && caret === 0 && caret === end) {
    const row = props.model.rows.value.find((entry) => entry.id === id);
    if (row?.hasChildren && !row.collapsed) {
      event.preventDefault();
      props.model.setCollapsedToggle(id);
      focusRow(id, true);
    }
  } else if (event.key === "ArrowRight" && end === input.value.length && caret === end) {
    const row = props.model.rows.value.find((entry) => entry.id === id);
    if (row?.hasChildren && row.collapsed) {
      event.preventDefault();
      props.model.setCollapsedToggle(id);
      focusRow(id, true);
    }
  } else if (event.key === "Backspace" && item.text === "") {
    event.preventDefault();
    const index = visibleIndex(id);
    const previous = props.model.rows.value[index - 1];
    props.model.remove(id);
    if (previous) focusRow(previous.id, true);
  }
}

function updateDropTarget(clientX: number, clientY: number) {
  const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-todo-row]");
  const id = element?.dataset.todoRow;
  if (!element || !rootEl.value?.contains(element) || !id || id === draggingId.value) {
    dropTargetId.value = null;
    dropPlacement.value = null;
    return;
  }
  const bounds = element.getBoundingClientRect();
  const ratio = bounds.height > 0 ? (clientY - bounds.top) / bounds.height : 0.5;
  dropTargetId.value = id;
  dropPlacement.value = placementFromYRatio(ratio);
}

function stopPointerDrag() {
  const pointerId = dragPointerId.value;
  dragPointerId.value = null;
  dragGhost?.element.remove();
  dragGhost = null;
  if (pointerId !== null) {
    window.removeEventListener("pointermove", onPointerDragMove);
    window.removeEventListener("pointerup", onPointerDragUp);
    window.removeEventListener("pointercancel", onPointerDragCancel);
    window.removeEventListener("blur", stopPointerDrag);
    window.removeEventListener("keydown", onDragKeydown, true);
    if (dragHandle.value?.hasPointerCapture(pointerId)) dragHandle.value.releasePointerCapture(pointerId);
  }
  dragHandle.value = null;
  draggingId.value = null;
  dropTargetId.value = null;
  dropPlacement.value = null;
}

/** Move the snapshot in viewport coordinates, preserving widget zoom and the grab point. */
function positionDragGhost(clientX: number, clientY: number) {
  if (!dragGhost) return;
  dragGhost.element.style.transform = `translate(${clientX - dragGhost.offsetX}px, ${clientY - dragGhost.offsetY}px) scale(${dragGhost.scale})`;
}

function onPointerDragDown(event: PointerEvent, id: string) {
  if (event.button !== 0 || !event.isPrimary || dragPointerId.value !== null) return;
  const handle = event.currentTarget as HTMLElement;
  const row = handle.closest<HTMLElement>("[data-todo-row]");
  if (!row) return;
  const bounds = row.getBoundingClientRect();
  const style = getComputedStyle(row);
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-todo-row");
  ghost.classList.add("todo-drag-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: "fixed", left: "0", top: "0", width: `${row.offsetWidth}px`,
    height: `${row.offsetHeight}px`, boxSizing: "border-box", transformOrigin: "top left",
    font: style.font, color: style.color,
  });
  for (const token of ["--fg-rgb", "--surface-bg-rgb", "--todo-rail"]) {
    ghost.style.setProperty(token, style.getPropertyValue(token));
  }
  // Keep scoped styles available when the widget lives in an embed's shadow root.
  const tree = row.getRootNode();
  (tree instanceof ShadowRoot ? tree : document.body).appendChild(ghost);
  dragGhost = { element: ghost, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, scale: bounds.width / row.offsetWidth };
  positionDragGhost(event.clientX, event.clientY);
  event.preventDefault();
  dragPointerId.value = event.pointerId;
  dragHandle.value = handle;
  draggingId.value = id;
  dragHandle.value.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", onPointerDragMove);
  window.addEventListener("pointerup", onPointerDragUp);
  window.addEventListener("pointercancel", onPointerDragCancel);
  window.addEventListener("blur", stopPointerDrag);
  window.addEventListener("keydown", onDragKeydown, true);
}

function onPointerDragMove(event: PointerEvent) {
  if (event.pointerId !== dragPointerId.value) return;
  event.preventDefault();
  positionDragGhost(event.clientX, event.clientY);
  updateDropTarget(event.clientX, event.clientY);
}

function onPointerDragUp(event: PointerEvent) {
  if (event.pointerId !== dragPointerId.value) return;
  event.preventDefault();
  updateDropTarget(event.clientX, event.clientY);
  const from = draggingId.value;
  const target = dropTargetId.value;
  const placement = dropPlacement.value;
  try {
    if (from && target && placement) props.model.move(from, target, placement);
  } finally {
    stopPointerDrag();
  }
}

function onPointerDragCancel(event: PointerEvent) {
  if (event.pointerId === dragPointerId.value) stopPointerDrag();
}

/** Escape cancels the move without changing the list. */
function onDragKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  stopPointerDrag();
}

function onFocusRequest(event: Event) {
  const detail = (event as CustomEvent<{ instanceId?: string; surface?: WidgetSurface }>).detail;
  if (!detail || !widgetFocusRequestMatches(event, detail.instanceId ?? "", widgetSurface)) return;
  const empty = props.model.state.value.items.find((item) => !item.text.trim());
  focusRow(empty?.id ?? props.model.rows.value[0]?.id ?? props.model.state.value.items[0]!.id);
}

onMounted(() => window.addEventListener(WIDGET_FOCUS_EVENT, onFocusRequest));
onBeforeUnmount(() => {
  window.removeEventListener(WIDGET_FOCUS_EVENT, onFocusRequest);
  stopPointerDrag();
});
</script>

<template>
  <div ref="rootEl" class="todo-widget" :class="{ 'todo-widget--inline': widgetSurface === 'inline', 'todo-widget--dragging': draggingId !== null }" :style="rootStyle" data-interactive @pointerdown.stop>
    <ul class="todo-list" @wheel.stop>
      <li
        v-for="row in model.rows.value"
        :key="row.id"
        class="todo-row"
        :class="{
          'todo-row--done': model.itemById.value.get(row.id)?.done,
          'todo-row--dragging': draggingId === row.id,
          'todo-row--drop-target': dropTargetId === row.id,
        }"
        :style="{ '--todo-depth': row.depth }"
        :data-todo-row="row.id"
      >
        <button
          v-if="row.hasChildren"
          type="button"
          class="todo-chevron"
          :class="{ 'todo-chevron--collapsed': row.collapsed }"
          :aria-label="row.collapsed ? 'Expand' : 'Collapse'"
          :aria-expanded="!row.collapsed"
          @click="model.setCollapsedToggle(row.id)"
        >
          <svg class="todo-chevron-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        <span v-else-if="hasNesting" class="todo-chevron-spacer" aria-hidden="true" />
        <button type="button" class="todo-check" aria-label="Toggle completed" :aria-pressed="model.itemById.value.get(row.id)?.done === true" @click="model.setDoneToggle(row.id)">
          <span class="todo-check-box" :class="{ checked: model.itemById.value.get(row.id)?.done }">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 7.5 3 3 6-6" /></svg>
          </span>
        </button>
        <input
          class="todo-input"
          type="text"
          :data-todo-id="row.id"
          :value="model.itemById.value.get(row.id)?.text ?? ''"
          placeholder="To-do"
          spellcheck="false"
          @input="model.setText(row.id, ($event.target as HTMLInputElement).value)"
          @keydown="onInputKeydown($event, row.id)"
        />
        <button type="button" class="todo-delete" aria-label="Delete" @click="model.remove(row.id)">×</button>
        <span
          class="todo-grip"
          aria-hidden="true"
          @pointerdown.stop="onPointerDragDown($event, row.id)"
          @lostpointercapture="onPointerDragCancel"
        >⠿</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.todo-widget { display: flex; flex-direction: column; min-width: 0; min-height: 0; box-sizing: border-box; color: rgba(var(--fg-rgb), 0.92); --todo-rail: 0px; }
.todo-widget--inline { --todo-rail: 21px; }
.todo-list { list-style: none; margin: 0; padding: 0; flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 1px; }
.todo-row { position: relative; display: flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 4px 2px calc(var(--todo-rail) + var(--todo-depth, 0) * 14px); border-radius: 6px; }
.todo-row:hover, .todo-row:focus-within { background: rgba(var(--fg-rgb), 0.05); }
.todo-row--dragging { opacity: 0.45; }
.todo-drag-ghost { z-index: 2147483647; pointer-events: none; opacity: 0.9; background: rgb(var(--surface-bg-rgb)); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25); }
.todo-drag-ghost .todo-grip { opacity: 1; }
.todo-row--drop-target { outline: 1px solid rgba(var(--fg-rgb), 0.25); outline-offset: -1px; background: rgba(var(--fg-rgb), 0.08); }
.todo-widget--dragging, .todo-widget--dragging * { cursor: grabbing !important; }
.todo-grip { flex-shrink: 0; display: grid; place-items: center; width: 18px; height: 18px; line-height: 1; color: rgba(var(--fg-rgb), 0.38); cursor: grab; user-select: none; touch-action: none; opacity: 0; transition: opacity 0.12s ease; }
.todo-row:hover .todo-grip, .todo-row:focus-within .todo-grip, .todo-row--dragging .todo-grip { opacity: 1; }
.todo-grip:hover { color: rgba(var(--fg-rgb), 0.7); }
.todo-grip:active { cursor: grabbing; }
@media (hover: none) { .todo-grip { opacity: 1; } }
.todo-chevron, .todo-chevron-spacer { width: 16px; height: 20px; flex-shrink: 0; }
.todo-chevron { display: grid; place-items: center; padding: 0; border: 0; border-radius: 4px; background: transparent; color: rgba(var(--fg-rgb), 0.58); cursor: pointer; }
.todo-chevron-icon { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.15s ease, color 0.15s ease; }
.todo-chevron--collapsed .todo-chevron-icon { transform: rotate(-90deg); }
.todo-chevron:hover { background: rgba(var(--fg-rgb), 0.08); }
.todo-chevron:hover .todo-chevron-icon { color: rgba(var(--fg-rgb), 0.9); }
.todo-chevron:focus-visible { outline: 1px solid rgba(var(--fg-rgb), 0.55); outline-offset: 1px; }
.todo-check { flex-shrink: 0; display: grid; place-items: center; border: 0; background: transparent; padding: 2px 0; cursor: pointer; }
.todo-check:focus-visible { outline: 1px solid rgba(var(--fg-rgb), 0.55); outline-offset: 1px; border-radius: 6px; }
.todo-check-box { display: grid; place-items: center; box-sizing: border-box; width: 18px; height: 18px; border: 1px solid rgba(var(--fg-rgb), 0.35); border-radius: 6px; }
.todo-check-box svg { width: 14px; height: 14px; fill: none; stroke: rgb(var(--surface-bg-rgb)); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; visibility: hidden; }
.todo-check-box.checked { background: rgb(var(--fg-rgb)); border-color: rgb(var(--fg-rgb)); }
.todo-check-box.checked svg { visibility: visible; }
.todo-input { flex: 1; min-width: 0; border: 0; outline: 0; padding: 3px 0; background: transparent; color: inherit; font: inherit; font-size: 13px; }
.todo-row--done .todo-input { color: rgba(var(--fg-rgb), 0.4); text-decoration: line-through; }
.todo-input::placeholder { color: rgba(var(--fg-rgb), 0.3); }
.todo-delete { flex-shrink: 0; display: grid; place-items: center; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: rgba(var(--fg-rgb), 0.35); font-size: 16px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.12s ease; }
.todo-row:hover .todo-delete, .todo-row:focus-within .todo-delete { opacity: 1; }
.todo-delete:hover { color: rgba(var(--fg-rgb), 0.85); background: rgba(var(--fg-rgb), 0.08); }
.todo-delete:focus-visible { outline: 1px solid rgba(var(--fg-rgb), 0.55); outline-offset: 1px; }
</style>
