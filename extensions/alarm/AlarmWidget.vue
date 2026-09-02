<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  ALARM_NOTIFY_OPTIONS,
  type AlarmNotifyMode,
  formatAlarmTime,
} from "./alarmLogic";
import type { AlarmModel } from "./widgets/alarm";

const props = defineProps<{ model: AlarmModel }>();

const {
  alarms,
  ringingIds,
  addAlarm,
  removeAlarm,
  toggleEnabled,
  setAlarmTimeFromString,
  setAlarmLabel,
  setAlarmNotifyMode,
  dismiss,
} = props.model;

/** Local HH:MM drafts keyed by alarm id for inline edit. */
const timeDrafts = ref<Record<string, string>>({});

/** Open notifier menu for this alarm id (null = closed). */
const notifyMenuId = ref<string | null>(null);
const notifyTriggerEl = ref<HTMLElement | null>(null);
const notifyMenuEl = ref<HTMLElement | null>(null);
const notifyMenuStyle = ref<Record<string, string>>({});

const notifyAlarm = computed(
  () => alarms.value.find((alarm) => alarm.id === notifyMenuId.value) ?? null,
);

function syncTimeDrafts() {
  const next: Record<string, string> = {};
  for (const alarm of alarms.value) {
    next[alarm.id] = formatAlarmTime(alarm.hours, alarm.minutes);
  }
  timeDrafts.value = next;
}

watch(alarms, syncTimeDrafts, { immediate: true, deep: true });

/** Commit time draft on blur or Enter; revert draft if invalid. */
function commitTime(alarmId: string) {
  const draft = timeDrafts.value[alarmId];
  if (draft == null) return;
  setAlarmTimeFromString(alarmId, draft);
  const alarm = alarms.value.find((item) => item.id === alarmId);
  if (alarm) timeDrafts.value[alarmId] = formatAlarmTime(alarm.hours, alarm.minutes);
}

/** Anchor the teleported menu under (or above) the bell trigger. */
function placeNotifyMenu() {
  const trigger = notifyTriggerEl.value;
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  const width = 156;
  let left = r.right - width;
  if (left < 8) left = 8;
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - 8 - width);
  }

  const estimatedHeight = 148;
  const gap = 4;
  const spaceBelow = window.innerHeight - r.bottom - 8;
  const placeAbove = spaceBelow < estimatedHeight && r.top > spaceBelow;

  notifyMenuStyle.value = placeAbove
    ? {
        position: "fixed",
        left: `${left}px`,
        bottom: `${Math.max(8, window.innerHeight - r.top + gap)}px`,
        width: `${width}px`,
        zIndex: "10000",
      }
    : {
        position: "fixed",
        left: `${left}px`,
        top: `${r.bottom + gap}px`,
        width: `${width}px`,
        zIndex: "10000",
      };
}

/** Close the teleported notify menu. */
async function closeNotifyMenu() {
  if (notifyMenuId.value == null) return;
  notifyMenuId.value = null;
  notifyTriggerEl.value = null;
  await nextTick();
}

/** Open / close the notifier menu for one alarm. */
async function toggleNotifyMenu(alarmId: string, event: MouseEvent) {
  if (notifyMenuId.value === alarmId) {
    await closeNotifyMenu();
    return;
  }
  notifyTriggerEl.value = event.currentTarget as HTMLElement;
  notifyMenuId.value = alarmId;
  await nextTick();
  placeNotifyMenu();
}

/** Persist a notify mode and close the menu. */
async function pickNotifyMode(alarmId: string, mode: AlarmNotifyMode) {
  setAlarmNotifyMode(alarmId, mode);
  await closeNotifyMenu();
}

/** Tooltip / aria for the current notify mode. */
function notifyModeLabel(mode: AlarmNotifyMode): string {
  return ALARM_NOTIFY_OPTIONS.find((opt) => opt.mode === mode)?.label ?? "Notify";
}

/** Close notifier menu on outside pointer / Escape. */
function onDocPointerDown(event: PointerEvent) {
  if (notifyMenuId.value == null) return;
  const target = event.target as Node;
  if (notifyTriggerEl.value?.contains(target) || notifyMenuEl.value?.contains(target)) {
    return;
  }
  void closeNotifyMenu();
}

function onDocKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && notifyMenuId.value != null) {
    void closeNotifyMenu();
    event.stopPropagation();
  }
}

function onViewportChange() {
  if (notifyMenuId.value != null) placeNotifyMenu();
}

watch(notifyMenuId, (id, _prev, onCleanup) => {
  if (id == null) return;
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
  onCleanup(() => {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeydown, true);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
  });
});

onBeforeUnmount(() => {
  notifyMenuId.value = null;
});
</script>

<template>
  <!-- Stop propagation so card drag does not steal focus from inputs/toggles. -->
  <div class="alarm" @pointerdown.stop>
    <!-- List scrolls inside the card; dashed Add sits as the last row. -->
    <ul class="alarm-list" aria-label="Alarms" @wheel.stop>
      <li
        v-for="alarm in alarms"
        :key="alarm.id"
        class="alarm-row"
        :class="{ 'alarm-row--ringing': ringingIds.includes(alarm.id) }"
      >
        <div class="alarm-row-main">
          <input
            v-model="timeDrafts[alarm.id]"
            class="alarm-time"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            aria-label="Alarm time"
            @blur="commitTime(alarm.id)"
            @keydown.enter.prevent="($event.target as HTMLInputElement)?.blur()"
          />
          <input
            :value="alarm.label"
            class="alarm-label"
            type="text"
            placeholder="Label"
            autocomplete="off"
            spellcheck="false"
            aria-label="Alarm label"
            @input="setAlarmLabel(alarm.id, ($event.target as HTMLInputElement).value)"
          />

          <button
            type="button"
            class="alarm-icon-btn"
            :class="{ 'alarm-icon-btn--open': notifyMenuId === alarm.id }"
            v-tip="notifyModeLabel(alarm.notifyMode)"
            :aria-label="`Notify: ${notifyModeLabel(alarm.notifyMode)}`"
            aria-haspopup="menu"
            :aria-expanded="notifyMenuId === alarm.id"
            @click="toggleNotifyMenu(alarm.id, $event)"
          >
            <!-- Bell: glanceable notifier control. -->
            <svg
              class="alarm-bell"
              viewBox="0 0 24 24"
              width="15"
              height="15"
              aria-hidden="true"
            >
              <path
                d="M6 9a6 6 0 1 1 12 0c0 3.2.8 4.8 1.5 6H4.5C5.2 13.8 6 12.2 6 9z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linejoin="round"
              />
              <path
                d="M10 19a2 2 0 0 0 4 0"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
              />
            </svg>
          </button>

          <label class="alarm-toggle" v-tip="alarm.enabled ? 'Enabled' : 'Disabled'">
            <input
              type="checkbox"
              :checked="alarm.enabled"
              @change="toggleEnabled(alarm.id)"
            />
            <span class="alarm-toggle-ui" aria-hidden="true" />
          </label>

          <button
            type="button"
            class="alarm-delete"
            v-tip="'Delete alarm'"
            aria-label="Delete alarm"
            @click="removeAlarm(alarm.id)"
          >
            <!-- Todo filled trash, split so the lid can hinge open on hover. -->
            <svg
              class="alarm-trash"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <g class="alarm-trash-lid">
                <path
                  fill="currentColor"
                  d="M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                />
              </g>
              <path
                fill="currentColor"
                d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z"
              />
            </svg>
          </button>
        </div>

        <button
          v-if="ringingIds.includes(alarm.id)"
          type="button"
          class="alarm-btn alarm-btn--accent"
          @click="dismiss(alarm.id)"
        >
          Dismiss
        </button>
      </li>

      <li class="alarm-add-item">
        <button type="button" class="alarm-add" @click="addAlarm">
          Add alarm
        </button>
      </li>
    </ul>

    <!-- Float above the scroll list so options are never clipped. -->
    <Teleport to="body">
      <div
        v-if="notifyMenuId && notifyAlarm"
        ref="notifyMenuEl"
        class="alarm-notify-menu"
        role="menu"
        aria-label="Notify mode"
        data-interactive
        :style="notifyMenuStyle"
        @pointerdown.stop
      >
        <button
          v-for="opt in ALARM_NOTIFY_OPTIONS"
          :key="opt.mode"
          type="button"
          role="menuitemradio"
          class="alarm-notify-item"
          :class="{ 'alarm-notify-item--active': notifyAlarm.notifyMode === opt.mode }"
          :aria-checked="notifyAlarm.notifyMode === opt.mode"
          @click="pickNotifyMode(notifyAlarm.id, opt.mode)"
        >
          <span class="alarm-notify-check" aria-hidden="true">
            {{ notifyAlarm.notifyMode === opt.mode ? "✓" : "" }}
          </span>
          {{ opt.label }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.alarm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 220px;
  min-height: 0;
  color: rgba(var(--fg-rgb), 0.92);
}

