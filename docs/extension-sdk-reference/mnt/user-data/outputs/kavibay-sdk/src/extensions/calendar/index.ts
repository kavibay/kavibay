import { defineExtension, defineProvider, defineWidget, defineCommand, type WidgetContext } from "../../sdk.js";

/**
 * FALSIFICATION CASE 2
 * OAuth, a destructive action, a command with no widget, a config field whose
 * options cannot be known before connect, and a prompt-bound command arg.
 *
 * EXTERNAL CONSTRAINT, not solvable in code: Calendar scopes are sensitive.
 * Until Google verification passes, the project is capped at 100 users for the
 * lifetime of the project and the cap cannot be reset. Ship post-launch, or
 * let users supply their own client id.
 */

interface Calendar { id: string; name: string }
interface Event { id: string; title: string; start: string; conferenceUrl?: string }

const calendar = defineProvider({
  name: "calendar",
  displayName: "Google Calendar",
  connection: {
    kind: "oauth2-pkce",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: "PLACEHOLDER.apps.googleusercontent.com",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  },
  hosts: ["www.googleapis.com", "oauth2.googleapis.com"],
  queries: {
    calendars: {
      key: () => [],
      staleTime: 3_600_000,
      fetch: async (_a: {}, host) => {
        await host.credentials.getAccessToken();
        return host.http.get<Calendar[]>("https://www.googleapis.com/calendar/v3/users/me/calendarList");
      },
    },
    events: {
      key: (a: { calendarId: string }) => [a.calendarId],
      staleTime: 60_000,
      fetch: async (a: { calendarId: string }, host) => {
        await host.credentials.getAccessToken();
        return host.http.get<Event[]>(`https://www.googleapis.com/calendar/v3/calendars/${a.calendarId}/events`);
      },
    },
  },
  actions: {
    createEvent: {
      effect: "write",
      args: {
        calendarId: { type: "string", label: "Calendar", required: true, source: { query: "calendars" } },
        title: { type: "string", label: "Title", required: true },
      },
      execute: async (a: { calendarId: string; title: string }, host) => {
        await host.http.post(`https://www.googleapis.com/calendar/v3/calendars/${a.calendarId}/events`, { summary: a.title });
      },
      invalidates: (a) => [{ query: "events", key: [a.calendarId] }],
    },
    deleteEvent: {
      effect: "destructive",
      args: {
        calendarId: { type: "string", label: "Calendar", required: true, source: { query: "calendars" } },
        eventId: { type: "string", label: "Event", required: true },
      },
      execute: async (a: { calendarId: string; eventId: string }, host) => {
        await host.http.post(`https://www.googleapis.com/calendar/v3/calendars/${a.calendarId}/events/${a.eventId}:delete`, {});
      },
      invalidates: (a) => [{ query: "events", key: [a.calendarId] }],
    },
  },
});

const PID = "kavibay.google-calendar/calendar";

const today = defineWidget<{ calendar: string }>({
  name: "today",
  displayName: "Today",
  defaultSize: { w: 3, h: 4 },
  requires: { provider: PID },
  permissions: { queries: ["events"], actions: [] },
  configuration: {
    calendar: { type: "select", label: "Calendar", required: true, source: { provider: PID, query: "calendars" } },
  },
  component: {
    async setup(ctx: WidgetContext<{ calendar: string }>) {
      return ctx.provider!.subscribe<Event[]>("events", { calendarId: ctx.config.calendar }, () => {});
    },
  },
});

/** Command with no widget, prompt-bound provider-sourced arg. */
const createEvent = defineCommand({
  kind: "action",
  name: "create-event",
  title: "Create event",
  when: { providerConnected: PID },
  action: {
    provider: PID,
    name: "createEvent",
    args: {
      calendarId: { from: "prompt", label: "Calendar" },
      title: { from: "prompt", label: "Title" },
    },
  },
});

/** Needs logic (find next, extract link, open it), so it is a code command. */
const joinNext = defineCommand({
  kind: "code",
  name: "join-next-meeting",
  title: "Join next meeting",
  when: { providerConnected: PID },
  requires: { provider: PID },
  permissions: { queries: ["events"], actions: [] },
  async run(ctx) {
    const events = await ctx.provider!.query<Event[]>("events", { calendarId: "primary" });
    const next = events.find((e) => e.conferenceUrl);
    if (!next?.conferenceUrl) { ctx.ui.notify("No upcoming meeting with a link"); return; }
    ctx.ui.notify(`Joining ${next.title}`);
  },
});

export const calendarExtension = defineExtension({
  name: "google-calendar",
  version: "0.9.0",
  displayName: "Google Calendar",
  engines: { kavibay: "^0.4" },
  contributes: { providers: [calendar], widgets: [today], commands: [createEvent, joinNext] },
});
