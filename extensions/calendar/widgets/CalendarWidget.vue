<script setup lang="ts">
import { computed } from "vue";
import KavibaySelect from "@sdk/KavibaySelect.vue";
import type { CalendarModel } from "./calendar";
import { WEEKDAY_LABELS } from "./calendar";

const props = defineProps<{ model: CalendarModel }>();
const model = props.model;
const calendars = model.calendars;
const calendarLabel = model.calendarLabel;
const quickCalendarId = model.quickCalendarId;
const monthCells = model.monthCells;
const monthLabel = model.monthLabel;
const dayDots = model.dayDots;
const dayEvents = model.dayEvents;
const selectedDayKey = model.selectedDayKey;
const quickTitle = model.quickTitle;
const quickStartLocal = model.quickStartLocal;
const creating = model.creating;
const createError = model.createError;
const titleHint = model.titleHint;
const loading = model.loading;

const selectedDayLabel = computed(() => {
  const [year, month, day] = selectedDayKey.value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
});
</script>

<template>
  <div class="cal-widget" data-interactive @pointerdown.stop>
    <div class="cal-header">
      <div class="cal-calendar-legend" role="list" :aria-label="calendarLabel">
        <span
          v-for="calendar in calendars"
          :key="calendar.id"
          class="cal-calendar-chip"
          role="listitem"
          :title="calendar.name"
        >
          <span
            class="cal-calendar-dot"
            :style="{ background: model.calendarColor(calendar.id) ?? 'rgba(var(--fg-rgb), 0.5)' }"
            aria-hidden="true"
          />
          <span class="cal-calendar-name">{{ calendar.name }}</span>
        </span>
      </div>
      <span v-if="loading" class="cal-loading" aria-label="Loading">…</span>
    </div>

    <div class="cal-widget-body">
      <section class="cal-month" aria-label="Calendar month">
        <div class="cal-month-nav">
          <button type="button" class="cal-nav-btn" aria-label="Previous month" @click="model.prevMonth">
            ‹
          </button>
          <p class="cal-month-label">{{ monthLabel }}</p>
          <button type="button" class="cal-nav-btn" aria-label="Next month" @click="model.nextMonth">
            ›
          </button>
        </div>

        <div class="cal-weekdays" aria-hidden="true">
          <span v-for="weekday in WEEKDAY_LABELS" :key="weekday" class="cal-weekday">{{ weekday }}</span>
        </div>
        <div class="cal-grid">
          <button
            v-for="cell in monthCells"
            :key="cell.dateKey"
            type="button"
            class="cal-day"
            :class="{
              'cal-day--outside': !cell.inMonth,
              'cal-day--today': cell.isToday,
              'cal-day--selected': cell.dateKey === selectedDayKey,
            }"
            :aria-pressed="cell.dateKey === selectedDayKey"
            @click="model.selectDay(cell.dateKey)"
          >
            <span class="cal-day-num">{{ cell.day }}</span>
            <span v-if="dayDots.has(cell.dateKey)" class="cal-day-dots" aria-hidden="true">
              <span
                v-for="color in dayDots.get(cell.dateKey) ?? []"
                :key="color"
                class="cal-day-dot"
                :style="{ background: color }"
              />
            </span>
          </button>
        </div>
      </section>

      <section class="cal-agenda" aria-label="Selected day">
        <div class="cal-day-section">
          <p class="cal-day-heading">{{ selectedDayLabel }}</p>
          <p v-if="loading && dayEvents.length === 0" class="cal-hint">Loading…</p>
          <p v-else-if="dayEvents.length === 0" class="cal-hint">No events</p>
          <ul v-else class="cal-event-list" @wheel.stop>
            <li v-for="event in dayEvents" :key="`${event.calendarId}:${event.id}`" class="cal-event">
              <span
                class="cal-event-swatch"
                :style="{ background: model.calendarColor(event.calendarId) ?? event.color ?? 'rgba(var(--fg-rgb), 0.35)' }"
                aria-hidden="true"
              />
              <div class="cal-event-body">
                <p class="cal-event-time">{{ model.formatEventTime(event) }}</p>
                <p class="cal-event-title" :title="event.title">{{ event.title }}</p>
              </div>
              <button
                v-if="event.meetingUrl"
                type="button"
                class="cal-event-link"
                title="Join meeting"
                aria-label="Join meeting"
                @click="model.openMeeting(event.meetingUrl)"
              >
                ↗
              </button>
            </li>
          </ul>
        </div>

        <div class="cal-quick" @keyup.enter="model.quickAdd">
          <KavibaySelect
            v-if="calendars.length > 1"
            :model-value="quickCalendarId"
            :options="calendars.map((calendar) => ({ value: calendar.id, label: calendar.name }))"
            size="sm"
            placeholder="Add to…"
            aria-label="Calendar for new event"
            @update:model-value="quickCalendarId = String($event)"
          />
          <input
            v-model="quickTitle"
            class="cal-quick-title"
            type="text"
            placeholder="Add event…"
            spellcheck="false"
            :aria-invalid="titleHint"
            @input="titleHint = false"
          />
          <div class="cal-quick-row">
            <input
              v-model="quickStartLocal"
              class="cal-quick-start"
              type="datetime-local"
              aria-label="Start time"
            />
            <button type="button" class="cal-quick-submit" :disabled="creating" @click="model.quickAdd">
              {{ creating ? "…" : "Add" }}
            </button>
          </div>
          <p v-if="titleHint" class="cal-hint cal-hint--warn">Title is required</p>
          <p v-if="createError" class="cal-error">{{ createError }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.cal-widget {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 8px 10px 10px;
  box-sizing: border-box;
  container-type: inline-size;
}

.cal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 18px;
  margin-bottom: 4px;
}

