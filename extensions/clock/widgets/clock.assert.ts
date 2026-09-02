import { effectScope } from "vue";
import type { WidgetContext } from "@sdk/contract/sdk";
import clockExtension from "../extension";
import {
  clockWidget,
  formatClock,
  normalizeClockConfig,
  type ClockConfig,
  type ClockModel,
} from "./clock";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(clockExtension.name === "clock", "the port keeps the clock extension id");

const normalized = normalizeClockConfig({
  locale: "en-US",
  hour12: true,
  showSeconds: false,
  dateStyle: "none",
  timeZone: "not-a-zone",
});
assert(normalized.locale === "en-US", "valid locale survives normalization");
assert(normalized.hour12 === true, "12-hour mode survives normalization");
assert(normalized.showSeconds === false, "seconds can be disabled");
assert(normalized.dateStyle === "none", "date can be hidden");
assert(normalized.timeZone === "system", "invalid timezone falls back to system");

const formatted = formatClock(new Date("2026-01-02T03:04:05.000Z"), normalized);
assert(formatted.time.length > 0, "clock formatting returns a time");
assert(formatted.date === null, "dateStyle=none omits the date line");

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
let cleared = false;

globalThis.setInterval = ((handler, timeout) => {
  void handler;
  assert(timeout === 1000, "clock refreshes once per second");
  return 17 as ReturnType<typeof setInterval>;
}) as typeof setInterval;
globalThis.clearInterval = ((handle) => {
  cleared = handle === (17 as ReturnType<typeof setInterval>);
}) as typeof clearInterval;

try {
  const scope = effectScope();
  const model = scope.run(() =>
    clockWidget.component.setup({
      instanceId: "clock-assert",
      config: { showSeconds: false } satisfies ClockConfig,
      data: {} as WidgetContext<ClockConfig>["data"],
    }),
  ) as ClockModel;
  assert(model.now.value instanceof Date, "clock setup returns the current time");
  assert(model.formatted.value.date !== null, "default date style remains visible");
  scope.stop();
  assert(cleared, "scope disposal clears the clock interval");
} finally {
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
}

console.log("clock.assert.ts: ok");

