// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import {
  defineWidget,
  type WidgetActionContext,
  type WidgetContext,
} from "@sdk/contract/sdk";

export type PomodoroPhase = "focus" | "shortBreak" | "longBreak";

export interface PomodoroConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
}

export interface PomodoroStoredState {
  phase: PomodoroPhase;
  completedFocusSessions: number;
  remainingMs: number;
  running: boolean;
  deadlineAt: number | null;
}

export interface PomodoroModel {
  phase: Ref<PomodoroPhase>;
  completedFocusSessions: Ref<number>;
  running: Ref<boolean>;
  displayTime: ComputedRef<string>;
  label: ComputedRef<string>;
  statusText: ComputedRef<string>;
  progress: ComputedRef<number>;
  accent: ComputedRef<string>;
  ringOffset: ComputedRef<number>;
  start(): void;
  stop(): void;
  reset(): void;
  toggleRun(): void;
}

export const POMODORO_STATE_KEY = "state";
export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
};

export const RING_R = 54;
export const RING_C = 2 * Math.PI * RING_R;

export function clampMinutes(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.round(n));
}

export function normalizePomodoroConfig(raw: unknown): PomodoroConfig {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    focusMinutes: clampMinutes(value.focusMinutes ?? DEFAULT_POMODORO_CONFIG.focusMinutes),
    shortBreakMinutes: clampMinutes(
      value.shortBreakMinutes ?? DEFAULT_POMODORO_CONFIG.shortBreakMinutes,
    ),
    longBreakMinutes: clampMinutes(
      value.longBreakMinutes ?? DEFAULT_POMODORO_CONFIG.longBreakMinutes,
    ),
  };
}

export function durationMs(phase: PomodoroPhase, config: PomodoroConfig): number {
  const minutes =
    phase === "focus"
      ? config.focusMinutes
      : phase === "shortBreak"
        ? config.shortBreakMinutes
        : config.longBreakMinutes;
  return clampMinutes(minutes) * 60_000;
}

export function advanceAfterComplete(
  phase: PomodoroPhase,
  completedFocusSessions: number,
): { phase: PomodoroPhase; completedFocusSessions: number } {
  if (phase === "focus") {
    const next = completedFocusSessions + 1;
    return next >= 4
      ? { phase: "longBreak", completedFocusSessions: 0 }
      : { phase: "shortBreak", completedFocusSessions: next };
  }
  return { phase: "focus", completedFocusSessions };
}