.alarm-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alarm-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(var(--fg-rgb), 0.06);
}

.alarm-row--ringing {
  border-color: rgba(224, 122, 95, 0.55);
  background: rgba(224, 122, 95, 0.12);
}

.alarm-row-main {
  display: grid;
  grid-template-columns: 72px 1fr auto auto auto;
  gap: 6px;
  align-items: center;
}

.alarm-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.42);
  cursor: pointer;
}

.alarm-icon-btn:hover,
.alarm-icon-btn:focus-visible,
.alarm-icon-btn--open {
  color: rgba(var(--fg-rgb), 0.9);
  background: rgba(var(--fg-rgb), 0.08);
}

.alarm-notify-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(var(--surface-bg-rgb), 0.97);
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  backdrop-filter: var(--surface-backdrop-filter, blur(14px));
  color: rgba(var(--fg-rgb), 0.92);
}

.alarm-notify-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 7px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.82);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.alarm-notify-item:hover,
.alarm-notify-item:focus-visible {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.95);
}

.alarm-notify-item--active {
  color: rgba(var(--fg-rgb), 0.95);
}

.alarm-notify-check {
  width: 12px;
  flex: 0 0 12px;
  font-size: 11px;
  line-height: 1;
  color: #5fad8c;
}

/* Match Todo delete chrome; keep lid open/close on hover. */
.alarm-delete {
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
  flex-shrink: 0;
}

.alarm-delete:hover,
.alarm-delete:focus-visible {
  color: rgba(var(--fg-rgb), 0.85);
  background: rgba(var(--fg-rgb), 0.08);
}

.alarm-trash {
  overflow: visible;
  display: block;
}

.alarm-trash-lid {
  transform-origin: 5px 5px;
  transition: transform 0.16s ease;
}

.alarm-delete:hover .alarm-trash-lid,
.alarm-delete:focus-visible .alarm-trash-lid {
  transform: rotate(-28deg) translate(-0.5px, -1px);
}

.alarm-time {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.95);
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  outline: none;
}

.alarm-row--ringing .alarm-time {
  color: #e07a5f;
  border-color: rgba(224, 122, 95, 0.45);
}

.alarm-time:focus {
  border-color: rgba(var(--fg-rgb), 0.28);
}

.alarm-label {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.85);
  font-size: 13px;
  outline: none;
}

.alarm-label:focus {
  border-color: rgba(var(--fg-rgb), 0.28);
}

.alarm-label::placeholder {
  color: rgba(var(--fg-rgb), 0.35);
}

.alarm-toggle {
  position: relative;
  display: inline-flex;
  cursor: pointer;
}

.alarm-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.alarm-toggle-ui {
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.15);
  transition: background 0.15s ease;
  position: relative;
}

.alarm-toggle-ui::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.85);
  transition: transform 0.15s ease;
}

.alarm-toggle input:checked + .alarm-toggle-ui {
  background: #5fad8c;
}

.alarm-toggle input:checked + .alarm-toggle-ui::after {
  transform: translateX(16px);
}

.alarm-add-item {
  flex: 0 0 auto;
}

.alarm-add {
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

.alarm-add:hover,
.alarm-add:focus-visible {
  color: rgba(var(--fg-rgb), 0.9);
  border-color: rgba(var(--fg-rgb), 0.4);
  background: rgba(var(--fg-rgb), 0.04);
}

.alarm-btn {
  width: 100%;
  flex: 0 0 auto;
  padding: 10px 14px;
  border: none;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.alarm-btn--accent {
  background: #e07a5f;
  color: #fff;
}
</style>
