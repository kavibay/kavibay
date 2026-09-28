// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, shallowReactive, type ComputedRef, type Ref } from "vue";
import {
  defineWidget,
  type WidgetActionContext,
  type WidgetContext,
  type WidgetPaletteInstanceAction,
} from "@sdk/contract/sdk";
import {
  DEFAULT_DURATION_MS,
  TIMER_PRESETS_MINUTES,
  clampDurationMs,
  formatRemaining,
  normalizePersisted,
  normalizeTimerState,
  parseCustomDuration,
  presetDurationMs,
  timerInlineActions,
  timerInlineView,
  type TimerStoredState,
} from "../timerLogic";

export const TIMER_STATE_KEY = "state";

export interface TimerModel {
  presets: typeof TIMER_PRESETS_MINUTES;
  chosenDurationMs: Ref<number>;
  remainingMs: Ref<number>;
  running: Ref<boolean>;
  ringing: Ref<boolean>;
  displayTime: ComputedRef<string>;
  statusText: ComputedRef<string>;
  canEditDuration: ComputedRef<boolean>;
  start(): void;
  pause(): void;
  toggleRun(): void;
  reset(): void;
  dismiss(): void;
  selectPreset(minutes: number): void;
  setCustomDuration(ms: number): void;
}

// Palette previews must follow a model handoff between the desk and inline panel.
const liveModels = shallowReactive(new Map<string, TimerModel>());

export function duplicateTimerData(key: string, value: unknown): unknown {
  if (key !== TIMER_STATE_KEY) return value;
  const state = normalizeTimerState(value);
  return {
    ...state,
    remainingMs: state.durationMs,
    running: false,
    ringing: false,
    deadlineAt: null,
  } satisfies TimerStoredState;
}

function playTimerEndBeep(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    const context = new Ctx();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);

    const now = context.currentTime;
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    oscillator.start(now);
    oscillator.stop(now + 0.35);
    oscillator.onended = () => void context.close();
  } catch {
    // Audio can be unavailable in a preview or before a user gesture.
  }
}

function snapshot(model: TimerModel, deadlineAt: number | null): TimerStoredState {
  return {
    durationMs: model.chosenDurationMs.value,
    remainingMs:
      model.running.value && deadlineAt !== null
        ? Math.max(0, deadlineAt - Date.now())
        : model.remainingMs.value,
    running: model.running.value,
    ringing: model.ringing.value,
    deadlineAt,
  };
}

export function timerInlineViewForInstance(instanceId: string) {
  const model = liveModels.get(instanceId);
  if (!model) return null;
  return timerInlineView({
    remainingMs: model.remainingMs.value,
    durationMs: model.chosenDurationMs.value,
    running: model.running.value,
    ringing: model.ringing.value,
  });
}

export function timerInstanceActions(instanceId: string): WidgetPaletteInstanceAction[] {
  const model = liveModels.get(instanceId);
  if (!model) return [];

  const current = {
    remainingMs: model.remainingMs.value,
    durationMs: model.chosenDurationMs.value,
    running: model.running.value,
    ringing: model.ringing.value,
  };
  const setParam = {
    name: "duration",
    type: "text" as const,
    required: true,
    placeholder: "Duration (25m, 1h30)",
  };
  const runSet = (value: string) => {
    const duration = parseCustomDuration(value);
    if (duration == null) throw new Error(`unparsable duration: "${value}"`);
    model.reset();
    model.setCustomDuration(duration);
    model.start();
  };
  const actions = timerInlineActions(current);
  const run: Record<string, (value: string) => void> = {
    start: () => model.start(),
    pause: () => model.pause(),
    resume: () => model.start(),
    restart: () => {
      model.reset();
      model.start();
    },
    reset: () => model.reset(),
    dismiss: () => model.dismiss(),
    set: runSet,
  };
  return actions.map((action) => ({
    ...action,
    ...(action.id === "set" ? { param: setParam } : {}),
    run: run[action.id]!,
  }));
}

/** Palette action; it also works while the target card is not mounted. */
export async function runSetTimerAction({
  ctx,
  args,
}: WidgetActionContext<Record<string, never>>): Promise<void> {
  const durationMs = parseCustomDuration(args.duration ?? "");
  if (durationMs == null) throw new Error(`unparsable duration: "${args.duration}"`);

  const live = liveModels.get(ctx.instanceId);
  if (live) {
    live.reset();
    live.setCustomDuration(durationMs);
    live.start();
    return;
  }

  const current = normalizeTimerState(await ctx.data.get<TimerStoredState>(TIMER_STATE_KEY));
  const now = Date.now();
  await ctx.data.set(TIMER_STATE_KEY, {
    ...current,
    durationMs,
    remainingMs: durationMs,
    running: true,
    ringing: false,
    deadlineAt: now + durationMs,
  });
}

