<script setup lang="ts">
import { computed, inject } from "vue";
import { notesMenuAction, notesStateForInstance } from "./notes";

const instanceId = inject<string>("widgetInstanceId");
if (!instanceId) throw new Error("widgetInstanceId missing");

const closeWidgetMenu = inject<() => void>("closeWidgetMenu", () => {});
const action = computed(() => notesMenuAction(instanceId));
const state = notesStateForInstance(instanceId);

function onToggleToolbar() {
  action.value?.toggleToolbar();
  closeWidgetMenu();
}
</script>

<template>
  <button type="button" role="menuitem" class="notes-widget-menu-item" @click="onToggleToolbar">
    <svg class="notes-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7V4h16v3M9 20h6M12 4v16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    {{ state?.toolbarVisible ? "Hide formatting" : "Show formatting" }}
  </button>
</template>

<style scoped>
.notes-widget-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: none; border-radius: 8px; background: transparent; color: rgba(var(--fg-rgb), 0.9); font-size: 13px; text-align: left; cursor: pointer; }
.notes-widget-menu-item:hover { background: rgba(var(--fg-rgb), 0.08); }
.notes-menu-icon { width: 14px; height: 14px; flex-shrink: 0; opacity: 0.75; }
</style>