export function formatMmSs(ms: number): string {
  // Countdowns round up: a timer stopped a millisecond after it started still
  // holds 599_999ms, and flooring would show 09:59 for a 10 minute focus block.
  // Ceiling keeps every second on screen for its full duration, and only the
  // clamp below can produce 00:00 — which is what "done" should look like.
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(
    totalSeconds % 60,
  ).padStart(2, "0")}`;
}

export function phaseLabel(phase: PomodoroPhase): string {
  if (phase === "focus") return "Focus";
  if (phase === "shortBreak") return "Break";
  return "Long Break";
}

function phaseOf(raw: unknown): PomodoroPhase {
  return raw === "shortBreak" || raw === "longBreak" ? raw : "focus";
}

function nonNegativeNumber(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : fallback;
}

/** Accept both old localStorage snapshots and the new durable timer shape. */
export function normalizePomodoroState(
  raw: unknown,
  config: PomodoroConfig = DEFAULT_POMODORO_CONFIG,
): PomodoroStoredState {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const phase = phaseOf(value.phase);
  const remainingMs = nonNegativeNumber(value.remainingMs, durationMs(phase, config));
  const completedFocusSessions = Math.min(
    3,
    Math.max(0, Math.round(Number(value.completedFocusSessions) || 0)),
  );
  const running = value.running === true && typeof value.deadlineAt === "number";
  return {
    phase,
    completedFocusSessions,
    remainingMs: Math.min(durationMs(phase, config), remainingMs),
    running,
    deadlineAt: running ? value.deadlineAt as number : null,
  };
}

function copyState(state: PomodoroStoredState): PomodoroStoredState {
  return { ...state };
}

/** Apply the local palette action without requiring a mounted Vue component. */
export async function runPomodoroAction({ ctx, args, setConfig }: WidgetActionContext<PomodoroConfig>): Promise<void> {
  const config = normalizePomodoroConfig(ctx.config);
  const minutes = args.minutes === undefined ? undefined : clampMinutes(args.minutes);
  if (minutes !== undefined) {
    config.focusMinutes = minutes;
    setConfig({ focusMinutes: minutes });
  }

  const current = normalizePomodoroState(await ctx.data.get(POMODORO_STATE_KEY), config);
  const now = Date.now();
  const next = copyState(current);
  if (current.running && current.deadlineAt !== null) {
    next.remainingMs = Math.max(0, current.deadlineAt - now);
  }

  if (args.mode === "stop") {
    next.running = false;
    next.deadlineAt = null;
  } else {
    if (args.mode === "restart") {
      next.phase = "focus";
      next.remainingMs = durationMs("focus", config);
    } else if (next.remainingMs <= 0) {
      next.remainingMs = durationMs(next.phase, config);
    }
    next.running = true;
    next.deadlineAt = now + next.remainingMs;
  }
  await ctx.data.set(POMODORO_STATE_KEY, next);
}

export const pomodoroWidget = defineWidget<PomodoroConfig>({
  name: "pomodoro",
  displayName: "Pomodoro",
  description: "Focus timer with work and break sessions.",
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 3, h: 2 },
  mode: "both",
  configuration: {
    focusMinutes: { type: "number", label: "Focus minutes", default: 25 },
    shortBreakMinutes: { type: "number", label: "Short break minutes", default: 5 },
    longBreakMinutes: { type: "number", label: "Long break minutes", default: 15 },
  },
  actions: { "pomodoro": runPomodoroAction },
  component: {
    async setup(ctx: WidgetContext<PomodoroConfig>): Promise<PomodoroModel> {
      const config = normalizePomodoroConfig(ctx.config);
      const phase = ref<PomodoroPhase>("focus");
      const completedFocusSessions = ref(0);
      const remainingMs = ref(durationMs(phase.value, config));
      const running = ref(false);
      const tickNow = ref(Date.now());
      let deadlineAt: number | null = null;
      let tickTimer: ReturnType<typeof setInterval> | undefined;
      let hydrated = false;
      let disposed = false;

      const clearTick = () => {
        if (tickTimer === undefined) return;
        clearInterval(tickTimer);
        tickTimer = undefined;
      };

      const snapshot = (): PomodoroStoredState => ({
        phase: phase.value,
        completedFocusSessions: completedFocusSessions.value,
        remainingMs: running.value && deadlineAt !== null
          ? Math.max(0, deadlineAt - Date.now())
          : remainingMs.value,
        running: running.value,
        deadlineAt,
      });

      const persist = () => void ctx.data.set(POMODORO_STATE_KEY, snapshot()).catch(() => undefined);

      const finishPhase = () => {
        clearTick();
        deadlineAt = null;
        running.value = false;
        const next = advanceAfterComplete(phase.value, completedFocusSessions.value);
        phase.value = next.phase;
        completedFocusSessions.value = next.completedFocusSessions;
        remainingMs.value = durationMs(phase.value, config);
        persist();
      };

      const onTick = () => {
        if (deadlineAt === null) return;
        tickNow.value = Date.now();
        remainingMs.value = Math.max(0, deadlineAt - tickNow.value);
        if (remainingMs.value <= 0) finishPhase();
      };

      const start = () => {
        if (running.value) return;
        if (remainingMs.value <= 0) remainingMs.value = durationMs(phase.value, config);
        deadlineAt = Date.now() + remainingMs.value;
        running.value = true;
        clearTick();
        tickTimer = setInterval(onTick, 250);
        persist();
      };

      const stop = () => {
        if (!running.value) return;
        onTick();
        deadlineAt = null;
        running.value = false;
        clearTick();
        persist();
      };

      const reset = () => {
        if (running.value) stop();
        phase.value = "focus";
        remainingMs.value = durationMs("focus", config);
        persist();
      };

      onScopeDispose(() => {
        disposed = true;
        clearTick();
        if (hydrated) persist();
      });

      const saved = normalizePomodoroState(await ctx.data.get(POMODORO_STATE_KEY), config);
      if (!disposed) {
        phase.value = saved.phase;
        completedFocusSessions.value = saved.completedFocusSessions;
        remainingMs.value = saved.remainingMs;
        if (saved.running && saved.deadlineAt !== null && saved.deadlineAt > Date.now()) {
          deadlineAt = saved.deadlineAt;
          running.value = true;
          tickTimer = setInterval(onTick, 250);
        } else if (saved.running) {
          const next = advanceAfterComplete(saved.phase, saved.completedFocusSessions);
          phase.value = next.phase;
          completedFocusSessions.value = next.completedFocusSessions;
          remainingMs.value = durationMs(next.phase, config);
        }
        hydrated = true;
      }

      return {
        phase,
        completedFocusSessions,
        running,
        displayTime: computed(() => formatMmSs(remainingMs.value)),
        label: computed(() => phaseLabel(phase.value)),
        statusText: computed(() => {
          if (running.value) return "Running…";
          return remainingMs.value < durationMs(phase.value, config) ? "Paused" : "Ready";
        }),
        progress: computed(() => remainingMs.value / durationMs(phase.value, config)),
        accent: computed(() =>
          phase.value === "focus" ? "#e07a5f" : phase.value === "shortBreak" ? "#5fad8c" : "#6b8cae",
        ),
        ringOffset: computed(() => RING_C * (1 - Math.min(1, Math.max(0, remainingMs.value / durationMs(phase.value, config))))),
        start,
        stop,
        reset,
        toggleRun: () => (running.value ? stop() : start()),
      };
    },
  },
});
