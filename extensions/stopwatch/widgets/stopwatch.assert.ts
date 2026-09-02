import { effectScope } from "vue";
import type { WidgetContext } from "@sdk/contract/sdk";
import stopwatchExtension from "../extension";
import {
  createLapEntry,
  elapsedMs,
  formatElapsed,
  stopwatchWidget,
  type StopwatchModel,
} from "./stopwatch";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(stopwatchExtension.name === "stopwatch", "the port keeps the stopwatch extension id");
assert(formatElapsed(0) === "00:00.00", "zero has centisecond precision");
assert(formatElapsed(3_661_239) === "1:01:01.23", "hours use the long format");
assert(elapsedMs(500, true, 1_000, 1_750) === 1_250, "running time includes its live segment");
assert(createLapEntry(2_500, [{ id: "lap-1", atMs: 1_000, splitMs: 1_000 }], "lap-2").splitMs === 1_500, "lap split starts at the previous lap");

function memoryData(initial?: unknown): WidgetContext<Record<string, never>>["data"] {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set("session-state", initial);
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
    async delete(key: string): Promise<void> {
      values.delete(key);
    },
  };
}

const originalNow = Date.now;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
let now = 1_000;
let tick: (() => void) | undefined;
let cleared = false;

Date.now = () => now;
globalThis.setInterval = ((handler, timeout) => {
  assert(timeout === 75, "the stopwatch refreshes at centisecond resolution");
  tick = handler as () => void;
  return 23 as ReturnType<typeof setInterval>;
}) as typeof setInterval;
globalThis.clearInterval = ((handle) => {
  if (handle === (23 as ReturnType<typeof setInterval>)) cleared = true;
}) as typeof clearInterval;

try {
  const data = memoryData();
  const context = {
    instanceId: "stopwatch-assert",
    config: {},
    data,
  } satisfies WidgetContext<Record<string, never>>;

  const firstScope = effectScope();
  const first = await firstScope.run(() => stopwatchWidget.component.setup(context)) as StopwatchModel;
  assert(first.statusText.value === "Ready", "a new stopwatch starts ready");

  first.toggleRun();
  now = 2_234;
  tick?.();
  assert(first.displayTime.value === "00:01.23", "the live display follows the clock");
  first.lap();
  now = 3_500;
  tick?.();
  first.lap();
  assert(first.displayLaps.value[0]?.lapNumber === 2, "newest lap is shown first");
  assert(first.displayLaps.value[0]?.split === "00:01.26", "lap split is preserved");

  firstScope.stop();
  assert(cleared, "scope disposal clears the tick interval");
  assert(first.running.value === false, "scope disposal pauses the stopwatch");

  const secondScope = effectScope();
  const second = await secondScope.run(() => stopwatchWidget.component.setup(context)) as StopwatchModel;
  assert(second.statusText.value === "Paused", "remount restores paused session state");
  assert(second.displayTime.value === "00:02.50", "remount keeps elapsed time");
  assert(second.displayLaps.value.length === 2, "remount keeps laps");
  second.reset();
  assert(second.displayTime.value === "00:00.00", "reset clears elapsed time");
  assert(second.displayLaps.value.length === 0, "reset clears laps");
  secondScope.stop();

  const staleScope = effectScope();
  const stale = await staleScope.run(() => stopwatchWidget.component.setup({
    ...context,
    instanceId: "stopwatch-stale",
    data: memoryData({
      sessionId: "previous-app-session",
      accumulatedMs: 9_999,
      laps: [],
      lapCounter: 0,
    }),
  })) as StopwatchModel;
  assert(stale.displayTime.value === "00:00.00", "state from an earlier app session is ignored");
  staleScope.stop();
} finally {
  Date.now = originalNow;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
}

console.log("stopwatch.assert.ts: ok");

