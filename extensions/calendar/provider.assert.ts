// SPDX-License-Identifier: MIT
import type { ProviderHostContext } from "@sdk/contract/sdk";
import { resultSchemaProblems } from "@sdk/contract/resultSchema";
import {
  calendarProvider,
  PROVIDER_ID,
  type CalendarEvent,
  type CalendarInfo,
} from "./provider";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(PROVIDER_ID === "kavibay.calendar/calendar", "calendar provider id matches its bundled extension");

const requests: Array<{ url: string; params?: Record<string, unknown> }> = [];
const posts: Array<{ url: string; body: unknown }> = [];
const pages: unknown[] = [];

const host: ProviderHostContext = {
  http: {
    get: async <T>(url: string, params?: Record<string, string | number | boolean>) => {
      requests.push({ url, params });
      return pages.shift() as T;
    },
    post: async <T>(url: string, body?: unknown) => {
      posts.push({ url, body });
      return {} as T;
    },
    put: async () => undefined as never,
  },
  credentials: { isConnected: async () => true },
};

const calendarsQuery = calendarProvider.queries.calendars;
pages.push(
  {
    items: [
      { id: "primary@example.com", summary: "Primary", backgroundColor: "#4285f4", primary: true },
      { id: "empty", summaryOverride: "Team", primary: false },
    ],
    nextPageToken: "next-page",
  },
  { items: [{ id: "second", summary: "Second page", primary: false }] },
);
const calendars = (await calendarsQuery.fetch({}, host)) as CalendarInfo[];
assert(calendars.length === 3, "calendar pagination is followed");
assert(calendars[0]?.name === "Primary" && calendars[0]?.color === "#4285f4", "calendar metadata is normalized");
assert(calendars[1]?.name === "Team", "summaryOverride wins when present");
assert(requests[1]?.params?.pageToken === "next-page", "calendar page token is sent on the next request");
assert(resultSchemaProblems(calendarsQuery.result!, calendars).length === 0, "calendar result matches its schema");

const eventsQuery = calendarProvider.queries.events;
pages.push({
  items: [
    {
      id: "timed",
      summary: "Project sync",
      start: { dateTime: "2026-08-20T09:30:00+02:00" },
      end: { dateTime: "2026-08-20T10:15:00+02:00" },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    },
    {
      id: "all-day",
      start: { date: "2026-08-21" },
      end: { date: "2026-08-23" },
      description: "Details https://example.com/agenda.",
    },
    {
      id: "conference",
      summary: "Conference",
      start: { dateTime: "2026-08-22T12:00:00Z" },
      end: { dateTime: "2026-08-22T13:00:00Z" },
      conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://video.example/join" }] },
    },
    {
      id: "cancelled",
      status: "cancelled",
      start: { dateTime: "2026-08-22T14:00:00Z" },
      end: { dateTime: "2026-08-22T15:00:00Z" },
    },
  ],
});
const events = (await eventsQuery.fetch(
  { calendarId: "primary@example.com", rangeStart: "2026-08-01T00:00:00.000Z", rangeEnd: "2026-09-01T00:00:00.000Z" },
  host,
)) as CalendarEvent[];
assert(events.length === 3, "cancelled events are dropped");
assert(events[0]?.calendarId === "primary@example.com", "calendar id is attached to events");
assert(events[0]?.meetingUrl === "https://meet.google.com/abc-defg-hij", "hangout link is preferred");
assert(events[1]?.allDay === true && events[1]?.end === "2026-08-23", "all-day exclusive end is preserved");
assert(events[1]?.meetingUrl === "https://example.com/agenda", "description link punctuation is trimmed");
assert(events[2]?.meetingUrl === "https://video.example/join", "video conference link is mapped");
assert(requests[requests.length - 1]?.params?.singleEvents === true, "events use expanded start-time ordering");
assert(resultSchemaProblems(eventsQuery.result!, events).length === 0, "event result matches its schema");

const createEvent = calendarProvider.actions.createEvent;
await createEvent.execute(
  {
    calendarId: "primary@example.com",
    title: " Team sync ",
    start: "2026-08-20T11:00:00.000Z",
    end: "2026-08-20T11:30:00.000Z",
  },
  host,
);
assert(posts.length === 1, "create event uses one POST");
assert((posts[0]?.body as { summary: string }).summary === "Team sync", "event title is trimmed");
assert((await createEvent.invalidates?.({ calendarId: "primary@example.com", title: "x", start: "s", end: "e" }))?.[0]?.key?.[0] === "primary@example.com", "create invalidates one calendar's events");

let rejected = false;
try {
  await createEvent.execute(
    { calendarId: "primary@example.com", title: "  ", start: "s", end: "e" },
    host,
  );
} catch {
  rejected = true;
}
assert(rejected, "empty event titles are rejected before POST");

console.log("provider.assert.ts: ok");
