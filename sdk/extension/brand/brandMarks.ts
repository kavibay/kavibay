// SPDX-License-Identifier: MIT
/**
 * Which brand mark belongs to a provider, and — deliberately — which ones have
 * none.
 *
 * Keys are matched exactly rather than by substring. A logo is a trademark, and
 * "does this id contain github" is the kind of rule that eventually paints
 * someone else's mark onto an unrelated integration; the same reason the
 * registry derives a namespace from the load source instead of reading one out
 * of a manifest. A key that is not listed here has no mark, and the UI then
 * shows none at all — that is the correct state for an unlisted provider, not
 * a hole to fill with a grey placeholder.
 *
 * Two id spaces resolve to the same mark on purpose: a widget's connect gate
 * knows a `ProviderId`, while Settings → Credentials knows a credential type id
 * from `credentials::registry`. Both name the same account to the user.
 */
export type BrandId =
  | "tado"
  | "github"
  | "google"
  | "open-meteo"
  | "linear"
  | "n8n"
  | "spotify"
  | "fitbit"
  | "notion"
  | "anthropic"
  | "openai"
  | "cloudflare";

const MARKS: Readonly<Record<string, BrandId>> = {
  // Provider ids — `<namespace>.<extension>/<provider>`, bundled only. A
  // catalog or sideloaded package may declare a provider too, so the namespace
  // stays part of the key: `kavibay.` is the one the app itself ships.
  "kavibay.tado/tado": "tado",
  "kavibay.github/github": "github",
  "kavibay.linear/linear": "linear",
  "kavibay.n8n/n8n": "n8n",
  "kavibay.spotify/spotify": "spotify",
  "kavibay.fitbit/fitbit": "fitbit",
  "kavibay.notion/notion": "notion",
  "kavibay.calendar/calendar": "google",
  "kavibay.weather/weather": "open-meteo",

  // Credential type ids from the Rust registry.
  tadooauth2: "tado",
  githubpat: "github",
  linearapi: "linear",
  n8napi: "n8n",
  spotifyoauth2: "spotify",
  fitbitoauth2: "fitbit",
  notionapi: "notion",
  googlecalendaroauth2: "google",
  anthropicapi: "anthropic",
  openaiapi: "openai",
  cloudflareworkersai: "cloudflare",
};

/**
 * The mark for a provider id or credential type id, or undefined when the
 * provider has no logo we ship.
 *
 * Case-insensitive because the two id spaces disagree on style — provider ids
 * are lower-case paths, credential type ids are camelCase — and neither is
 * worth transcribing twice into the table above.
 */
export function brandMarkFor(key: string | null | undefined): BrandId | undefined {
  if (!key) return undefined;
  return MARKS[key.toLowerCase()];
}
