// SPDX-License-Identifier: MIT
import type { UsageSourceStatus, UsageWindow } from "./widgets/aiUsage";

export interface AiUsageConfig {
  codexEnabled?: boolean;
  claudeEnabled?: boolean;
}

export interface AiUsageSettings {
  codexEnabled: boolean;
  claudeEnabled: boolean;
}

export interface PresentedUsageWindow extends UsageWindow {
  countdownSeconds: number | null;
  resetting: boolean;
  celebratingReset: boolean;
}

const RESET_COUNTDOWN_MS = 10_000;
export const RESET_ANIMATION_MS = 1_500;
const RESET_CELEBRATION_MS = 1_000;

function windowDurationSeconds(id: string, label: string): number | null {
  if (label === "5 hours") return 5 * 60 * 60;
  if (label === "7 days") return 7 * 24 * 60 * 60;
  switch (id) {
    case "primary":
    case "five_hour":
      return 5 * 60 * 60;
    case "secondary":
    case "seven_day":
      return 7 * 24 * 60 * 60;
    default:
      return null;
  }
}

function nextResetAt(resetAt: number, id: string, label: string, nowSeconds: number): number | null {
  const duration = windowDurationSeconds(id, label);
  if (duration === null) return null;
  if (resetAt > nowSeconds) return resetAt;
  const periods = Math.floor((nowSeconds - resetAt) / duration) + 1;
  return resetAt + periods * duration;
}

/** Position of the time marker on the usage bar, measured from the left. */
export function timeProgressPercent(
  window: Pick<UsageWindow, "id" | "label" | "resetsAt">,
  nowMs = Date.now(),
): number | null {
  if (window.resetsAt == null || !Number.isFinite(window.resetsAt)) return null;
  const duration = windowDurationSeconds(window.id, window.label);
  if (duration === null) return null;
  const remaining = Math.max(0, window.resetsAt * 1_000 - nowMs);
  const elapsedRatio = 1 - Math.min(1, remaining / (duration * 1_000));
  return Math.round(elapsedRatio * 1_000) / 10;
}

/** Human-readable elapsed time represented by the time marker. */
export function elapsedTimeLabel(
  window: Pick<UsageWindow, "id" | "label" | "resetsAt">,
  nowMs = Date.now(),
): string | null {
  if (window.resetsAt == null || !Number.isFinite(window.resetsAt)) return null;
  const duration = windowDurationSeconds(window.id, window.label);
  if (duration === null) return null;

  const remainingSeconds = Math.max(0, window.resetsAt - nowMs / 1_000);
  const elapsedMinutes = Math.max(0, Math.floor((duration - remainingSeconds) / 60));
  const days = Math.floor(elapsedMinutes / 1_440);
  const hours = Math.floor((elapsedMinutes % 1_440) / 60);
  const minutes = elapsedMinutes % 60;
  const elapsed =
    days > 0
      ? hours > 0
        ? `${days}d ${hours}h`
        : `${days}d`
      : hours > 0
        ? minutes > 0
          ? `${hours}h ${minutes}m`
          : `${hours}h`
        : `${minutes}m`;
  const elapsedPercent = timeProgressPercent(window, nowMs);
  return `Elapsed: ${elapsed} · ${formatPercent(Math.ceil(elapsedPercent ?? 0))}`;
}

/**
 * Converts a provider window into its animated presentation state. Keeping
 * this pure makes the real reset and the video demo follow the same timeline.
 */
