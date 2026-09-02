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
  { value: "ready", label: "Set up" },
  { value: "attention", label: "Needs attention" },
  { value: "unset", label: "Not set up" },
];

/** Stored credential for one type, or null when the user has never saved it. */
export function summaryForType(
  credentials: readonly CredentialSummary[],
  typeId: string,
): CredentialSummary | null {
  return credentials.find((entry) => entry.typeId === typeId) ?? null;
}

/**
 * Short status for a dense list row.
 *
 * Narrower than `statusLabel`: the editor can afford "Connected — email", a
 * 11px pill next to a long provider name cannot.
 */
export function rowStatusLabel(summary: CredentialSummary | null): string {
  if (!summary) return "Not set up";
  if (summary.pending) return "Waiting…";
  if (summary.state === "connected") return summary.accountLabel ?? "Set up";
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
  summary: CredentialSummary | null,
  filter: CredentialStatusFilter,
): boolean {
  if (filter === "all") return true;
  const tone = statusTone(summary);
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
      typeMatchesStatus(summaryForType(credentials, type.id), filter),
  );
}

/**
 * Which type's editor should be open.
 *
 * Keeps the current selection when it is still in the filtered list so a save
 * or a 2s OAuth poll does not yank the form away. When the current row is
 * hidden (or this is the first paint), prefer a type waiting on the user —
 * a device-code flow is easy to lose in a long list — else the first visible.
 */
export function resolveSelectedTypeId(
  visible: readonly CredentialTypeSchema[],
  credentials: readonly CredentialSummary[],
  current: string | null,
): string | null {
  if (visible.length === 0) return null;
  if (current && visible.some((type) => type.id === current)) return current;
  const waiting = visible.find(
    (type) => statusTone(summaryForType(credentials, type.id)) === "warn",
  );
  return waiting?.id ?? visible[0].id;
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
