/**
 * Pure list logic for Settings → Credentials.
 *
 * The registry can grow without this file changing: search and status filters
 * run over whatever `credential_types_list` returns. Kept free of Vue/Tauri so
 * `npx tsx` can assert the "many providers" behaviour (a stacked editor per
 * type does not scale past a handful).
 */
import type { CredentialSummary, CredentialTypeSchema } from "./credentialsApi";
import { statusTone } from "./credentialsLogic";

/** Show every type, regardless of whether a secret is stored. */
export const ALL_STATUSES = "all";

/** Restrict the list to types in one status bucket. */
export type CredentialStatusFilter = "all" | "ready" | "attention" | "unset";

/** Rows for the status dropdown, in the order they appear. */
export const CREDENTIAL_STATUS_FILTERS: readonly {
  value: CredentialStatusFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Connected" },
  { value: "attention", label: "Needs attention" },
  { value: "unset", label: "Not set up" },
];

/**
 * Every saved connection of one type, in store order.
 *
 * A type is a schema, not an account: Linear issues one API key per workspace,
 * so "the credential for this type" is not something the panel can ask for.
 */
export function summariesForType(
  credentials: readonly CredentialSummary[],
  typeId: string,
): CredentialSummary[] {
  return credentials.filter((entry) => entry.typeId === typeId);
}

/**
 * One tone for a type's whole set of connections.
 *
 * Attention outranks ready on purpose: with one working account and one expired
 * account, the expired one is the only thing the user can act on, and a green
 * pill would hide it.
 */
export function typeTone(summaries: readonly CredentialSummary[]): "ok" | "warn" | "idle" {
  const tones = summaries.map((summary) => statusTone(summary));
  if (tones.includes("warn")) return "warn";
  if (tones.includes("ok")) return "ok";
  return "idle";
}

/**
 * Short status for a dense list row.
 *
 * Narrower than `statusLabel`: the editor can afford "Connected — email", a
 * 11px pill next to a long provider name cannot. Past one connection the
 * account label stops fitting and stops being the answer anyway — the count,
 * plus whether anything needs attention, is what the row has room to say.
 */
export function rowStatusLabel(summaries: readonly CredentialSummary[]): string {
  if (summaries.length === 0) return "Not set up";
  if (summaries.length > 1) {
    const attention = summaries.filter((entry) => statusTone(entry) === "warn").length;
    return attention > 0
      ? `${summaries.length} connections · ${attention} need attention`
      : `${summaries.length} connections`;
  }
  const summary = summaries[0]!;
  if (summary.pending) return "Waiting…";
  // Not "Set up": that is what the row offers when nothing is saved yet.
  if (summary.state === "connected") return summary.accountLabel ?? "Connected";
  if (summary.state === "needsReauth") return "Reconnect";
  return summary.missing.length > 0 ? "Incomplete" : "Not set up";
}

/** Case-insensitive match against the fields a user would type to find a provider. */
export function typeMatchesQuery(type: CredentialTypeSchema, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [type.id, type.displayName, type.description].join(" ").toLowerCase().includes(needle);
}

/** Whether a type belongs in the chosen status bucket. */
export function typeMatchesStatus(
  summaries: readonly CredentialSummary[],
  filter: CredentialStatusFilter,
): boolean {
  if (filter === "all") return true;
  const tone = typeTone(summaries);
  if (filter === "ready") return tone === "ok";
  if (filter === "attention") return tone === "warn";
  return tone === "idle";
}

/**
 * Visible types in registry order.
 *
 * Order is not resorted by status: a list that jumps when you save a key is a
 * list you have to re-read. Search and the status filter only hide rows.
 */
export function filterCredentialTypes(
  types: readonly CredentialTypeSchema[],
  credentials: readonly CredentialSummary[],
  query: string,
  filter: CredentialStatusFilter,
): CredentialTypeSchema[] {
  return types.filter(
    (type) =>
      typeMatchesQuery(type, query) &&
      typeMatchesStatus(summariesForType(credentials, type.id), filter),
  );
}

/**
 * Whether connecting takes an app the user registers with the provider first.
 *
 * Read off the schema rather than flagged per type: a sign-in type that asks
 * for fields is asking for that app's client details, while one with nothing
 * to fill in (tado°'s device flow) uses a client the provider publishes. It is
 * the one integration step that happens outside Kavibay, so the list says so
 * before anyone opens the form.
 */
export function needsDeveloperApp(type: Pick<CredentialTypeSchema, "authKind" | "fields">): boolean {
  return type.authKind !== "static" && type.fields.some((field) => field.required);
}

/**
 * Which row of the list should be open, or null for all closed.
 *
 * Keeps the current row when it is still in the filtered list so a save or a
 * 2s OAuth poll does not yank the form away. Otherwise open a type waiting on
 * the user — a device-code flow is easy to lose in a long list — or the one
 * row a search left. Anything else stays closed: the list is the overview.
 */
export function resolveSelectedTypeId(
  visible: readonly CredentialTypeSchema[],
  credentials: readonly CredentialSummary[],
  current: string | null,
): string | null {
  if (visible.length === 0) return null;
  if (current && visible.some((type) => type.id === current)) return current;
  const waiting = visible.find(
    (type) => typeTone(summariesForType(credentials, type.id)) === "warn",
  );
  if (waiting) return waiting.id;
  return visible.length === 1 ? visible[0].id : null;
}

/**
 * Deep-link from the Wizard (or anywhere else) onto one credential type.
 *
 * Search and the status filter can hide the row the caller named; clearing
 * both is what makes "open Google Calendar" actually show Google Calendar.
 * An unknown id is ignored so a stale link cannot blank the panel.
 */
export function applyCredentialFocus(
  types: readonly { id: string }[],
  requested: string | null,
): { resetFilters: boolean; selectedId: string | null } {
  if (!requested || !types.some((type) => type.id === requested)) {
    return { resetFilters: false, selectedId: null };
  }
  return { resetFilters: true, selectedId: requested };
}
