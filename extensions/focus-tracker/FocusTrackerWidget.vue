<script setup lang="ts">
/**
 * Focus Tracker widget: range/group toggles, habit callout, horizontal bars, status footer.
 * The Contract model owns the 5-second host-capability poll and its teardown.
 */
import { computed } from "vue";
import { EyeClosedIcon } from "@sdk/icons";
import {
  type FocusSummaryRow,
  barPercent,
  formatDuration,
  habitsOverLimit,
  topRows,
} from "./focusTrackerLogic";
import type { FocusTrackerModel } from "./widgets/focusTracker";

const props = defineProps<{ model: FocusTrackerModel }>();
const { range, groupBy, summary, status, error, loading, ignoringKey, setRange, setGroupBy, ignore } = props.model;

const RANGE_OPTIONS: { id: FocusTrackerModel["range"]["value"]; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const GROUP_OPTIONS: { id: FocusTrackerModel["groupBy"]["value"]; label: string }[] = [
  { id: "app", label: "By app" },
  { id: "title", label: "By title" },
];

/** Habits over limit for the current summary (callout). */
const overHabits = computed(() =>
  summary.value ? habitsOverLimit(summary.value.habits) : [],
);

/** Top chart rows + leftover count. */
const chart = computed(() =>
  summary.value ? topRows(summary.value.rows, 10) : { visible: [], moreCount: 0 },
);

/** Footer label from tracker status (neutral while first poll pending). */
const statusLabel = computed(() => {
  const s = status.value;
  if (!s) return "…";
  if (!s.available) return "Tracking unavailable";
  if (s.idle) return "Idle";
  if (s.tracking) return "Tracking";
  return "Idle";
});

/** Empty-state copy: tracker unavailable vs empty selected range. */
const emptyMessage = computed(() => {
  if (status.value && !status.value.available) return "Tracking unavailable";
  return "Nothing in this range";
});

/** Display label for a summary row (app or title grouping). */
function rowLabel(row: FocusSummaryRow): string {
  if (groupBy.value === "title") {
    const title = row.window_title.trim();
    return title || row.app_name;
  }
  return row.app_name;
}

/** Ignore an app, or the exact title when the title breakdown is active. */
async function ignoreRow(row: FocusSummaryRow) {
  const kind = groupBy.value;
  const value = kind === "app" ? row.app_name : row.window_title.trim();
  if (!value) return;
  void ignore(kind, value, row.key);
}
</script>

<template>
  <div class="focus-tracker">
    <div class="ft-controls" @pointerdown.stop>
      <div class="ft-seg" role="group" aria-label="Range">
        <button
          v-for="opt in RANGE_OPTIONS"
          :key="opt.id"
          type="button"
          class="ft-seg-btn"
          :class="{ 'ft-seg-btn--active': range === opt.id }"
          @click="setRange(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="ft-seg" role="group" aria-label="Group by">
        <button
          v-for="opt in GROUP_OPTIONS"
          :key="opt.id"
          type="button"
          class="ft-seg-btn"
          :class="{ 'ft-seg-btn--active': groupBy === opt.id }"
          @click="setGroupBy(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <div v-if="overHabits.length > 0" class="ft-habits" @pointerdown.stop>
      <p class="ft-habits-title">Over limit</p>
      <ul class="ft-habits-list">
        <li v-for="hit in overHabits" :key="hit.app_name" class="ft-habit">
          <span class="ft-habit-name">{{ hit.app_name }}</span>
          <span class="ft-habit-meta">
            {{ formatDuration(hit.duration_ms) }} / {{ formatDuration(hit.limit_minutes * 60_000) }}
          </span>
        </li>
      </ul>
    </div>

    <p v-if="error && !summary" class="ft-status ft-status--error">{{ error }}</p>
    <p v-else-if="loading && !summary" class="ft-status">Loading…</p>

    <ul v-else-if="chart.visible.length > 0" class="ft-list">
      <li v-for="row in chart.visible" :key="row.key" class="ft-row">
        <div class="ft-row-head">
          <span class="ft-row-label" :title="rowLabel(row)">{{ rowLabel(row) }}</span>
          <span class="ft-row-actions">
            <button
              v-if="groupBy === 'app' || row.window_title.trim()"
              type="button"
              class="ft-ignore"
              :disabled="ignoringKey !== null"
              :title="`Ignore this ${groupBy}`"
              :aria-label="`Ignore ${rowLabel(row)}`"
              @pointerdown.stop
              @click="ignoreRow(row)"
            >
              <EyeClosedIcon :size="14" />
            </button>
            <span class="ft-row-dur">{{ formatDuration(row.duration_ms) }}</span>
          </span>
        </div>
        <div class="ft-bar-track" aria-hidden="true">
          <div
            class="ft-bar-fill"
            :style="{ width: `${barPercent(row.duration_ms, summary?.total_ms ?? 0)}%` }"
          />
        </div>
      </li>
      <li v-if="chart.moreCount > 0" class="ft-more">+{{ chart.moreCount }} more</li>
    </ul>

    <p v-else class="ft-status">{{ emptyMessage }}</p>

    <p v-if="error && summary" class="ft-status ft-status--error ft-status--inline">{{ error }}</p>

    <footer class="ft-footer">
      <span
        class="ft-footer-dot"
        :class="{
          'ft-footer-dot--on': statusLabel === 'Tracking',
          'ft-footer-dot--idle': statusLabel === 'Idle',
          'ft-footer-dot--off': statusLabel === 'Tracking unavailable',
        }"
      />
      <span>{{ statusLabel }}</span>
      <span v-if="summary" class="ft-footer-total">{{ formatDuration(summary.total_ms) }}</span>
    </footer>
  </div>