.cal-loading {
  overflow: hidden;
  color: rgba(var(--fg-rgb), 0.5);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cal-calendar-legend {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: nowrap;
  gap: 8px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.cal-calendar-legend::-webkit-scrollbar {
  display: none;
}

.cal-calendar-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  max-width: 170px;
  padding: 1px 0;
  color: rgba(var(--fg-rgb), 0.68);
  font-size: 9px;
}

.cal-calendar-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
}

.cal-calendar-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-loading {
  color: rgba(var(--fg-rgb), 0.7);
}

.cal-widget-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  gap: 8px;
}

.cal-month,
.cal-agenda {
  min-width: 0;
  min-height: 0;
}

.cal-month-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cal-month-label {
  flex: 1;
  margin: 0;
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
  font-weight: 650;
  text-align: center;
}

.cal-nav-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.65);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.cal-nav-btn:hover,
.cal-day:hover,
.cal-day--selected {
  background: rgba(var(--fg-rgb), 0.1);
}

.cal-weekdays,
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.cal-weekdays {
  margin-top: 4px;
}

.cal-weekday {
  color: rgba(var(--fg-rgb), 0.4);
  font-size: 9px;
  font-weight: 600;
  text-align: center;
  text-transform: uppercase;
}

.cal-day {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 25px;
  padding: 2px 0 3px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.88);
  cursor: pointer;
}

.cal-day--outside {
  color: rgba(var(--fg-rgb), 0.27);
}

.cal-day--today .cal-day-num {
  font-weight: 700;
}

.cal-day-num {
  font-size: 11px;
  line-height: 1.2;
}

.cal-day-dots {
  display: flex;
  justify-content: center;
  gap: 2px;
  min-height: 4px;
  margin-top: 2px;
}

.cal-day-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
}

.cal-agenda {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 8px;
}

.cal-day-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 4px;
}

.cal-day-heading {
  margin: 0;
  color: rgba(var(--fg-rgb), 0.45);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.cal-hint,
.cal-error {
  margin: 0;
  color: rgba(var(--fg-rgb), 0.52);
  font-size: 11px;
  line-height: 1.35;
}

.cal-hint--warn,
.cal-error {
  color: #ff9090;
}

.cal-event-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 112px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.cal-event {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  min-width: 0;
  padding: 4px 3px;
  border-radius: 6px;
}

.cal-event:hover {
  background: rgba(var(--fg-rgb), 0.04);
}

.cal-event-swatch {
  width: 3px;
  min-height: 26px;
  flex-shrink: 0;
  border-radius: 2px;
}

.cal-event-body {
  min-width: 0;
  flex: 1;
}

.cal-event-time {
  margin: 0;
  color: rgba(var(--fg-rgb), 0.5);
  font-size: 10px;
}

.cal-event-title {
  margin: 1px 0 0;
  overflow: hidden;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 12px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-event-link {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  cursor: pointer;
}

.cal-event-link:hover {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.9);
}

.cal-quick {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 5px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
}

.cal-quick-title,
.cal-quick-start {
  box-sizing: border-box;
  min-width: 0;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 7px;
  outline: none;
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 11px;
}

.cal-quick-title {
  width: 100%;
  padding: 6px 8px;
}

.cal-quick-title::placeholder {
  color: rgba(var(--fg-rgb), 0.32);
}

.cal-quick-title:focus,
.cal-quick-start:focus {
  border-color: rgba(var(--fg-rgb), 0.28);
}

.cal-quick-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.cal-quick-start {
  flex: 1;
  padding: 5px;
  color-scheme: var(--native-color-scheme);
}

.cal-quick-submit {
  flex-shrink: 0;
  padding: 6px 9px;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  border-radius: 7px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.cal-quick-submit:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.14);
}

.cal-quick-submit:disabled {
  cursor: default;
  opacity: 0.45;
}

@container (min-width: 520px) {
  .cal-widget-body {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(200px, 2fr);
    align-items: stretch;
  }

  .cal-month {
    padding-right: 14px;
    border-right: 1px solid rgba(var(--fg-rgb), 0.09);
  }

  .cal-grid {
    grid-auto-rows: minmax(0, 1fr);
  }

  .cal-agenda {
    padding-left: 14px;
  }

  .cal-event-list {
    max-height: none;
  }
}
</style>
