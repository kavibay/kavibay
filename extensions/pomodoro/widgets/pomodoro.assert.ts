import { effectScope } from "vue";
import {
  advanceAfterComplete,
  clampMinutes,
  durationMs,
  formatMmSs,
  normalizePomodoroState,
  pomodoroWidget,
  runPomodoroAction,
  type PomodoroConfig,
  type PomodoroModel,
  type PomodoroStoredState,
} from "./pomodoro";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const config: PomodoroConfig = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 };
assert(clampMinutes("0") === 1, "minutes have a lower bound");
assert(clampMinutes(12.4) === 12, "minutes are whole numbers");
const fourth = advanceAfterComplete("focus", 3);
assert(fourth.phase === "longBreak" && fourth.completedFocusSessions === 0, "fourth focus starts a long break");
assert(durationMs("shortBreak", config) === 5 * 60_000, "short break duration is configured");

// A countdown rounds up, so a timer stopped just after it started still reads
// as full. Flooring here made the component assertion below fail about one run
// in five, depending on whether a millisecond elapsed between start and stop.
assert(formatMmSs(10 * 60_000) === "10:00", "a whole duration reads whole");
assert(formatMmSs(10 * 60_000 - 1) === "10:00", "a started second still counts");
assert(formatMmSs(1) === "00:01", "the last second is shown until it is gone");
assert(formatMmSs(0) === "00:00", "only an elapsed timer reads zero");
assert(formatMmSs(-5) === "00:00", "overshoot is clamped");

const old = normalizePomodoroState({
  settings: config,
  phase: "shortBreak",
  completedFocusSessions: 2,
}, config);
assert(old.phase === "shortBreak", "legacy phase is preserved");
assert(old.remainingMs === 5 * 60_000, "legacy remaining time defaults from settings");
assert(!old.running, "legacy snapshots are not active timers");

const cells = new Map<string, unknown>();
const data = {
  get: async <T>(key: string) => cells.get(key) as T | undefined,
  set: async <T>(key: string, value: T) => { cells.set(key, value); },
  delete: async (key: string) => { cells.delete(key); },
};
const context = {
  instanceId: "pomodoro-assert",
  config,
  data,
};
let savedConfig: Record<string, unknown> | undefined;
await runPomodoroAction({
  ctx: context,
  args: { mode: "start", minutes: "10" },
  setConfig: (values) => {
    savedConfig = values;
    Object.assign(config, values);
  },
});
assert(JSON.stringify(savedConfig) === JSON.stringify({ focusMinutes: 10 }), "action updates focus config");
const started = cells.get("state") as PomodoroStoredState;
assert(started.running, "action starts the timer");
assert(started.remainingMs === 10 * 60_000, "action applies optional focus minutes");

await runPomodoroAction({ ctx: context, args: { mode: "stop" }, setConfig: () => undefined });
assert(!(cells.get("state") as PomodoroStoredState).running, "action stops the timer");

const scope = effectScope();
const model = await scope.run(() => pomodoroWidget.component.setup(context)) as PomodoroModel;
assert(model.displayTime.value === "10:00", "component restores the configured focus duration");
model.start();
assert(model.running.value, "component starts the timer");
scope.stop();

console.log("pomodoro contract assertions passed");
