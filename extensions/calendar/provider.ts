// SPDX-License-Identifier: MIT
import { defineProvider, type ProviderHostContext } from "@sdk/contract/sdk";

export const PROVIDER_ID = "kavibay.calendar/calendar";

export interface CalendarInfo {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string | null;
  meetingUrl: string | null;
}

interface GooglePage<T> {
  items?: T[];
  nextPageToken?: string;
}

interface GoogleCalendarItem {
  id?: unknown;
  summary?: unknown;
  summaryOverride?: unknown;
  backgroundColor?: unknown;
  primary?: unknown;
}

interface GoogleEventItem {
  id?: unknown;
  status?: unknown;
  summary?: unknown;
  description?: unknown;
  hangoutLink?: unknown;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: unknown;
      uri?: unknown;
    }>;
  };
  start?: {
    dateTime?: unknown;
    date?: unknown;
  };
  end?: {
    dateTime?: unknown;
    date?: unknown;
  };
}

export interface CalendarEventsArgs {
  calendarId: string;
  rangeStart: string;
  rangeEnd: string;
}

export interface CreateEventArgs {
  calendarId: string;
  title: string;
  start: string;
  end: string;
}

const CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars";

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Follow Google's page tokens while keeping vendor pagination out of widgets. */
async function listPages<T>(
  url: string,
  params: Record<string, string | number | boolean>,
  map: (item: T) => CalendarInfo | CalendarEvent | null,
  host: ProviderHostContext,
): Promise<Array<CalendarInfo | CalendarEvent>> {
  const result: Array<CalendarInfo | CalendarEvent> = [];
  let pageToken: string | undefined;

  do {
    const page = await host.http.get<GooglePage<T>>(url, {
      ...params,
      ...(pageToken ? { pageToken } : {}),
    });
    const items = Array.isArray(page?.items) ? page.items : [];
    for (const item of items) {
      const normalized = map(item);
      if (normalized) result.push(normalized);
    }
    pageToken = stringValue(page?.nextPageToken);
  } while (pageToken);

  return result;
}

function mapCalendar(item: GoogleCalendarItem): CalendarInfo | null {
  const id = stringValue(item.id);
  const name = stringValue(item.summaryOverride) ?? stringValue(item.summary);
  if (!id || !name) return null;
  return {
    id,
    name,
    color: stringValue(item.backgroundColor) ?? null,
    primary: item.primary === true,
  };
}

function meetingUrl(item: GoogleEventItem): string | null {
  const hangout = stringValue(item.hangoutLink);
  if (hangout) return hangout;

  const video = item.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video",
  );
  const conference = stringValue(video?.uri);
  if (conference) return conference;

  const description = stringValue(item.description);
  if (!description) return null;
  const start = description.indexOf("https://");
  if (start < 0) return null;
  return description.slice(start).split(/\s+/)[0]?.replace(/[.,;:!?]+$/, "") ?? null;
}

function mapEvent(calendarId: string, item: GoogleEventItem): CalendarEvent | null {
  if (item.status === "cancelled") return null;
  const id = stringValue(item.id);
  const startDateTime = stringValue(item.start?.dateTime);
  const endDateTime = stringValue(item.end?.dateTime);
  const startDate = stringValue(item.start?.date);
  const endDate = stringValue(item.end?.date);
  const allDay = Boolean(startDate && endDate);
  const start = allDay ? startDate : startDateTime;
  const end = allDay ? endDate : endDateTime;
  if (!id || !start || !end) return null;

  return {
    id,
    calendarId,
    title: stringValue(item.summary) ?? "(No title)",
    start,
    end,
    allDay,
    // The widget uses the selected calendar's color when Google does not
    // provide an event-specific color. Keeping this nullable matches Google.
    color: null,
    meetingUrl: meetingUrl(item),
  };
}

export const calendarProvider = defineProvider({
  name: "calendar",
  displayName: "Google Calendar",
  requiresCredential: true,
  credentialType: "googleCalendarOAuth2",
  // Keep this in agreement with the compiled Rust declaration. OAuth itself
  // uses the second host; Calendar API calls use the first one.
  hosts: ["www.googleapis.com", "oauth2.googleapis.com"],
  // Events answer from Google APIs; Meet links and the calendar itself live
  // on these two. `meetingUrl` is usually Meet; a widget that opens the event
  // page would need `calendar.google.com`.
  linkHosts: ["meet.google.com", "calendar.google.com"],
  queries: {
    calendars: {
      description: "The calendars available in your Google account",
      args: {},
      result: {
        type: "list",
        of: {
          type: "object",
          fields: {
            id: { type: "string" },
            name: { type: "string" },
            color: { type: "string", nullable: true },
            primary: { type: "boolean" },
          },
        },
      },
      key: () => [],
      staleTime: 60 * 60_000,
      fetch: async (_args: Record<string, never>, host): Promise<CalendarInfo[]> => {
        return (await listPages<GoogleCalendarItem>(CALENDAR_LIST_URL, {}, mapCalendar, host)) as CalendarInfo[];
      },
    },
    events: {
      description: "Events in one Google Calendar for the visible month",
      args: {
        calendarId: {
          type: "string",
          label: "Calendar",
          required: true,
          source: { query: "calendars" },
        },
        rangeStart: { type: "string", label: "Range start", required: true },
        rangeEnd: { type: "string", label: "Range end", required: true },
      },
      result: {
        type: "list",
        of: {
          type: "object",
          fields: {
            id: { type: "string" },
            calendarId: { type: "string" },
            title: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            allDay: { type: "boolean" },
            color: { type: "string", nullable: true },
            meetingUrl: { type: "string", nullable: true },
          },
        },
      },
      key: (args: CalendarEventsArgs) => [args.calendarId, args.rangeStart, args.rangeEnd],
      staleTime: 5 * 60_000,
      fetch: async (args: CalendarEventsArgs, host): Promise<CalendarEvent[]> => {
        const url = `${CALENDAR_EVENTS_URL}/${encodeURIComponent(args.calendarId)}/events`;
        const params = {
          timeMin: args.rangeStart,
          timeMax: args.rangeEnd,
          singleEvents: true,
          orderBy: "startTime",
        };
        const mapped = await listPages<GoogleEventItem>(
          url,
          params,
          (item) => mapEvent(args.calendarId, item),
          host,
        );
        return mapped as CalendarEvent[];
      },
    },
  },
  actions: {
    createEvent: {
      effect: "write",
      args: {
        calendarId: {
          type: "string",
          label: "Calendar",
          required: true,
          source: { query: "calendars" },
        },
        title: { type: "string", label: "Title", required: true },
        start: { type: "string", label: "Start", required: true },
        end: { type: "string", label: "End", required: true },
      },
      execute: async (args: CreateEventArgs, host): Promise<void> => {
        const title = args.title.trim();
        if (!title) throw new Error("Event title cannot be empty");
        const url = `${CALENDAR_EVENTS_URL}/${encodeURIComponent(args.calendarId)}/events`;
        await host.http.post(url, {
          summary: title,
          start: { dateTime: args.start },
          end: { dateTime: args.end },
        });
      },
      invalidates: (args: CreateEventArgs) => [{ query: "events", key: [args.calendarId] }],
    },
  },
});

export default calendarProvider;
