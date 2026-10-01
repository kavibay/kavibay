/**
 * Two connected accounts, for the Wizard's Linear/GitHub demo.
 *
 * On the desktop a provider's `host.http` call goes to Rust, which adds the
 * account's token and asks the real API. Here the same call is answered with a
 * response in that API's own shape: a GraphQL envelope for Linear, the search
 * API's `items` for GitHub. The shipping provider code (extensions/linear,
 * extensions/github) then parses, validates and maps it exactly as it would a
 * live answer, so what reaches the widget has been through everything real
 * except the network.
 *
 * Weather (Open-Meteo) needs no account and is answered too, with a calm,
 * made-up forecast in Open-Meteo's own shape: the desk has a Weather card, and
 * asking the real API would send every visitor's address to a third party.
 *
 * Every other provider stays disconnected: the page has no account for it and
 * pretending otherwise would put invented data in widgets nobody scripted.
 */

type Args = Record<string, unknown>;

const LINEAR = "kavibay.linear/linear";
const GITHUB = "kavibay.github/github";
const CONNECTED = new Set([LINEAR, GITHUB]);

const WEATHER = "kavibay.weather/weather";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Four rows in all: what the Wizard's preview card shows without growing past the stage. */
const LINEAR_ISSUES = [
  { identifier: "ENG-412", title: "Palette should rank generated drafts first", state: ["In Progress", "started"], ago: 25 },
  { identifier: "ENG-405", title: "Desk: keep mention chips when duplicating a card", state: ["In Review", "started"], ago: 190 },
];

const GITHUB_REVIEWS = [
  { number: 318, title: "feat: Wizard mention chips in the composer", ago: 12 },
  { number: 314, title: "fix: runtime sandbox CSP on generated previews", ago: 300 },
];

function linearAssignedIssues() {
  return {
    data: {
      viewer: {
        assignedIssues: {
          nodes: LINEAR_ISSUES.map((issue) => ({
            id: `demo-${issue.identifier}`,
            identifier: issue.identifier,
            title: issue.title,
            url: `https://linear.app/kavibay/issue/${issue.identifier}`,
            updatedAt: minutesAgo(issue.ago),
            state: { name: issue.state[0], type: issue.state[1] },
            team: { name: "Engineering", key: "ENG" },
          })),
        },
      },
    },
  };
}

function githubReviewRequests() {
  return {
    total_count: GITHUB_REVIEWS.length,
    items: GITHUB_REVIEWS.map((pull) => ({
      number: pull.number,
      title: pull.title,
      repository_url: "https://api.github.com/repos/kavibay/kavibay",
      html_url: `https://github.com/kavibay/kavibay/pull/${pull.number}`,
      updated_at: minutesAgo(pull.ago),
    })),
  };
}

/** "2026-10-01T21:00" — Open-Meteo's local time with `timezone=auto`. */
function localIso(date: Date, withHour = true): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withHour ? `${day}T${pad(date.getHours())}:00` : day;
}

/** Whatever place is asked for is found, at one fixed spot. */
function weatherGeocode(url: URL) {
  const name = url.searchParams.get("name")?.trim() || "Berlin";
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  return { results: [{ name: label, latitude: 52.52, longitude: 13.41 }] };
}

/** Mild autumn: mostly clear, a cloudy afternoon, light rain on day three. */
function weatherForecast() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const hours = Array.from({ length: 24 }, (_, i) => new Date(now.getTime() + i * 3_600_000));
  const tempAt = (date: Date) =>
    Math.round((14 + 5 * Math.sin(((date.getHours() - 9) / 24) * 2 * Math.PI)) * 10) / 10;
  const days = Array.from({ length: 5 }, (_, i) => new Date(now.getTime() + i * 86_400_000));
  return {
    current: {
      time: localIso(now),
      temperature_2m: tempAt(now),
      apparent_temperature: tempAt(now) - 1.5,
      relative_humidity_2m: 64,
      wind_speed_10m: 11.2,
      weather_code: 1,
    },
    hourly: {
      time: hours.map((date) => localIso(date)),
      temperature_2m: hours.map(tempAt),
      weather_code: hours.map((date) => (date.getHours() >= 13 && date.getHours() <= 16 ? 2 : 1)),
    },
    daily: {
      time: days.map((date) => localIso(date, false)),
      weather_code: [1, 2, 61, 3, 0],
      temperature_2m_max: [19, 18, 15, 16, 20],
      temperature_2m_min: [9, 10, 11, 9, 8],
    },
  };
}

/** The one response each scripted query needs; anything else is refused. */
function respond(providerId: string, url: string, body: unknown): { status: number; body: unknown } {
  const query = String((body as { query?: unknown } | null)?.query ?? "");
  if (providerId === LINEAR && url.startsWith("https://api.linear.app/graphql") && query.includes("assignedIssues")) {
    return { status: 200, body: linearAssignedIssues() };
  }
  if (providerId === GITHUB && url.startsWith("https://api.github.com/search/issues")) {
    return { status: 200, body: githubReviewRequests() };
  }
  if (providerId === WEATHER && url.startsWith("https://geocoding-api.open-meteo.com/v1/search")) {
    return { status: 200, body: weatherGeocode(new URL(url)) };
  }
  if (providerId === WEATHER && url.startsWith("https://api.open-meteo.com/v1/forecast")) {
    return { status: 200, body: weatherForecast() };
  }
  return { status: 404, body: { message: "Not part of this demo" } };
}

export const PROVIDER_ANSWERS: Record<string, (args: Args) => unknown> = {
  extension_provider_is_connected: (args) => CONNECTED.has(String(args.providerId)),
  extension_provider_connection: (args) =>
    CONNECTED.has(String(args.providerId))
      ? {
          owner: args.owner,
          packageId: args.packageId,
          credentialId: `demo:${String(args.providerId)}`,
          available: true,
          revision: 1,
        }
      : null,
  extension_provider_fetch: (args) => respond(String(args.providerId), String(args.url), args.body),
};