export function presentUsageWindow(
  window: UsageWindow,
  nowMs: number,
  overrideResetAtMs?: number,
): PresentedUsageWindow {
  const resetAtMs = overrideResetAtMs ?? (window.resetsAt == null ? null : window.resetsAt * 1_000);
  if (resetAtMs === null || !Number.isFinite(resetAtMs)) {
    return {
      ...window,
      usedPercent: usagePercent(window.usedPercent),
      countdownSeconds: null,
      resetting: false,
      celebratingReset: false,
    };
  }

  const deltaMs = resetAtMs - nowMs;
  if (deltaMs > 0 && deltaMs <= RESET_COUNTDOWN_MS) {
    return {
      ...window,
      usedPercent: usagePercent(window.usedPercent),
      resetsAt: resetAtMs / 1_000,
      countdownSeconds: Math.ceil(deltaMs / 1_000),
      resetting: false,
      celebratingReset: false,
    };
  }

  if (deltaMs <= 0 && deltaMs > -RESET_ANIMATION_MS) {
    const next = nextResetAt(resetAtMs / 1_000, window.id, window.label, nowMs / 1_000);
    const progress = Math.min(1, Math.max(0, -deltaMs / RESET_ANIMATION_MS));
    return {
      ...window,
      usedPercent: usagePercent(window.usedPercent) * (1 - progress),
      resetsAt: next,
      countdownSeconds: 0,
      resetting: true,
      celebratingReset: false,
    };
  }

  if (deltaMs <= -RESET_ANIMATION_MS && deltaMs > -(RESET_ANIMATION_MS + RESET_CELEBRATION_MS)) {
    const next = nextResetAt(resetAtMs / 1_000, window.id, window.label, nowMs / 1_000);
    return {
      ...window,
      usedPercent: 0,
      resetsAt: next,
      countdownSeconds: null,
      resetting: false,
      celebratingReset: true,
    };
  }

  if (deltaMs <= 0) {
    const next = nextResetAt(resetAtMs / 1_000, window.id, window.label, nowMs / 1_000);
    return {
      ...window,
      usedPercent: 0,
      resetsAt: next,
      countdownSeconds: null,
      resetting: false,
      celebratingReset: false,
    };
  }

  return {
    ...window,
    usedPercent: usagePercent(window.usedPercent),
    resetsAt: resetAtMs / 1_000,
    countdownSeconds: null,
    resetting: false,
    celebratingReset: false,
  };
}

/** Keep both providers enabled for new and previously-created instances. */
export function normalizeAiUsageConfig(raw: unknown): AiUsageSettings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    codexEnabled: value.codexEnabled !== false,
    claudeEnabled: value.claudeEnabled !== false,
  };
}

/** Percentage consumed, clamped against malformed provider values. */
export function usagePercent(usedPercent: number): number {
  const used = Number.isFinite(usedPercent) ? usedPercent : 0;
  return Math.round(Math.min(100, Math.max(0, used)) * 10) / 10;
}

export function formatPercent(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

/** Short reset countdown; accepts `now` to keep the pure-logic asserts stable. */
export function formatReset(resetAt: number | null, now = Date.now() / 1000): string {
  if (resetAt == null || !Number.isFinite(resetAt)) return "Reset unknown";
  const seconds = Math.max(0, Math.ceil(resetAt - now));
  if (seconds === 0) return "Reset due";
  const totalMinutes = Math.ceil(seconds / 60);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `Resets in ${days}d ${hours}h` : `Resets in ${days}d`;
  if (hours > 0) {
    return minutes > 0
      ? `Resets in ${hours}h ${minutes}m`
      : `Resets in ${hours}h`;
  }
  return `Resets in ${Math.max(1, minutes)}m`;
}

export function usageTone(used: number): "healthy" | "warning" | "critical" {
  if (used >= 85) return "critical";
  if (used >= 60) return "warning";
  return "healthy";
}

/**
 * Every window has reset since the source was read, so none of its numbers
 * describes now. Each would show 0% used, which is only true at the reset.
 * The grace keeps the reset animation of the last window on screen.
 */
export function isOutdated(windows: readonly UsageWindow[], nowMs: number): boolean {
  const graceMs = RESET_ANIMATION_MS + RESET_CELEBRATION_MS;
  return (
    windows.length > 0 &&
    windows.every(
      (window) => window.resetsAt != null && window.resetsAt * 1_000 + graceMs <= nowMs,
    )
  );
}

/** Status for an outdated source: how long ago it was read. */
export function lastSeenLabel(updatedAt: number | null, nowMs: number): string {
  if (updatedAt == null || !Number.isFinite(updatedAt)) return "No recent data";
  const minutes = Math.max(0, Math.floor((nowMs / 1_000 - updatedAt) / 60));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor(minutes / 60);
  const age = days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : `${Math.max(1, minutes)}m`;
  return `Last seen ${age} ago`;
}

/** What brings fresh numbers back, per provider. */
export function outdatedDetail(provider: "codex" | "claude"): string {
  return provider === "codex"
    ? "Every window has reset since. Codex reports usage again during its next session."
    : "Every window has reset since. Claude Code reports usage again the next time it runs in a terminal.";
}

export function statusLabel(status: UsageSourceStatus): string {
  return {
    available: "Available",
    notFound: "No data",
    notConfigured: "Setup needed",
    waiting: "Waiting for data",
    conflict: "Existing configuration",
    unsupported: "Unsupported",
    error: "Unavailable",
  }[status];
}
