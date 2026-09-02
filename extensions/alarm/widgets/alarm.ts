// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, type Ref } from "vue";
import {
  defineWidget,
  type AlarmNotification,
  type WidgetActionContext,
  type WidgetContext,
} from "@sdk/contract/sdk";
import {
  clampHour,
  clampMinute,
  createDefaultAlarm,
  nextFireAtMs,
  normalizeAlarmNotifyMode,
  normalizePersisted,
  notifyWantsPop,
  notifyWantsSound,
  parseTimeString,
  type AlarmItem,
  type AlarmNotifyMode,
  type AlarmPersisted,
} from "../alarmLogic";

export const ALARM_DATA_KEY = "alarms";

export interface AlarmModel {
  alarms: Ref<AlarmItem[]>;
  ringingIds: Ref<string[]>;
  addAlarm(): string;
  removeAlarm(alarmId: string): void;
  toggleEnabled(alarmId: string): void;
  setAlarmTime(alarmId: string, hours: number, minutes: number): void;
  setAlarmTimeFromString(alarmId: string, value: string): void;
  setAlarmLabel(alarmId: string, label: string): void;
  setAlarmNotifyMode(alarmId: string, mode: AlarmNotifyMode): void;
  dismiss(alarmId: string): void;
}

interface LiveAlarmModel {
  /** Prevent an older async hydration result from replacing a newer action. */
  revision: number;
  replace(alarms: AlarmItem[]): void;
}

const liveAlarmModels = new Map<string, LiveAlarmModel>();

function persist(ctx: WidgetContext, alarms: AlarmItem[]): void {
  void ctx.data.set(ALARM_DATA_KEY, normalizePersisted({ alarms }));
}

/** Duplicate only the durable alarm list; timers and ringing are instance-local. */
export function duplicateAlarmData(key: string, value: unknown): unknown {
  return key === ALARM_DATA_KEY ? normalizePersisted(value) : value;
}

function notificationFor(modes: AlarmNotifyMode[]): AlarmNotification {
  const sound = modes.some(notifyWantsSound);
  const pop = modes.some(notifyWantsPop);
  if (sound && pop) return "sound_and_pop";
  if (sound) return "sound";
  if (pop) return "pop";
  return "none";
}

/** Palette action; it writes instance data and also works before the widget mounts. */
export async function runSetAlarmAction({
  ctx,
  args,
}: WidgetActionContext): Promise<void> {
  const parsed = parseTimeString(args.time ?? "");
  if (!parsed) throw new Error("time must be HH:MM, H:MM, or HHMM");

  const current = normalizePersisted(await ctx.data.get<AlarmPersisted>(ALARM_DATA_KEY));
  const alarm = createDefaultAlarm();
  alarm.hours = parsed.hours;
  alarm.minutes = parsed.minutes;
  if (args.label !== undefined) alarm.label = args.label.trim();
  const next = normalizePersisted({ alarms: [...current.alarms, alarm] }).alarms;
  await ctx.data.set(ALARM_DATA_KEY, { alarms: next });

  // The palette action may target an already-mounted card. Keep that model in
  // sync as well as the durable cell; a fresh mount still uses ctx.data.
  const live = liveAlarmModels.get(ctx.instanceId);
  if (live) {
    live.revision += 1;
    live.replace(next);
  }
}

