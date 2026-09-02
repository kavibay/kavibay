/**
 * Asserts for alarm notify-mode helpers + persistence normalize.
 * Run: npx tsx extensions/alarm/alarmLogic.assert.ts
 */
import {
  DEFAULT_ALARM_NOTIFY_MODE,
  createDefaultAlarm,
  normalizeAlarmItem,
  normalizeAlarmNotifyMode,
  normalizePersisted,
  notifyWantsPop,
  notifyWantsSound,
} from "./alarmLogic";
import { effectScope } from "vue";
import extension from "./extension";
import {
  ALARM_DATA_KEY,
  alarmWidget,
  runSetAlarmAction,
  type AlarmModel,
} from "./widgets/alarm";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(extension.name === "alarm", "contract extension name");
assert(alarmWidget.capabilities?.alarm === true, "alarm capability");

assert(normalizeAlarmNotifyMode("sound_and_pop") === "sound_and_pop", "keep sound_and_pop");
assert(normalizeAlarmNotifyMode("pop") === "pop", "keep pop");
assert(normalizeAlarmNotifyMode("sound") === "sound", "keep sound");
assert(normalizeAlarmNotifyMode("none") === "none", "keep none");
assert(
  normalizeAlarmNotifyMode("nope") === DEFAULT_ALARM_NOTIFY_MODE,
  "unknown → default",
);
assert(normalizeAlarmNotifyMode(undefined) === DEFAULT_ALARM_NOTIFY_MODE, "missing → default");

assert(notifyWantsSound("sound_and_pop") && notifyWantsPop("sound_and_pop"), "both");
assert(!notifyWantsSound("pop") && notifyWantsPop("pop"), "pop only");
assert(notifyWantsSound("sound") && !notifyWantsPop("sound"), "sound only");
assert(!notifyWantsSound("none") && !notifyWantsPop("none"), "silent");

const fresh = createDefaultAlarm(new Date("2026-08-01T12:00:00"));
assert(fresh.notifyMode === DEFAULT_ALARM_NOTIFY_MODE, "default row uses sound+pop");

const legacy = normalizeAlarmItem({
  id: "a1",
  hours: 7,
  minutes: 30,
  enabled: true,
  label: "Wake",
});
assert(legacy != null, "legacy item normalizes");
assert(legacy!.notifyMode === DEFAULT_ALARM_NOTIFY_MODE, "legacy missing mode → default");

const withMode = normalizeAlarmItem({
  id: "a2",
  hours: 9,
  minutes: 0,
  notifyMode: "sound",
});
assert(withMode?.notifyMode === "sound", "persisted mode kept");

const cells = new Map<string, unknown>();
const context = {
  instanceId: "alarm-assert",
  config: {},
  data: {
    get: async <T>(key: string) => cells.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => { cells.set(key, value); },
    delete: async (key: string) => { cells.delete(key); },
  },
};
await alarmWidget.actions!["set-alarm"]({
  ctx: context,
  args: { time: "07:30", label: "Wake" },
  setConfig: () => undefined,
});
const actionState = normalizePersisted(cells.get(ALARM_DATA_KEY));
assert(actionState.alarms.length === 1, "palette action persists one alarm");
assert(actionState.alarms[0]!.hours === 7 && actionState.alarms[0]!.minutes === 30, "action time");
assert(actionState.alarms[0]!.label === "Wake", "action label");

// The action can race the model's first async data read when it creates a new
// card. The new row must survive the stale hydration result and be visible in
// the already-mounted model.
{
  let releaseHydration!: (value: unknown) => void;
  const hydration = new Promise<unknown>((resolve) => { releaseHydration = resolve; });
  let stored: unknown;
  let reads = 0;
  const raceContext = {
    instanceId: "alarm-race",
    config: {},
    data: {
      get: async <T>(_key: string) => {
        reads += 1;
        return (reads === 1 ? await hydration : stored) as T | undefined;
      },
      set: async <T>(_key: string, value: T) => { stored = value; },
      delete: async (_key: string) => undefined,
    },
  };

  let model!: AlarmModel;
  const scope = effectScope();
  scope.run(() => {
    model = alarmWidget.component.setup(raceContext) as AlarmModel;
  });
  await runSetAlarmAction({
    ctx: raceContext,
    args: { time: "08:04" },
    setConfig: () => undefined,
  });
  assert(model.alarms.value.length === 1, "action updates mounted alarm model");
  assert(
    model.alarms.value[0]!.hours === 8 && model.alarms.value[0]!.minutes === 4,
    "mounted model shows action time",
  );

  releaseHydration({ alarms: [] });
  await Promise.resolve();
  await Promise.resolve();
  assert(model.alarms.value.length === 1, "stale hydration cannot erase action row");
  scope.stop();
}

console.log("alarmLogic.assert.ts: ok");
