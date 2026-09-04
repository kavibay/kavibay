/**
 * "Add one widget per option", derived from the contract instead of from a
 * vendor name.
 *
 * This is what Settings → Tado used to be. That panel was a nav entry, a
 * section id, an icon and a `v-else-if` in the core modal, all carrying one
 * button that added a tile per heating zone — and every provider-backed
 * extension after it would have wanted the same button under its own name.
 *
 * A widget that binds itself to one row of a provider list already says so:
 * `ConfigField.source` names the query the options come from, and `required`
 * says an instance is useless without one. That is the whole input this needs,
 * so the offer generalises for free — boards, playlists, teams, heating zones —
 * and the core knows the word "zone" no better than it knows "tado".
 *
 * Pure so `npx tsx` can assert it; the query itself is the caller's.
 */
import type { ConfigField, ConfigOption, ProviderStatus } from "@sdk/contract/sdk";

/** The field a bulk add would fill, with the key it is stored under. */
export interface BulkAddField {
  key: string;
  field: ConfigField;
}

/**
 * The one config field a bulk add can drive, or null.
 *
 * Deliberately narrow, and each condition earns its place:
 *
 * - `source` — without a provider query there is no list to expand.
 * - `required` — an optional field means an instance is useful unconfigured,
 *   so "one per option" is a guess about what the user wanted, not a shortcut.
 * - not `multiple` — a multi-select instance already holds several options; the
 *   bulk add would be splitting a choice the widget asked to keep together.
 * - exactly one match — two source-backed selects make "one per option" mean
 *   two different things (per board, or per list?), and picking either is worse
 *   than not offering it. The gate's form still asks properly.
 */
export function bulkAddField(
  schema: Record<string, ConfigField> | undefined,
): BulkAddField | null {
  if (!schema) return null;
  const candidates = Object.entries(schema).filter(
    ([, field]) =>
      field.type === "select" &&
      field.required === true &&
      field.multiple !== true &&
      field.source !== undefined,
  );
  if (candidates.length !== 1) return null;
  const [key, field] = candidates[0]!;
  return { key, field };
}

/**
 * Options that no existing instance is bound to yet.
 *
 * Compared as strings because the two sides arrive differently typed: a query
 * hands back `id: 1` while the same choice round-trips through persisted config
 * as `"1"`. Comparing raw would re-add every room on the second press, which is
 * exactly the bug the old panel's `String(zone)` normalisation was guarding
 * against — kept here, where it is now asserted.
 */
export function pendingOptions(
  options: readonly ConfigOption[],
  used: readonly unknown[],
): ConfigOption[] {
  const taken = new Set(
    used.filter((value) => value != null).map((value) => String(value)),
  );
  return options.filter((option) => !taken.has(String(option.value)));
}

/**
 * What the button says, in the widget's own words.
 *
 * `ConfigField.label` is already the noun the gate's form shows ("Room"), so
 * the offer reads as the extension wrote it and no core file has to keep a
 * table of vendor vocabulary.
 */
export function bulkAddLabel(field: ConfigField): string {
  const noun = field.label.trim() || "option";
  return `Add one widget per ${noun.toLowerCase()}`;
}

/** Outcome copy for a finished bulk add; `null` when nothing was added. */
export function bulkAddSummary(added: number, field: ConfigField): string {
  const noun = (field.label.trim() || "option").toLowerCase();
  if (added === 0) return `Every ${noun} already has a widget.`;
  return `Added ${added} widget${added === 1 ? "" : "s"}.`;
}

/**
 * The account line for one provider, and whether a bulk add can run yet.
 *
 * `ProviderStatus` is a union rather than a boolean precisely so these read
 * differently (finding: a connect prompt that says "disconnected" for an
 * expired sign-in sends the user looking for a button that is not the one they
 * need). The settings row is terser than the widget's connect prompt — it sits
 * beside a button that already says where to go — but it makes the same
 * distinctions.
 */
export function providerStatusLine(status: ProviderStatus): {
  label: string;
  tone: "ok" | "warn" | "idle";
} {
  switch (status.state) {
    case "connected":
      return { label: "Connected", tone: "ok" };
    case "connecting":
      return { label: "Connecting…", tone: "warn" };
    case "auth-expired":
      return { label: "Sign-in expired", tone: "warn" };
    case "error":
      return { label: status.message, tone: "warn" };
    case "not-installed":
      return { label: "Not installed", tone: "idle" };
    default:
      return { label: "Not connected", tone: "idle" };
  }
}
