<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import {
  elapsedTimeLabel,
  formatPercent,
  formatReset,
  presentUsageWindow,
  statusLabel,
  timeProgressPercent,
  usagePercent,
  usageTone,
} from "./aiUsageLogic";
import type { PresentedUsageWindow } from "./aiUsageLogic";
import type { AiUsageModel, UsageSource } from "./widgets/aiUsage";

const props = defineProps<{ model: AiUsageModel }>();
const { data, loading, enablingClaude, error } = props.model;
const nowMs = ref(Date.now());
const demoMode = ref(false);
const demoResetAtMs = ref<number | null>(null);
const demoClaudeSessionResetAtMs = ref<number | null>(null);
const notificationEnabled = reactive<Record<string, boolean>>({});
const lastNotifiedReset = new Map<string, number>();
const enabledProviders = computed(() => {
  const providers = [] as const;
  return [
    ...(props.model.settings.codexEnabled ? (["codex"] as const) : providers),
    ...(props.model.settings.claudeEnabled ? (["claude"] as const) : providers),
  ];
});
const displayData = computed(() => {
  if (!data.value) return null;
  const present = (provider: "codex" | "claude") =>
    data.value![provider].windows.map((window) => {
      const isDemoCodex = demoMode.value && provider === "codex";
      const isDemoClaudeSession =
        demoMode.value &&
        provider === "claude" &&
        (window.id === "five_hour" || window.label === "5 hours");
      const demoWindow = isDemoCodex
        ? { ...window, usedPercent: 100 }
        : isDemoClaudeSession
          ? { ...window, usedPercent: 94 }
          : window;
      return presentUsageWindow(
        demoWindow,
        nowMs.value,
        isDemoCodex
          ? demoResetAtMs.value ?? undefined
          : isDemoClaudeSession
            ? demoClaudeSessionResetAtMs.value ?? undefined
            : undefined,
      );
    });
  return {
    ...data.value,
    codex: { ...data.value.codex, windows: present("codex") },
    claude: { ...data.value.claude, windows: present("claude") },
  };
});

const clock = window.setInterval(() => {
  nowMs.value = Date.now();
}, 100);
onScopeDispose(() => window.clearInterval(clock));

function toggleDemoMode() {
  demoMode.value = !demoMode.value;
  demoResetAtMs.value = demoMode.value ? Date.now() + 5_000 : null;
  demoClaudeSessionResetAtMs.value = demoMode.value ? Date.now() + 15 * 60_000 : null;
  nowMs.value = Date.now();
}

function notificationKey(provider: "codex" | "claude", windowId: string): string {
  return `${provider}:${windowId}`;
}

function isNotificationEnabled(provider: "codex" | "claude", windowId: string): boolean {
  return notificationEnabled[notificationKey(provider, windowId)] === true;
}

function toggleNotification(provider: "codex" | "claude", windowId: string): void {
  const key = notificationKey(provider, windowId);
  notificationEnabled[key] = !isNotificationEnabled(provider, windowId);
  if (notificationEnabled[key]) {
    void props.model.testNotification().catch(() => {
      // The widget remains usable if Windows notification delivery is unavailable.
    });
    checkResetNotifications();
  }
}

/**
 * Notify once per reset boundary. The next reset timestamp is used as the
 * identity because `presentUsageWindow` replaces the expired timestamp while
 * it animates the bar into the new subscription window.
 */
function checkResetNotifications(): void {
  const current = displayData.value;
  if (!current) return;

  for (const provider of ["codex", "claude"] as const) {
    for (const window of current[provider].windows) {
      if (!isNotificationEnabled(provider, window.id)) continue;
      if (!window.resetting && !window.celebratingReset) continue;
      if (window.resetsAt == null) continue;

      const key = notificationKey(provider, window.id);
      if (lastNotifiedReset.get(key) === window.resetsAt) continue;
      lastNotifiedReset.set(key, window.resetsAt);
      void props.model.notifyReset(provider, window.label).catch(() => {
        // The widget remains usable if Windows notification delivery is unavailable.
      });
    }
  }
}

watch(nowMs, checkResetNotifications);

function providerPlan(source: UsageSource): string | null {
  return source.plan ? source.plan.charAt(0).toUpperCase() + source.plan.slice(1) : null;
}

