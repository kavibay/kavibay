<script setup lang="ts">
import { computed, inject } from "vue";
import { hasCompleted } from "../todoLogic";
import { todoMenuAction, todoStateForInstance } from "./todo";

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");

const closeWidgetMenu = inject<() => void>("closeWidgetMenu", () => {});
const action = computed(() => todoMenuAction(instanceId));
const state = todoStateForInstance(instanceId);
const canClear = computed(() => Boolean(action.value && state && hasCompleted(state.value.items)));

function onClearCompleted() {
  action.value?.clearCompleted();
  closeWidgetMenu();
}
</script>

<template>
  <button
    type="button"
    role="menuitem"
    class="todo-widget-menu-item"
    :disabled="!canClear"
    @click="onClearCompleted"
  >
    <svg class="todo-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
    Clear completed
  </button>
</template>

<style scoped>
.todo-widget-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: none; border-radius: 8px; background: transparent; color: rgba(var(--fg-rgb), 0.9); font-size: 13px; text-align: left; cursor: pointer; }
.todo-widget-menu-item:hover:not(:disabled) { background: rgba(var(--fg-rgb), 0.08); }
.todo-widget-menu-item:disabled { opacity: 0.4; cursor: default; }
.todo-menu-icon { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.75; }
</style>
