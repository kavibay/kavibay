import { effectScope } from "vue";
import type { WidgetContext } from "@sdk/contract/sdk";
import timerExtension from "../extension";
import {
  duplicateTimerData,
  runSetTimerAction,
  timerWidget,
  type TimerModel,
} from "./timer";
import { normalizeTimerState } from "../timerLogic";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(timerExtension.name === "timer", "the port keeps the timer extension id");
const cells = new Map<string, unknown>();
const data = {
  get: async <T>(key: string) => cells.get(key) as T | undefined,
  set: async <T>(key: string, value: T) => { cells.set(key, value); },
  delete: async (key: string) => { cells.delete(key); },
};
const context = {
  instanceId: "timer-assert",
  config: {},
  data,
} satisfies WidgetContext<Record<string, never>>;

const scope = effectScope();
const model = await scope.run(() => timerWidget.component.setup(context)) as TimerModel;
assert(model.chosenDurationMs.value === 5 * 60_000, "timer starts with the default duration");

await runSetTimerAction({ ctx: context, args: { duration: "90s" }, setConfig: () => undefined });
assert(model.chosenDurationMs.value === 90_000, "palette action applies the requested duration");
assert(model.running.value, "palette action starts the timer");

const duplicate = normalizeTimerState(duplicateTimerData("state", {
  durationMs: 90_000,
  remainingMs: 42_000,
  running: true,
  ringing: false,
  deadlineAt: Date.now() + 42_000,
}));
assert(!duplicate.running && !duplicate.ringing, "duplicates do not carry runtime status");
assert(duplicate.remainingMs === 90_000, "duplicate restores the full chosen duration");

scope.stop();
console.log("timer contract assertions passed");
