function equal(actual: unknown, expected: unknown, message = "values differ"): void {
  if (!Object.is(actual, expected)) throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
function deepEqual(actual: unknown, expected: unknown, message = "values differ"): void {
  equal(JSON.stringify(actual), JSON.stringify(expected), message);
}
import { effectScope } from "vue";
import type { WidgetContext, WidgetProviderApi } from "@sdk/contract/sdk";
import { calendarWidget, type CalendarModel } from "./calendar";
import { PROVIDER_ID } from "../provider";
import { requestCalendarRefresh } from "../calendarLogic";

const calendars = [{ id: "work", name: "Work", primary: true }];
const event = { id: "meeting", calendarId: "work", title: "Standup", start: "2026-09-28T10:00:00Z", end: "2026-09-28T10:30:00Z" };
let eventReads = 0;
let subscriptions = 0;
const creates: Record<string, unknown>[] = [];
let finishCreate: () => void = () => {};
let calendarRead: Promise<unknown> = Promise.resolve(calendars);
const provider: WidgetProviderApi = {
  query: async <T>(name: string) => {
    if (name === "calendars") return await calendarRead as T;
    eventReads++;
    return [event] as T;
  },
  action: async <T>(_name: string, args?: Record<string, unknown>) => {
    creates.push(args ?? {});
    await new Promise<void>((resolve) => { finishCreate = resolve; });
    return undefined as T;
  },
  subscribe: async () => {
    subscriptions++;
    let active = true;
    return { unsubscribe() { if (active) subscriptions--; active = false; } };
  },
  refresh: async () => { throw new Error("not used here"); },
  status: async () => ({ state: "connected" }),
  onStatusChange: () => ({ unsubscribe() {} }),
};
const ctx: WidgetContext<{ calendars: string[] }> = {
  instanceId: "calendar-test", config: { calendars: ["work"] },
  providers: { [PROVIDER_ID]: provider },
  data: { get: async () => undefined, set: async () => {}, delete: async () => {} },
};
const scope = effectScope();
const model = await scope.run(() => calendarWidget.component.setup(ctx)) as CalendarModel;
try {
  model.selectDay("2026-09-28");
  equal(model.dayEvents.value[0]?.title, "Standup");
  equal(subscriptions, 1);
  model.quickTitle.value = "Planning";
  const creating = model.quickAdd();
  await model.quickAdd();
  await model.quickAdd();
  deepEqual(creates.map(({ title, calendarId }) => ({ title, calendarId })), [{ title: "Planning", calendarId: "work" }]);
  equal(model.creating.value, true);
  finishCreate();
  await creating;
  equal(model.quickTitle.value, "");
  equal(model.creating.value, false);
  equal(subscriptions, 1, "refresh replaces the subscription instead of multiplying it");
} finally { scope.stop(); }
equal(subscriptions, 0, "unmount releases the calendar subscription");
const readsAfterClose = eventReads;
requestCalendarRefresh(ctx.instanceId);
await Promise.resolve();
equal(eventReads, readsAfterClose, "a closed widget no longer responds to Refresh");

// Closing during the first network request must not create listeners afterwards.
let resolveCalendars: (value: unknown) => void = () => {};
calendarRead = new Promise((resolve) => { resolveCalendars = resolve; });
const pendingScope = effectScope();
const pending = pendingScope.run(() => calendarWidget.component.setup(ctx));
pendingScope.stop();
resolveCalendars(calendars);
await pending;
requestCalendarRefresh(ctx.instanceId);
await Promise.resolve();
equal(subscriptions, 0);
equal(eventReads, readsAfterClose);
console.log("calendar lifecycle and submission assertions passed");