</template>

<style scoped>
.focus-tracker {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: rgba(var(--fg-rgb), 0.92);
  overflow: hidden;
}

.ft-controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ft-seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: rgba(var(--fg-rgb), 0.06);
  border: 1px solid rgba(var(--fg-rgb), 0.08);
}

.ft-seg-btn {
  flex: 1;
  margin: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
}

.ft-seg-btn:hover {
  color: rgba(var(--fg-rgb), 0.85);
  background: rgba(var(--fg-rgb), 0.05);
}

.ft-seg-btn--active {
  color: rgba(var(--fg-rgb), 0.95);
  background: rgba(var(--fg-rgb), 0.12);
}

.ft-habits {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 130, 130, 0.1);
  border: 1px solid rgba(255, 130, 130, 0.22);
}

.ft-habits-title {
  margin: 0 0 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 160, 160, 0.9);
}

.ft-habits-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ft-habit {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.ft-habit-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.9);
}

.ft-habit-meta {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 160, 160, 0.95);
}

.ft-status {
  margin: 0;
  flex: 1 1 auto;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.55);
}

.ft-status--error {
  color: #ff8080;
}

.ft-status--inline {
  font-size: 12px;
}

.ft-list {
  list-style: none;
  margin: 0;
  padding: 0 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.ft-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ft-row-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.ft-row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.ft-row-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.88);
}

.ft-row-dur {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.5);
}

.ft-ignore {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.45);
  cursor: pointer;
  opacity: 0;
}

.ft-row:hover .ft-ignore,
.ft-ignore:focus-visible {
  opacity: 1;
}

.ft-ignore:hover:not(:disabled) {
  color: rgba(var(--fg-rgb), 0.9);
  background: rgba(var(--fg-rgb), 0.09);
}

.ft-ignore:disabled {
  cursor: default;
  opacity: 0.4;
}

.ft-bar-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.08);
  overflow: hidden;
}

.ft-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: rgba(147, 197, 253, 0.75);
  min-width: 0;
}

.ft-more {
  margin: 0;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.45);
}

.ft-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  flex-shrink: 0;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.5);
}

.ft-footer-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.35);
  flex-shrink: 0;
}

.ft-footer-dot--on {
  background: rgba(120, 220, 160, 0.95);
}

.ft-footer-dot--idle {
  background: rgba(251, 191, 36, 0.9);
}

.ft-footer-dot--off {
  background: rgba(255, 130, 130, 0.85);
}

.ft-footer-total {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.45);
}
</style>
