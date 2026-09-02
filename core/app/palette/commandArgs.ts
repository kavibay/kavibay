import type { ActionArgs, ActionParam } from "@sdk/types";

/** Validation outcome; `invalidIndex` points at the chip to focus on failure. */
export type ArgValidation =
  | { ok: true; args: ActionArgs }
  | { ok: false; invalidIndex: number };

/** Chip label: explicit placeholder, a concise enum affordance, or the name. */
export function paramPlaceholder(param: ActionParam): string {
  if (param.placeholder) return param.placeholder;
  if (param.type === "enum" && param.options?.length) {
    return `Select ${param.name}`;
  }
  return param.name;
}

/** Tab cycles through the chips and never leaves argument mode. */
export function nextParamIndex(current: number, count: number): number {
  if (count <= 0) return 0;
  return (current + 1) % count;
}

/**
 * Keep typed chip values when the param list grows or shrinks.
 *
 * Placeholder chips appear and disappear as the template is edited; matching
 * by name (not index) is what stops `{name}` from inheriting `{mood}`'s text.
 */
export function alignArgValues(
  params: readonly ActionParam[],
  previousParams: readonly ActionParam[],
  previousValues: readonly string[],
): string[] {
  const previous = new Map(
    previousParams.map((param, index) => [param.name, previousValues[index] ?? ""]),
  );
  return params.map((param) => previous.get(param.name) ?? "");
}

/** Shift+Tab; -1 means "leave argument mode" (caller returns to the search input). */
export function previousParamIndex(current: number): number {
  return current - 1;
}

/**
 * One value against one param. Empty optional values are legal and are dropped
 * from args entirely, so handlers branch on `undefined` instead of `""`.
 */
function checkValue(param: ActionParam, raw: string): { ok: boolean; value?: string } {
  const value = raw.trim();

  if (value.length === 0) {
    return { ok: !param.required };
  }

  if (param.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return { ok: false };
    return { ok: true, value };
  }

  if (param.type === "enum" && param.options?.length) {
    const lower = value.toLowerCase();
    // Emit the canonical option so handlers never lowercase defensively.
    const match = param.options.find((option) => option.toLowerCase() === lower);
    return match ? { ok: true, value: match } : { ok: false };
  }

  // Malformed enum (no options) falls back to free text: a broken declaration
  // should not make every value invalid.
  return { ok: true, value };
}

/** Index of the first param whose value is unusable; -1 when all are fine. */
export function firstInvalidIndex(
  params: readonly ActionParam[],
  values: readonly string[],
): number {
  for (let i = 0; i < params.length; i++) {
    if (!checkValue(params[i]!, values[i] ?? "").ok) return i;
  }
  return -1;
}

/** Validate all chips and build the args record handed to the handler. */
export function validateActionArgs(
  params: readonly ActionParam[],
  values: readonly string[],
): ArgValidation {
  const args: ActionArgs = {};

  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    const result = checkValue(param, values[i] ?? "");
    if (!result.ok) return { ok: false, invalidIndex: i };
    if (result.value !== undefined) args[param.name] = result.value;
  }

  return { ok: true, args };
}
