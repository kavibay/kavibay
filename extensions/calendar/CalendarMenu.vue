<script setup lang="ts">
/** Widget ⋯ menu: ask the mounted Contract widget to refresh its query. */
import { inject } from "vue";
import { requestCalendarRefresh } from "./calendarLogic";

const injectedId = inject<string>("widgetInstanceId");
if (!injectedId) throw new Error("widgetInstanceId missing");
const instanceId: string = injectedId;

const closeWidgetMenu = inject<() => void>("closeWidgetMenu", () => {});

/** Ask the widget to refetch events, then close the menu. */
function onRefresh() {
  requestCalendarRefresh(instanceId);
  closeWidgetMenu();
}
</script>

<template>
  <button type="button" role="menuitem" class="cal-widget-menu-item" @click="onRefresh">
    <svg class="cal-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    Refresh
  </button>
</template>

<style scoped>
/* Match WidgetCard menu items (scoped styles do not cross component boundaries). */
.cal-widget-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.cal-widget-menu-item:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.cal-menu-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.75;
}
</style>