function resetLabel(window: PresentedUsageWindow): string {
  if (window.resetting) return "";
  if (window.celebratingReset) return "LFG!";
  if (window.countdownSeconds !== null && window.countdownSeconds > 0) {
    return `Resets in ${window.countdownSeconds}s`;
  }
  return formatReset(window.resetsAt);
}
</script>

<template>
  <div class="ai-usage">
    <header class="widget-header">
      <div>
        <h2 @dblclick.stop="toggleDemoMode">AI Usage</h2>
        <p>Subscription windows</p>
      </div>
      <button
        class="refresh-button"
        type="button"
        :disabled="loading"
        aria-label="Refresh AI usage"
        title="Refresh"
        @click="model.refresh"
      >
        <span class="refresh-icon-slot" aria-hidden="true">
          <svg
            v-if="loading"
            class="loader-circle"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <g class="loader-circle-g">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </g>
          </svg>
          <span v-else class="refresh-icon">↻</span>
        </span>
      </button>
    </header>

    <p v-if="error" class="global-error">{{ error }}</p>
    <p v-if="loading && !data" class="loading-state">Loading usage…</p>

    <div v-else-if="displayData" class="provider-list">
      <p v-if="enabledProviders.length === 0" class="provider-empty disabled-message">
        Enable Codex or Claude Code in the widget settings.
      </p>
      <section v-for="provider in enabledProviders" :key="provider" class="provider">
        <header class="provider-header">
          <div class="provider-title">
            <span class="provider-dot" :class="`provider-dot--${provider}`"></span>
            <strong>{{ provider === "codex" ? "Codex" : "Claude Code" }}</strong>
            <span v-if="providerPlan(displayData[provider])" class="plan">
              {{ providerPlan(displayData[provider]) }}
            </span>
          </div>
          <span class="status">{{ statusLabel(displayData[provider].status) }}</span>
        </header>

        <div v-if="displayData[provider].windows.length" class="window-list">
          <div v-for="window in displayData[provider].windows" :key="window.id" class="usage-window">
            <div class="window-labels">
              <span>{{ window.label }}</span>
              <strong :class="`usage--${usageTone(usagePercent(window.usedPercent))}`">
                {{ formatPercent(usagePercent(window.usedPercent)) }} used
              </strong>
            </div>
            <div class="bar" aria-hidden="true">
              <span
                class="bar-fill"
                :class="`bar--${usageTone(usagePercent(window.usedPercent))}`"
                :style="{ width: `${usagePercent(window.usedPercent)}%` }"
              ></span>
              <span
                v-if="timeProgressPercent(window, nowMs) !== null"
                class="time-marker"
                :style="{ left: `${timeProgressPercent(window, nowMs)}%` }"
                v-tip="elapsedTimeLabel(window, nowMs) ?? undefined"
              ></span>
            </div>
            <div class="reset-row">
              <span class="reset" :class="{ 'reset-celebration': window.celebratingReset }">
                {{ resetLabel(window) }}
              </span>
              <button
                v-if="!window.resetting && !window.celebratingReset"
                class="notify-button"
                :class="{ 'notify-button--active': isNotificationEnabled(provider, window.id) }"
                type="button"
                :aria-pressed="isNotificationEnabled(provider, window.id)"
                :aria-label="isNotificationEnabled(provider, window.id)
                  ? `Disable ${window.label} reset notification`
                  : `Enable ${window.label} reset notification`"
                v-tip="'Notify on reset'"
                @click.stop="toggleNotification(provider, window.id)"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  :fill="isNotificationEnabled(provider, window.id) ? 'currentColor' : 'none'"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10.268 21a2 2 0 0 0 3.464 0" />
                  <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div v-else class="provider-empty">
          <p>{{ displayData[provider].detail }}</p>
          <button
            v-if="provider === 'claude' && displayData.claude.status === 'notConfigured'"
            class="setup-button"
            type="button"
            :disabled="enablingClaude"
            @click="model.enableClaudeCapture"
          >
            {{ enablingClaude ? "Enabling…" : "Enable Claude capture" }}
          </button>
          <small v-if="provider === 'claude' && displayData.claude.status === 'notConfigured'">
            Adds a local Claude Code status line; the existing login is used only
            for a read-only usage check in the backend.
          </small>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ai-usage {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  overflow: auto;
  color: rgb(var(--fg-rgb));
}