export const timerWidget = defineWidget<Record<string, never>>({
  name: "timer",
  displayName: "Timer",
  description: "Countdown timer with presets.",
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 2, h: 2 },
  mode: "both",
  duplicateData: true,
  duplicateDataTransform: duplicateTimerData,
  palette: {
    inlineView: timerInlineViewForInstance,
    instanceActions: timerInstanceActions,
  },
  actions: { "set-timer": runSetTimerAction },
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>): Promise<TimerModel> {
      const initial = normalizePersisted(undefined);
      const chosenDurationMs = ref(initial.durationMs || DEFAULT_DURATION_MS);
      const remainingMs = ref(chosenDurationMs.value);
      const running = ref(false);
      const ringing = ref(false);
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

      const persist = () => {
        if (!hydrated) return;
        const current = liveModels.get(ctx.instanceId);
        if (!current) return;
        void ctx.data.set(TIMER_STATE_KEY, snapshot(current, deadlineAt)).catch(() => undefined);
      };

      const finish = () => {
        clearTick();
        deadlineAt = null;
        running.value = false;
        remainingMs.value = 0;
        ringing.value = true;
        playTimerEndBeep();
        persist();
      };

      const onTick = () => {
        if (deadlineAt === null) return;
        tickNow.value = Date.now();
        remainingMs.value = Math.max(0, deadlineAt - tickNow.value);
        if (remainingMs.value <= 0) finish();
      };

      const applyDuration = (ms: number) => {
        const clamped = clampDurationMs(ms);
        chosenDurationMs.value = clamped;
        if (!running.value && !ringing.value) remainingMs.value = clamped;
        persist();
      };

      const start = () => {
        if (running.value || ringing.value) return;
        if (remainingMs.value <= 0) remainingMs.value = chosenDurationMs.value;
        deadlineAt = Date.now() + remainingMs.value;
        running.value = true;
        clearTick();
        tickTimer = setInterval(onTick, 250);
        persist();
      };

      const pause = () => {
        if (!running.value) return;
        onTick();
        deadlineAt = null;
        running.value = false;
        clearTick();
        persist();
      };

      const reset = () => {
        pause();
        ringing.value = false;
        remainingMs.value = chosenDurationMs.value;
        persist();
      };

      const dismiss = () => {
        if (!ringing.value) return;
        ringing.value = false;
        remainingMs.value = chosenDurationMs.value;
        persist();
      };

      const model: TimerModel = {
        presets: TIMER_PRESETS_MINUTES,
        chosenDurationMs,
        remainingMs,
        running,
        ringing,
        displayTime: computed(() => formatRemaining(remainingMs.value)),
        statusText: computed(() => {
          if (ringing.value) return "Done";
          if (running.value) return "Running…";
          if (remainingMs.value < chosenDurationMs.value) return "Paused";
          return "Ready";
        }),
        canEditDuration: computed(() => !running.value && !ringing.value),
        start,
        pause,
        toggleRun: () => (running.value ? pause() : start()),
        reset,
        dismiss,
        selectPreset: (minutes) => {
          if (model.canEditDuration.value) applyDuration(presetDurationMs(minutes));
        },
        setCustomDuration: (ms) => {
          if (model.canEditDuration.value) applyDuration(ms);
        },
      };
      liveModels.set(ctx.instanceId, model);

      onScopeDispose(() => {
        disposed = true;
        clearTick();
        if (hydrated) persist();
        liveModels.delete(ctx.instanceId);
      });

      const saved = normalizeTimerState(await ctx.data.get<TimerStoredState>(TIMER_STATE_KEY));
      if (disposed) return model;
      chosenDurationMs.value = saved.durationMs;
      remainingMs.value = saved.remainingMs;
      ringing.value = saved.ringing;
      if (saved.running && saved.deadlineAt !== null) {
        deadlineAt = saved.deadlineAt;
        if (deadlineAt > Date.now()) {
          running.value = true;
          tickTimer = setInterval(onTick, 250);
        } else {
          finish();
        }
      }
      hydrated = true;
      return model;
    },
  },
});
