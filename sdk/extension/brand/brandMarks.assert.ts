// SPDX-License-Identifier: MIT
/**
 * Brand mark lookup.
 * Run: npx tsx sdk/extension/brand/brandMarks.assert.ts
 */
import { brandMarkFor } from "./brandMarks";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Both id spaces reach the same mark: a widget's connect gate knows a provider
// id, Settings → Credentials knows a credential type id.
assert(brandMarkFor("kavibay.tado/tado") === "tado", "tado provider id");
assert(brandMarkFor("tadoOAuth2") === "tado", "tado credential type");
assert(brandMarkFor("kavibay.github/github") === "github", "github provider id");
assert(brandMarkFor("githubPat") === "github", "github credential type");
assert(brandMarkFor("kavibay.linear/linear") === "linear", "linear provider id");
assert(brandMarkFor("linearApi") === "linear", "linear credential type");
assert(brandMarkFor("kavibay.trello/trello") === "trello", "trello provider id");
assert(brandMarkFor("trelloApi") === "trello", "trello credential type");
assert(brandMarkFor("kavibay.n8n/n8n") === "n8n", "n8n provider id");
assert(brandMarkFor("n8nApi") === "n8n", "n8n credential type");
assert(brandMarkFor("kavibay.spotify/spotify") === "spotify", "spotify provider id");
assert(brandMarkFor("spotifyOAuth2") === "spotify", "spotify credential type");
assert(brandMarkFor("kavibay.fitbit/fitbit") === "fitbit", "fitbit provider id");
assert(brandMarkFor("fitbitOAuth2") === "fitbit", "fitbit credential type");
assert(brandMarkFor("kavibay.notion/notion") === "notion", "notion provider id");
assert(brandMarkFor("notionApi") === "notion", "notion credential type");
assert(brandMarkFor("kavibay.calendar/calendar") === "google", "calendar provider id");
assert(brandMarkFor("googleCalendarOAuth2") === "google", "google credential type");

// No mark is a supported state, not a missing entry. Open-Meteo uses the
// supplied mark; unknown and unlisted providers remain unbranded.
assert(brandMarkFor("kavibay.weather/weather") === "open-meteo", "weather mark");
assert(brandMarkFor("anthropicApi") === "anthropic", "anthropic credential type");
assert(brandMarkFor("openaiApi") === "openai", "openai credential type");
assert(brandMarkFor("cloudflareWorkersAi") === "cloudflare", "cloudflare credential type");
assert(brandMarkFor(undefined) === undefined, "undefined key");
assert(brandMarkFor("") === undefined, "empty key");

// Exact match only. A sideloaded package that names itself after a brand gets
// nothing — the same reason trust is derived from the load source.
assert(brandMarkFor("dev.evil/github") === undefined, "namespace is part of the key");
assert(brandMarkFor("local.notgithub/notgithub") === undefined, "no substring matching");
assert(brandMarkFor("github") === undefined, "a bare provider name is not a key");

console.log("brandMarks.assert.ts: 27 assertions passed");