.widget-header,
.provider-header,
.window-labels,
.provider-title {
  display: flex;
  align-items: center;
}

.widget-header,
.provider-header,
.window-labels {
  justify-content: space-between;
  gap: 12px;
}

.widget-header h2,
.widget-header p,
.provider-empty p,
.global-error,
.loading-state {
  margin: 0;
}

.widget-header h2 {
  font-size: 15px;
  line-height: 1.2;
  user-select: none;
}

.widget-header p,
.status,
.reset,
.provider-empty,
.loading-state {
  color: rgba(var(--fg-rgb), 0.55);
}

.widget-header p {
  margin-top: 2px;
  font-size: 10px;
}

.refresh-button,
.setup-button {
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  color: inherit;
  background: rgba(var(--fg-rgb), 0.06);
  cursor: pointer;
}

.refresh-button {
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.refresh-icon-slot {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.loader-circle {
  display: block;
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
}

.refresh-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  font-size: 15px;
  line-height: 15px;
}

@keyframes loader-circle-group {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.loader-circle-g {
  transform-box: view-box;
  transform-origin: center;
  animation: loader-circle-group 1.3s linear infinite;
}

button:disabled {
  cursor: default;
  opacity: 0.5;
}

.provider-list {
  display: grid;
  gap: 10px;
}

.provider {
  display: grid;
  gap: 9px;
  padding-top: 10px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.09);
}

.provider-title {
  gap: 7px;
  min-width: 0;
  font-size: 12px;
}

.provider-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
}

.provider-dot--codex { background: #6ee7b7; }
.provider-dot--claude { background: #f3a66d; }

.plan {
  padding: 2px 5px;
  border-radius: 5px;
  background: rgba(var(--fg-rgb), 0.07);
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 9px;
}

.status,
.reset {
  font-size: 9px;
}

.window-list {
  display: grid;
  gap: 9px;
}

.usage-window {
  display: grid;
  gap: 4px;
}

.window-labels {
  font-size: 11px;
}

.window-labels strong {
  font-variant-numeric: tabular-nums;
}

.usage--healthy { color: #6ee7b7; }
.usage--warning { color: #fbbf24; }
.usage--critical { color: #f87171; }

.bar {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.09);
}

.bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 180ms ease;
}

.time-marker {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  border-radius: 999px;
  background: rgb(var(--fg-rgb));
  box-shadow: 0 0 3px rgba(var(--fg-rgb), 0.7);
  opacity: 0.8;
  pointer-events: auto;
  transform: translateX(-50%);
}

.time-marker::before {
  content: "";
  position: absolute;
  top: -6px;
  right: -5px;
  bottom: -6px;
  left: -5px;
}

.bar--healthy { background: #6ee7b7; }
.bar--warning { background: #fbbf24; }
.bar--critical { background: #f87171; }

.reset {
  font-variant-numeric: tabular-nums;
}

.reset-row {
  display: inline-flex;
  align-items: center;
  justify-self: end;
  gap: 5px;
  min-height: 16px;
}

.notify-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 2px;
  border: 0;
  border-radius: 5px;
  color: inherit;
  background: transparent;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity 120ms ease, background 120ms ease;
}

.notify-button:hover,
.notify-button--active {
  opacity: 1;
}

.notify-button:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.notify-button svg {
  display: block;
  width: 11px;
  height: 11px;
}

@keyframes reset-celebration-pulse {
  0%, 100% {
    opacity: 0.65;
    transform: scale(0.96);
  }
  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

.reset-celebration {
  display: inline-block;
  color: #6ee7b7;
  font-weight: 700;
  animation: reset-celebration-pulse 500ms ease-in-out infinite;
}

.provider-empty {
  display: grid;
  gap: 7px;
  font-size: 10px;
  line-height: 1.35;
}

.setup-button {
  justify-self: start;
  padding: 6px 9px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 600;
}

.provider-empty small {
  font-size: 9px;
  color: rgba(var(--fg-rgb), 0.42);
}

.global-error {
  font-size: 10px;
  color: #f87171;
}
</style>