export const alarmWidget = defineWidget({
  name: "alarm",
  displayName: "Alarm",
  description: "Set and manage local alarms.",
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 3, h: 2 },
  mode: "both",
  capabilities: { alarm: true },
  duplicateData: true,
  duplicateDataTransform: duplicateAlarmData,
  actions: { "set-alarm": runSetAlarmAction },
  component: {
    setup(ctx: WidgetContext): AlarmModel {
      const alarms = ref<AlarmItem[]>([]);
      const ringingIds = ref<string[]>([]);
      const nextFireAt = new Map<string, number>();
      let alive = true;

      function scheduleAlarm(alarmId: string, skipCurrentMinute: boolean): void {
        const alarm = alarms.value.find((item) => item.id === alarmId);
        if (!alarm?.enabled) {
          nextFireAt.delete(alarmId);
          return;
        }
        nextFireAt.set(
          alarmId,
          nextFireAtMs(alarm.hours, alarm.minutes, new Date(), skipCurrentMinute),
        );
      }

      function ensureSchedules(): void {
        for (const alarm of alarms.value) {
          if (!alarm.enabled) nextFireAt.delete(alarm.id);
          else if (!nextFireAt.has(alarm.id)) scheduleAlarm(alarm.id, false);
        }
      }

      /** Replace durable rows and discard schedules for rows that disappeared. */
      function replaceAlarms(next: AlarmItem[]): void {
        const ids = new Set(next.map((alarm) => alarm.id));
        for (const id of nextFireAt.keys()) {
          if (!ids.has(id)) nextFireAt.delete(id);
        }
        alarms.value = next;
        ensureSchedules();
      }

      const liveModel: LiveAlarmModel = {
        revision: 0,
        replace: replaceAlarms,
      };
      liveAlarmModels.set(ctx.instanceId, liveModel);

      function notifyFired(modes: AlarmNotifyMode[]): void {
        const notification = notificationFor(modes);
        if (!ctx.alarm || notification === "none") return;
        void ctx.alarm.notify(notification).catch(() => {
          // The row remains ringing even if the host window is unavailable.
        });
      }

      function onTick(): void {
        const now = Date.now();
        const firedModes: AlarmNotifyMode[] = [];
        for (const alarm of alarms.value) {
          if (!alarm.enabled) continue;
          let due = nextFireAt.get(alarm.id);
          if (due == null) {
            scheduleAlarm(alarm.id, false);
            due = nextFireAt.get(alarm.id);
          }
          if (due == null || now < due) continue;
          if (!ringingIds.value.includes(alarm.id)) {
            ringingIds.value = [...ringingIds.value, alarm.id];
          }
          scheduleAlarm(alarm.id, true);
          firedModes.push(normalizeAlarmNotifyMode(alarm.notifyMode));
        }
        if (firedModes.length) notifyFired(firedModes);
      }

      function addAlarm(): string {
        const alarm = createDefaultAlarm();
        liveModel.revision += 1;
        alarms.value = [...alarms.value, alarm];
        scheduleAlarm(alarm.id, false);
        persist(ctx, alarms.value);
        return alarm.id;
      }

      function removeAlarm(alarmId: string): void {
        liveModel.revision += 1;
        alarms.value = alarms.value.filter((alarm) => alarm.id !== alarmId);
        nextFireAt.delete(alarmId);
        ringingIds.value = ringingIds.value.filter((id) => id !== alarmId);
        persist(ctx, alarms.value);
      }

      function toggleEnabled(alarmId: string): void {
        const current = alarms.value.find((alarm) => alarm.id === alarmId);
        const enabling = current ? !current.enabled : false;
        liveModel.revision += 1;
        alarms.value = alarms.value.map((alarm) =>
          alarm.id === alarmId ? { ...alarm, enabled: !alarm.enabled } : alarm,
        );
        if (enabling) scheduleAlarm(alarmId, true);
        else {
          nextFireAt.delete(alarmId);
          ringingIds.value = ringingIds.value.filter((id) => id !== alarmId);
        }
        persist(ctx, alarms.value);
      }

      function setAlarmTime(alarmId: string, hours: number, minutes: number): void {
        const nextHours = clampHour(hours);
        const nextMinutes = clampMinute(minutes);
        const current = alarms.value.find((alarm) => alarm.id === alarmId);
        if (!current || (current.hours === nextHours && current.minutes === nextMinutes)) return;
        liveModel.revision += 1;
        alarms.value = alarms.value.map((alarm) =>
          alarm.id === alarmId ? { ...alarm, hours: nextHours, minutes: nextMinutes } : alarm,
        );
        scheduleAlarm(alarmId, true);
        persist(ctx, alarms.value);
      }

      function setAlarmTimeFromString(alarmId: string, value: string): void {
        const parsed = parseTimeString(value);
        if (parsed) setAlarmTime(alarmId, parsed.hours, parsed.minutes);
      }

      function setAlarmLabel(alarmId: string, label: string): void {
        liveModel.revision += 1;
        alarms.value = alarms.value.map((alarm) =>
          alarm.id === alarmId ? { ...alarm, label } : alarm,
        );
        persist(ctx, alarms.value);
      }

      function setAlarmNotifyMode(alarmId: string, mode: AlarmNotifyMode): void {
        const next = normalizeAlarmNotifyMode(mode);
        liveModel.revision += 1;
        alarms.value = alarms.value.map((alarm) =>
          alarm.id === alarmId ? { ...alarm, notifyMode: next } : alarm,
        );
        persist(ctx, alarms.value);
      }

      function dismiss(alarmId: string): void {
        ringingIds.value = ringingIds.value.filter((id) => id !== alarmId);
      }

      const hydrationRevision = liveModel.revision;
      void ctx.data.get<AlarmPersisted>(ALARM_DATA_KEY).then((raw) => {
        if (!alive) return;
        if (liveModel.revision !== hydrationRevision) return;
        replaceAlarms(normalizePersisted(raw).alarms);
      });

      ensureSchedules();
      const tickTimer = setInterval(onTick, 1_000);
      onScopeDispose(() => {
        alive = false;
        liveAlarmModels.delete(ctx.instanceId);
        clearInterval(tickTimer);
        persist(ctx, alarms.value);
      });

      return {
        alarms,
        ringingIds,
        addAlarm,
        removeAlarm,
        toggleEnabled,
        setAlarmTime,
        setAlarmTimeFromString,
        setAlarmLabel,
        setAlarmNotifyMode,
        dismiss,
      };
    },
  },
});
