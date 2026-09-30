/**
 * Pure form logic for the schema-driven credential editor.
 *
 * Kept free of Vue/Tauri so it can be asserted with `npx tsx` (repo testing
 * convention). The rule the whole editor rests on: a password input that is
 * left empty means "keep the stored secret", never "clear it".
 */
import type {
  CredentialFieldSchema,
  CredentialSummary,
  CredentialTypeSchema,
} from "./credentialsApi";

export type FormValues = Record<string, string>;

/**
 * Initial input values for a type: text fields prefilled from the stored
 * (non-secret) values, password fields always empty.
 */
export function buildFormValues(
  type: CredentialTypeSchema,
  summary: CredentialSummary | null,
): FormValues {
  const values: FormValues = {};
  for (const field of type.fields) {
    values[field.key] =
      field.kind === "text" ? (summary?.values[field.key] ?? "") : "";
  }
  return values;
}

/** True when the field already has a stored secret the user need not retype. */
export function hasStoredSecret(
  field: CredentialFieldSchema,
  summary: CredentialSummary | null,
): boolean {
  return field.kind === "password" && (summary?.secretsSet.includes(field.key) ?? false);
}

/** Placeholder that tells the user a secret exists without revealing it. */
export function fieldPlaceholder(
  field: CredentialFieldSchema,
  summary: CredentialSummary | null,
): string {
  if (hasStoredSecret(field, summary)) return "•••••••• (enter to replace)";
  return field.placeholder ?? "";
}

/**
 * A required field is satisfied by typed input or, for secrets, by a value that
 * is already stored.
 */
export function isFieldSatisfied(
  field: CredentialFieldSchema,
  values: FormValues,
  summary: CredentialSummary | null,
): boolean {
  if (!field.required) return true;
  if ((values[field.key] ?? "").trim().length > 0) return true;
  return hasStoredSecret(field, summary);
}

/** Save is possible once every required field is satisfied. */
export function canSave(
  type: CredentialTypeSchema,
  values: FormValues,
  summary: CredentialSummary | null,
): boolean {
  return type.fields.every((field) => isFieldSatisfied(field, values, summary));
}

/**
 * Values to submit: trimmed, and password fields left empty are omitted so the
 * backend keeps the stored secret.
 */
export function submittableValues(
  type: CredentialTypeSchema,
  values: FormValues,
): FormValues {
  const out: FormValues = {};
  for (const field of type.fields) {
    const value = (values[field.key] ?? "").trim();
    if (field.kind === "password" && value.length === 0) continue;
    out[field.key] = value;
  }
  return out;
}

/**
 * Whether the type needs a sign-in step in addition to its fields, and whether
 * that step can start yet (an OAuth app's client details must be saved first).
 */
export function canConnect(
  type: CredentialTypeSchema,
  summary: CredentialSummary | null,
): boolean {
  if (type.authKind === "static") return false;
  // Types without fields (a provider-published public client) can connect
  // right away — the credential row is created by the connect action itself.
  if (!summary) return type.fields.every((field) => !field.required);
  return summary.missing.length === 0;
}

/** One-line status for the card header. */
export function statusLabel(summary: CredentialSummary | null): string {
  if (!summary) return "Not configured";
  if (summary.pending) return "Waiting for sign-in…";
  switch (summary.state) {
    case "connected":
      return summary.accountLabel ? `Connected — ${summary.accountLabel}` : "Connected";
    case "needsReauth":
      return "Reconnect required";
    default:
      return summary.missing.length > 0 ? "Incomplete" : "Not configured";
  }
}

/** Status tone used for the coloured dot. */
export function statusTone(
  summary: CredentialSummary | null,
): "ok" | "warn" | "idle" {
  if (!summary) return "idle";
  if (summary.pending) return "warn";
  if (summary.state === "connected") return "ok";
  if (summary.state === "needsReauth") return "warn";
  return "idle";
}
