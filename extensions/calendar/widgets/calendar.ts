// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import {
  buildMonthGrid,
  dateKeyFromDate,
  defaultQuickAddEnd,
  defaultQuickAddStart,
  dateKeysForEvent,
  eventsForDay,
  monthRangeIso,
  onCalendarRefreshRequest,
  type MonthCell,
} from "../calendarLogic";
import { PROVIDER_ID, type CalendarEvent, type CalendarInfo } from "../provider";

export interface CalendarModel {
  calendars: ComputedRef<CalendarInfo[]>;
  calendarLabel: ComputedRef<string>;
  calendarColor(calendarId: string): string | null;
  quickCalendarId: Ref<string>;
  viewYear: Ref<number>;
  viewMonth: Ref<number>;
  selectedDayKey: Ref<string>;
  monthCells: ComputedRef<MonthCell[]>;
  monthLabel: ComputedRef<string>;
  dayDots: ComputedRef<Map<string, string[]>>;
  dayEvents: ComputedRef<CalendarEvent[]>;
  quickTitle: Ref<string>;
  quickStartLocal: Ref<string>;
  creating: Ref<boolean>;
  createError: Ref<string | null>;
  titleHint: Ref<boolean>;
  loading: Ref<boolean>;
  refresh(): Promise<void>;
  prevMonth(): void;
  nextMonth(): void;
  selectDay(dateKey: string): void;
  quickAdd(): Promise<void>;
  openMeeting(url: string): Promise<void>;
  formatEventTime(event: CalendarEvent): string;
}

interface CalendarConfig {
  calendars: string[];
}

interface CalendarQueryArgs {
  [key: string]: string;
  calendarId: string;
  rangeStart: string;
  rangeEnd: string;
}

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const FALLBACK_CALENDAR_COLORS = [
  "#60a5fa",
  "#f87171",
  "#fbbf24",
  "#34d399",
  "#c084fc",
  "#fb7185",
  "#22d3ee",
  "#a3e635",
  "#f97316",
  "#818cf8",
  "#2dd4bf",
  "#e879f9",
];

function toDatetimeLocalValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function fromDatetimeLocalValue(value: string): Date {
  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute || 0, 0, 0);
}

function firstDayOfMonth(year: number, month: number): string {
  return dateKeyFromDate(new Date(year, month, 1));
}

