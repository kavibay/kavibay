import type { ExtensionInlineView } from "@sdk/types";

/** Fixed preset durations in whole minutes. */
export const TIMER_PRESETS_MINUTES = [1, 5, 10, 15, 25] as const;

export const MIN_DURATION_MS = 1_000;

export const DEFAULT_DURATION_MS = 5 * 60_000;

export interface TimerPersisted {
  /** Last chosen countdown duration in milliseconds. */
  durationMs: number;
}

export interface TimerStoredState extends TimerPersisted {
  remainingMs: number;
  running: boolean;
  ringing: boolean;
  deadlineAt: number | null;
}

/** Clamp duration to at least one second. */
export function clampDurationMs(ms: unknown): number {
  const n = typeof ms === "number" ? ms : Number(ms);
  if (!Number.isFinite(n)) return MIN_DURATION_MS;
  return Math.max(MIN_DURATION_MS, Math.round(n));
}

/** Format remaining ms as MM:SS, or H:MM:SS when at least one hour remains. */
export function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (h >= 1) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** The four numbers a palette row needs to describe a timer. */
export interface TimerInlineSnapshot {
  remainingMs: number;
  durationMs: number;
  running: boolean;
  ringing: boolean;
}

/**
 * Map timer state to its palette-row glance.
 *
 * Mirrors the card's own status wording so the list and the widget never
 * disagree — "Paused" is inferred the same way, from a countdown that sits
 * below its chosen duration without running.
 */
export function timerInlineView(snapshot: TimerInlineSnapshot): ExtensionInlineView {
  const value = formatRemaining(snapshot.remainingMs);
  // Timers have several row actions (Pause, Restart, Set). Keeping the live
  // reading beneath the title prevents it competing with that action strip.
  if (snapshot.ringing) {
    return { value, label: "Done", tone: "done", placement: "detail" };
  }
  if (snapshot.running) {
    return { value, label: "Running", tone: "active", placement: "detail" };
  }
  if (snapshot.remainingMs < snapshot.durationMs) {
    return { value, label: "Paused", tone: "warn", placement: "detail" };
  }
  return { value, label: "Ready", tone: "neutral", placement: "detail" };
}

/** Row buttons a timer offers, by state. */
export type TimerActionId =
  | "start"
  | "pause"
  | "resume"
  | "restart"
  | "reset"
  | "dismiss"
  | "set";

/**
 * Which row buttons a timer shows right now.
 *
 * Ordered most-wanted first: the thing you reached for the palette to do sits
 * leftmost. A Ready timer gets only Start — Reset would be a no-op and Restart
 * would mean the same as Start.
 */
export function timerInlineActions(
  snapshot: TimerInlineSnapshot,
): { id: TimerActionId; title: string }[] {
  // "Set" closes every list: re-timing an existing timer is always available,
  // and it takes a typed value, so it belongs behind the one-press actions.
  const set = { id: "set" as const, title: "Set" };
  if (snapshot.ringing) {
    return [{ id: "dismiss", title: "Dismiss" }, { id: "restart", title: "Restart" }, set];
  }
  if (snapshot.running) {
    return [{ id: "pause", title: "Pause" }, { id: "restart", title: "Restart" }, set];
  }
  if (snapshot.remainingMs < snapshot.durationMs) {
    return [{ id: "resume", title: "Resume" }, { id: "reset", title: "Reset" }, set];
  }
  return [{ id: "start", title: "Start" }, set];
}

/**
 * Parse a custom duration string: whole minutes ("5") or mm:ss ("1:30").
 * Returns null when the input is empty or not parseable.
 */
export function parseCustomDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const colonMatch = /^(\d+):(\d{1,2})$/.exec(trimmed);
  if (colonMatch) {
    const minutes = Number(colonMatch[1]);
    const seconds = Number(colonMatch[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) {
      return null;
    }
    return clampDurationMs((minutes * 60 + seconds) * 1000);
  }

  // Unit form: "90s", "25m", "1h", "1h30", "1h30m", "1h 30m".
  // Needed by the palette action, where people type "set timer 1h".
  const unitMs = parseUnitDuration(trimmed);
  if (unitMs != null) return clampDurationMs(unitMs);

  const asMinutes = Number(trimmed);
  if (!Number.isFinite(asMinutes)) return null;
  return clampDurationMs(asMinutes * 60_000);
}

const UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000 };

/**
 * Sum a unit-suffixed duration; null when the text is not of that shape.
 * A trailing bare number inherits the next smaller unit ("1h30" = 1h 30m),
 * which is how people actually type it.
 */
function parseUnitDuration(input: string): number | null {
  const parts = input.toLowerCase().match(/\d+(?:\.\d+)?\s*[hms]?/g);
  if (!parts) return null;
  // Reject anything with leftovers ("1x30", "abc") — join must round-trip.
  if (parts.join("").replace(/\s+/g, "") !== input.toLowerCase().replace(/\s+/g, "")) {
    return null;
  }

  let total = 0;
  let sawUnit = false;
  let lastUnit: string | null = null;

  for (const part of parts) {
    const match = /^(\d+(?:\.\d+)?)\s*([hms]?)$/.exec(part.trim());
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return null;

    let unit = match[2];
    if (!unit) {
      // Bare trailing number: one step below the previous unit.
      if (lastUnit === "h") unit = "m";
      else if (lastUnit === "m") unit = "s";
      else return null;
    } else {
      sawUnit = true;
    }

    total += value * UNIT_MS[unit]!;
    lastUnit = unit;
  }

  return sawUnit ? total : null;
}

/** Convert preset minutes to milliseconds. */
export function presetDurationMs(minutes: number): number {
  return clampDurationMs(minutes * 60_000);
}

/** True when duration exactly matches a fixed preset chip. */
export function isPresetDuration(durationMs: number): boolean {
  return TIMER_PRESETS_MINUTES.some((m) => presetDurationMs(m) === durationMs);
}

export function normalizePersisted(raw: unknown): TimerPersisted {
  const value = raw && typeof raw === "object" ? (raw as Partial<TimerPersisted>) : {};
  return {
    durationMs: clampDurationMs(value.durationMs ?? DEFAULT_DURATION_MS),
  };
}

export function normalizeTimerState(raw: unknown): TimerStoredState {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const { durationMs } = normalizePersisted(value);
  const remainingMs = Math.min(
    durationMs,
    Math.max(0, typeof value.remainingMs === "number" && Number.isFinite(value.remainingMs)
      ? value.remainingMs
      : durationMs),
  );
  const running = value.running === true && typeof value.deadlineAt === "number";
  return {
    durationMs,
    remainingMs,
    running,
    ringing: value.ringing === true,
    deadlineAt: running ? value.deadlineAt as number : null,
  };
}
