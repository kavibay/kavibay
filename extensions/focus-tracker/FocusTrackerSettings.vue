<script setup lang="ts">
/**
 * Habit rules settings popover: list/delete rules and live-apply add form
 * with recent-app datalist suggestions.
 */
import { inject, onMounted, ref } from "vue";
import type { HabitRule, IgnoreRule } from "./focusTrackerLogic";
import { getFocusTrackerCapability } from "./widgets/focusTracker";

const instanceId = inject<string>("widgetInstanceId");
const capability = instanceId ? getFocusTrackerCapability(instanceId) : undefined;
const rules = ref<HabitRule[]>([]);
const recentApps = ref<string[]>([]);
const ignored = ref<IgnoreRule[]>([]);
const draftApp = ref("");
const draftLimit = ref(60);
const draftIgnoreKind = ref<IgnoreRule["kind"]>("app");
const draftIgnore = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

/** Load habit rules and recent apps for the datalist. */
async function load() {
  if (!capability) {
    error.value = "Focus Tracker capability unavailable";
    return;
  }
  try {
    const [nextRules, apps, nextIgnored] = await Promise.all([
      capability.listHabitRules<HabitRule[]>(),
      capability.recentApps<string[]>(20),
      capability.listIgnoreRules<IgnoreRule[]>(),
    ]);
    rules.value = nextRules;
    recentApps.value = apps;
    ignored.value = nextIgnored;
  } catch (cause) {
    error.value = String(cause);
  }
}

/** Add a persisted exclusion; summaries update immediately and new samples stop. */
async function onAddIgnore() {
  if (!capability) {
    error.value = "Focus Tracker capability unavailable";
    return;
  }
  const value = draftIgnore.value.trim();
  if (!value) {
    error.value = "Value required";
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await capability.upsertIgnoreRule(draftIgnoreKind.value, value);
    draftIgnore.value = "";
    await load();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}

async function onDeleteIgnore(id: number) {
  if (!capability) {
    error.value = "Focus Tracker capability unavailable";
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await capability.deleteIgnoreRule(id);
    await load();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}

/** Validate and upsert a habit rule (live-apply, no Save). */
async function onAdd() {
  if (!capability) {
    error.value = "Focus Tracker capability unavailable";
    return;
  }
  const appName = draftApp.value.trim();
  const limitMinutes = Number(draftLimit.value);
  if (!appName) {
    error.value = "App name required";
    return;
  }
  if (!Number.isFinite(limitMinutes) || limitMinutes < 1) {
    error.value = "Limit must be ≥ 1";
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await capability.upsertHabitRule<HabitRule>(appName, Math.floor(limitMinutes));
    draftApp.value = "";
    await load();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}

/** Delete a habit rule by id (live-apply). */
async function onDelete(id: number) {
  if (!capability) {
    error.value = "Focus Tracker capability unavailable";
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await capability.deleteHabitRule(id);
    await load();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="ft-settings" @pointerdown.stop>
    <label>
      Add habit limit
      <div class="ft-settings-add">
        <input
          v-model="draftApp"
          type="text"
          list="ft-recent-apps"
          placeholder="App name"
          maxlength="128"
          autocomplete="off"
          spellcheck="false"
          @keyup.enter="onAdd"
        />
        <datalist id="ft-recent-apps">
          <option v-for="app in recentApps" :key="app" :value="app" />
        </datalist>
        <input
          v-model.number="draftLimit"
          class="ft-settings-limit"
          type="number"
          min="1"
          step="1"
          v-tip="'Limit minutes'"
          aria-label="Limit minutes"
        />
        <button type="button" :disabled="busy || !draftApp.trim()" @click="onAdd">Add</button>
      </div>
    </label>
    <p v-if="error" class="ft-settings-error">{{ error }}</p>
    <p class="ft-settings-hint">Minutes per selected range · live apply</p>
    <ul class="ft-settings-list">
      <li v-for="rule in rules" :key="rule.id">
        <span class="ft-settings-app" :title="rule.app_name">{{ rule.app_name }}</span>
        <span class="ft-settings-mins">{{ rule.limit_minutes }}m</span>
        <button
          type="button"
          v-tip="'Remove'"
          :disabled="busy"
          @click="onDelete(rule.id)"
        >
          ×
        </button>
      </li>
      <li v-if="rules.length === 0" class="ft-settings-empty">No habit rules yet</li>
    </ul>

    <label>
      Ignore from tracking
      <div class="ft-settings-add">
        <select v-model="draftIgnoreKind" aria-label="Ignore type">
          <option value="app">App</option>
          <option value="title">Title</option>
        </select>
        <input
          v-model="draftIgnore"
          type="text"
          list="ft-recent-apps"
          :placeholder="draftIgnoreKind === 'app' ? 'App name' : 'Window title'"
          maxlength="256"
          autocomplete="off"
          spellcheck="false"
          @keyup.enter="onAddIgnore"
        />
        <button type="button" :disabled="busy || !draftIgnore.trim()" @click="onAddIgnore">Ignore</button>
      </div>
    </label>
    <p class="ft-settings-hint">Exact matches are hidden from new and existing totals.</p>
    <ul class="ft-settings-list">
      <li v-for="rule in ignored" :key="rule.id">
        <span class="ft-settings-kind">{{ rule.kind }}</span>
        <span class="ft-settings-app" :title="rule.value">{{ rule.value }}</span>
        <button type="button" v-tip="'Stop ignoring'" :disabled="busy" @click="onDeleteIgnore(rule.id)">×</button>
      </li>
      <li v-if="ignored.length === 0" class="ft-settings-empty">Nothing ignored yet</li>
    </ul>
  </div>
</template>

<style scoped>
.ft-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 240px;
}

.ft-settings label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.5);
}

.ft-settings-add {
  display: flex;
  gap: 6px;
}

.ft-settings-add input[type="text"] {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 14px;
  outline: none;
}

.ft-settings-add select {
  flex: 0 0 68px;
  min-width: 0;
  padding: 0 6px;
  border-radius: 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 12px;
}

.ft-settings-add input:focus {
  border-color: rgba(var(--fg-rgb), 0.28);
}

.ft-settings-limit {
  width: 64px;
  flex-shrink: 0;
  padding: 8px 6px;
  border-radius: 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  outline: none;
  text-align: center;
}

.ft-settings-add button {
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 13px;
  cursor: pointer;
}

.ft-settings-add button:disabled {
  opacity: 0.45;
  cursor: default;
}

.ft-settings-error {
  margin: 0;
  font-size: 12px;
  color: #ff8080;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
}

.ft-settings-hint {
  margin: 0;
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.4);
}

.ft-settings-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow: auto;
}

.ft-settings-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.04);
}

.ft-settings-app {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.9);
}

.ft-settings-mins {
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.55);
}

.ft-settings-kind {
  flex-shrink: 0;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.5);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.ft-settings-list button {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.ft-settings-list button:hover:not(:disabled) {
  color: rgba(var(--fg-rgb), 0.95);
  background: rgba(var(--fg-rgb), 0.08);
}

.ft-settings-list button:disabled {
  opacity: 0.3;
  cursor: default;
}

.ft-settings-empty {
  font-size: 12px;
  font-weight: 400;
  color: rgba(var(--fg-rgb), 0.45);
  background: transparent !important;
  padding-left: 2px !important;
}
</style>
