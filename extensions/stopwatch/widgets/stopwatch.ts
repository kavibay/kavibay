import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";

const TICK_MS = 75;
const SESSION_STATE_KEY = "session-state";
const SESSION_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface LapEntry {
  id: string;
  /** Total elapsed milliseconds when the lap was recorded. */
  atMs: number;
  /** Elapsed milliseconds since the previous lap. */
  splitMs: number;
}

interface SessionSnapshot {
  sessionId: string;
  accumulatedMs: number;
  laps: LapEntry[];
  lapCounter: number;
}

export interface DisplayLap {
  id: string;
  lapNumber: number;
  split: string;
  total: string;
}

export interface StopwatchModel {
  running: Ref<boolean>;
  displayTime: ComputedRef<string>;
  displayLaps: ComputedRef<DisplayLap[]>;
  statusText: ComputedRef<string>;
  toggleRun(): void;
  lap(): void;
  reset(): void;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Ignore stale sessions and normalize hand-edited or partially written data. */
function restoreSnapshot(raw: unknown): Omit<SessionSnapshot, "sessionId"> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (value.sessionId !== SESSION_ID) return undefined;

  const laps = Array.isArray(value.laps)
    ? value.laps.flatMap((entry, index): LapEntry[] => {
        if (!entry || typeof entry !== "object") return [];
        const lap = entry as Record<string, unknown>;
        return [{
          id: typeof lap.id === "string" ? lap.id : `lap-${index + 1}`,
          atMs: nonNegativeNumber(lap.atMs),
          splitMs: nonNegativeNumber(lap.splitMs),
        }];
      })
    : [];

  return {
    accumulatedMs: nonNegativeNumber(value.accumulatedMs),
    laps,
    lapCounter:
      typeof value.lapCounter === "number" && Number.isInteger(value.lapCounter)
        ? Math.max(laps.length, value.lapCounter)
        : laps.length,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** MM:SS.cs below one hour, otherwise H:MM:SS.cs. */
export function formatElapsed(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const centiseconds = Math.floor((safe % 1000) / 10);
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const fraction = `.${pad2(centiseconds)}`;

  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}${fraction}`
    : `${pad2(minutes)}:${pad2(seconds)}${fraction}`;
}

export function elapsedMs(
  accumulatedMs: number,
  running: boolean,
  runningStartAt: number | null,
  now = Date.now(),
): number {
  if (!running || runningStartAt == null) return accumulatedMs;
  return accumulatedMs + Math.max(0, now - runningStartAt);
}

export function createLapEntry(atMs: number, laps: LapEntry[], id: string): LapEntry {
  const previous = laps.length > 0 ? laps[laps.length - 1]!.atMs : 0;
  return { id, atMs, splitMs: Math.max(0, atMs - previous) };
}

export const stopwatchWidget = defineWidget<Record<string, never>>({
  name: "stopwatch",
  displayName: "Stopwatch",
  description: "Count-up stopwatch.",
  defaultSize: { w: 4, h: 3 },
  mode: "both",
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>): Promise<StopwatchModel> {
      const accumulatedMs = ref(0);
      const laps = ref<LapEntry[]>([]);
      const running = ref(false);
      const tickNow = ref(Date.now());
      let runningStartAt: number | null = null;
      let tickTimer: ReturnType<typeof setInterval> | undefined;
      let lapCounter = 0;
      let hydrated = false;

      const clearTick = () => {
        if (tickTimer === undefined) return;
        clearInterval(tickTimer);
        tickTimer = undefined;
      };

      const pause = () => {
        if (!running.value) return;
        if (runningStartAt != null) {
          accumulatedMs.value += Math.max(0, Date.now() - runningStartAt);
        }
        runningStartAt = null;
        running.value = false;
        clearTick();
      };

      const snapshot = (): SessionSnapshot => ({
        sessionId: SESSION_ID,
        accumulatedMs: accumulatedMs.value,
        laps: laps.value.map((entry) => ({ ...entry })),
        lapCounter,
      });

      // Registered before the first await so the runtime's effect scope owns
      // teardown even when the card disappears during hydration.
      onScopeDispose(() => {
        pause();
        if (hydrated) void ctx.data.set(SESSION_STATE_KEY, snapshot());
      });

      const restored = restoreSnapshot(await ctx.data.get<SessionSnapshot>(SESSION_STATE_KEY));
      await ctx.data.delete(SESSION_STATE_KEY);
      if (restored) {
        accumulatedMs.value = restored.accumulatedMs;
        laps.value = restored.laps;
        lapCounter = restored.lapCounter;
        tickNow.value = Date.now();
      }
      hydrated = true;

      const displayTime = computed(() =>
        formatElapsed(elapsedMs(accumulatedMs.value, running.value, runningStartAt, tickNow.value)),
      );
      const displayLaps = computed<DisplayLap[]>(() =>
        [...laps.value].reverse().map((entry, index) => ({
          id: entry.id,
          lapNumber: laps.value.length - index,
          split: formatElapsed(entry.splitMs),
          total: formatElapsed(entry.atMs),
        })),
      );
      const statusText = computed(() => {
        if (running.value) return "Running…";
        if (accumulatedMs.value > 0 || laps.value.length > 0) return "Paused";
        return "Ready";
      });

      const start = () => {
        if (running.value) return;
        runningStartAt = Date.now();
        tickNow.value = runningStartAt;
        running.value = true;
        clearTick();
        tickTimer = setInterval(() => {
          if (running.value && runningStartAt != null) tickNow.value = Date.now();
        }, TICK_MS);
      };

      const toggleRun = () => {
        if (running.value) pause();
        else start();
      };

      const lap = () => {
        if (!running.value || runningStartAt == null) return;
        const atMs = elapsedMs(accumulatedMs.value, true, runningStartAt);
        lapCounter += 1;
        laps.value = [...laps.value, createLapEntry(atMs, laps.value, `lap-${lapCounter}`)];
      };

      const reset = () => {
        pause();
        accumulatedMs.value = 0;
        laps.value = [];
        lapCounter = 0;
        tickNow.value = Date.now();
      };

      return { running, displayTime, displayLaps, statusText, toggleRun, lap, reset };
    },
  },
});