export const calendarWidget = defineWidget<CalendarConfig>({
  name: "calendar",
  displayName: "Google Calendar",
  description: "A month view and agenda for multiple Google Calendars.",
  defaultSize: { w: 3, h: 4 },
  minSize: { w: 3, h: 3 },
  mode: "both",
  // The quick-add form writes; the rest of the widget only reads.
  requires: { providers: [PROVIDER_ID], actions: { [PROVIDER_ID]: ["createEvent"] } },
  capabilities: { openExternal: true },
  configuration: {
    calendars: {
      type: "select",
      label: "Calendars",
      required: true,
      multiple: true,
      source: { provider: PROVIDER_ID, query: "calendars" },
    },
  },
  component: {
    async setup(ctx: WidgetContext<CalendarConfig>): Promise<CalendarModel> {
      const provider = ctx.providers![PROVIDER_ID]!;
      let eventSubscriptions: Array<{ unsubscribe(): void }> = [];
      let unsubscribeRefresh: (() => void) | undefined;
      let disposed = false;
      // An async setup leaves Vue's active scope at its first await.
      onScopeDispose(() => {
        disposed = true;
        for (const subscription of eventSubscriptions) subscription.unsubscribe();
        eventSubscriptions = [];
        unsubscribeRefresh?.();
      });
      const configuredCalendarIds = Array.isArray(ctx.config.calendars)
        ? [...new Set(ctx.config.calendars.map(String).filter(Boolean))]
        : [];
      const calendars = await provider.query<CalendarInfo[]>("calendars", {});
      const selectedCalendars = calendars.filter((calendar) =>
        configuredCalendarIds.includes(calendar.id),
      );

      if (configuredCalendarIds.length === 0 || selectedCalendars.length !== configuredCalendarIds.length) {
        const missing = configuredCalendarIds.filter(
          (id) => !selectedCalendars.some((calendar) => calendar.id === id),
        );
        throw {
          kind: "not-found",
          message: missing.length > 0
            ? `calendar(s) "${missing.join(", ")}" are not available`
            : "select at least one calendar in Settings",
        };
      }

      const selectedCalendarIds = selectedCalendars.map((calendar) => calendar.id);
      const calendarColorById = new Map<string, string>();
      const usedColors = new Set<string>();
      selectedCalendars.forEach((calendar, index) => {
        const preferred = calendar.color?.trim();
        const preferredKey = preferred?.toLowerCase();
        const fallback = FALLBACK_CALENDAR_COLORS.find(
          (color) => !usedColors.has(color.toLowerCase()),
        ) ?? `hsl(${(index * 137.5) % 360} 72% 64%)`;
        const color = preferred && preferredKey && !usedColors.has(preferredKey)
          ? preferred
          : fallback;
        calendarColorById.set(calendar.id, color);
        usedColors.add(color.toLowerCase());
      });

      const now = new Date();
      const viewYear = ref(now.getFullYear());
      const viewMonth = ref(now.getMonth());
      const selectedDayKey = ref(dateKeyFromDate(now));
      const eventsByCalendar = ref<Record<string, CalendarEvent[]>>({});
      const loading = ref(false);
      const quickTitle = ref("");
      const quickStartLocal = ref(
        toDatetimeLocalValue(defaultQuickAddStart(selectedDayKey.value, new Date())),
      );
      const creating = ref(false);
      const createError = ref<string | null>(null);
      const titleHint = ref(false);
      const quickCalendarId = ref(selectedCalendarIds[0]!);
      let subscriptionSequence = 0;
      let loadSequence = 0;

      const eventArgs = (calendarId: string): CalendarQueryArgs => {
        const range = monthRangeIso(viewYear.value, viewMonth.value);
        return { calendarId, ...range };
      };

      const subscribeToVisibleMonth = async () => {
        if (disposed) return;
        const sequence = ++subscriptionSequence;
        for (const subscription of eventSubscriptions) subscription.unsubscribe();
        eventSubscriptions = [];
        const results = await Promise.allSettled(
          selectedCalendarIds.map((calendarId) =>
            provider.subscribe<CalendarEvent[]>("events", eventArgs(calendarId), (state) => {
              if (!disposed && sequence === subscriptionSequence && state.status === "success") {
                eventsByCalendar.value = { ...eventsByCalendar.value, [calendarId]: state.data };
              }
            }),
          ),
        );
        const subscriptions = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        const failure = results.find((result) => result.status === "rejected");
        if (disposed || sequence !== subscriptionSequence || failure) {
          for (const subscription of subscriptions) subscription.unsubscribe();
          if (failure && !disposed && sequence === subscriptionSequence) throw failure.reason;
          return;
        }
        eventSubscriptions = subscriptions;
      };

      const loadEvents = async (): Promise<void> => {
        if (disposed) return;
        const sequence = ++loadSequence;
        loading.value = true;
        const next = await Promise.all(
          selectedCalendarIds.map(async (calendarId) => [
            calendarId,
            await provider.query<CalendarEvent[]>("events", eventArgs(calendarId)),
          ] as const),
        );
        if (!disposed && sequence === loadSequence) {
          eventsByCalendar.value = Object.fromEntries(next);
          loading.value = false;
        }
      };

      const refresh = async () => {
        await loadEvents();
        await subscribeToVisibleMonth();
      };

      if (!disposed) {
        unsubscribeRefresh = onCalendarRefreshRequest(ctx.instanceId, () => {
          void refresh();
        });
      }

      await loadEvents();
      await subscribeToVisibleMonth();

      const monthCells = computed(() =>
        buildMonthGrid(viewYear.value, viewMonth.value, dateKeyFromDate(new Date())),
      );
      const monthLabel = computed(() =>
        new Date(viewYear.value, viewMonth.value, 1).toLocaleString(undefined, {
          month: "long",
          year: "numeric",
        }),
      );
      const allEvents = computed(() =>
        Object.values(eventsByCalendar.value)
          .flat()
          .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
      );
      const dayDots = computed(() => {
        const dots = new Map<string, string[]>();
        for (const event of allEvents.value) {
          const color = calendarColorById.get(event.calendarId);
          if (!color) continue;
          for (const dateKey of dateKeysForEvent(event)) {
            const colors = dots.get(dateKey) ?? [];
            if (!colors.includes(color)) colors.push(color);
            dots.set(dateKey, colors);
          }
        }
        return dots;
      });
      const dayEvents = computed(
        () => eventsForDay(allEvents.value, selectedDayKey.value) as CalendarEvent[],
      );
      const calendarLabel = computed(() => selectedCalendars.map((calendar) => calendar.name).join(" · "));

      const selectDay = (dateKey: string) => {
        selectedDayKey.value = dateKey;
        quickStartLocal.value = toDatetimeLocalValue(
          defaultQuickAddStart(dateKey, new Date()),
        );
        titleHint.value = false;
        createError.value = null;
      };

      const moveMonth = (delta: number) => {
        const next = new Date(viewYear.value, viewMonth.value + delta, 1);
        viewYear.value = next.getFullYear();
        viewMonth.value = next.getMonth();
        selectDay(firstDayOfMonth(viewYear.value, viewMonth.value));
        void loadEvents();
        void subscribeToVisibleMonth();
      };

      const quickAdd = async () => {
        if (creating.value || disposed) return;
        const title = quickTitle.value.trim();
        if (!title) {
          titleHint.value = true;
          return;
        }

        const start = fromDatetimeLocalValue(quickStartLocal.value);
        if (Number.isNaN(start.getTime())) {
          createError.value = "Choose a valid start time.";
          return;
        }

        titleHint.value = false;
        createError.value = null;
        creating.value = true;
        try {
          await provider.action("createEvent", {
            calendarId: quickCalendarId.value,
            title,
            start: start.toISOString(),
            end: defaultQuickAddEnd(start).toISOString(),
          });
          quickTitle.value = "";
          selectDay(selectedDayKey.value);
          await refresh();
        } catch (cause) {
          createError.value = cause instanceof Error ? cause.message : String(cause);
        } finally {
          creating.value = false;
        }
      };

      const openMeeting = async (url: string) => {
        if (ctx.openExternal) await ctx.openExternal.open(url);
      };

      return {
        calendars: computed(() => selectedCalendars),
        calendarLabel,
        calendarColor: (calendarId: string) => calendarColorById.get(calendarId) ?? null,
        quickCalendarId,
        viewYear,
        viewMonth,
        selectedDayKey,
        monthCells,
        monthLabel,
        dayDots,
        dayEvents,
        quickTitle,
        quickStartLocal,
        creating,
        createError,
        titleHint,
        loading,
        refresh,
        prevMonth: () => moveMonth(-1),
        nextMonth: () => moveMonth(1),
        selectDay,
        quickAdd,
        openMeeting,
        formatEventTime: (event) => {
          if (event.allDay || /^\d{4}-\d{2}-\d{2}$/.test(event.start)) return "All day";
          const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
          return `${new Date(event.start).toLocaleTimeString(undefined, options)} – ${new Date(
            event.end,
          ).toLocaleTimeString(undefined, options)}`;
        },
      };
    },
  },
});

export { WEEKDAY_LABELS };
