// SPDX-License-Identifier: MIT
import type { ResultSchema } from "./sdk";

/**
 * Checks a provider's real answer against what its query declared.
 *
 * WHY THIS EXISTS. A declared result is a second statement of a fact whose
 * first statement is `fetch`. Findings 4 and 7 are both about two parties
 * building one value, and both were invisible until something ran. So the
 * declaration is not documentation here: it is checked, and a provider that
 * renames a field without updating its schema fails loudly in development.
 *
 * DEV ONLY, and that is deliberate rather than lazy. In a release build a
 * mismatch must not take a widget down — a vendor adding a field is not a
 * reason to show the user an error panel. The runtime therefore calls this
 * behind `import.meta.env.DEV`, where the person who can fix it is watching.
 *
 * Extra fields are allowed; missing and mistyped ones are not. A provider
 * normalizes into its declared shape, so anything beyond it is upstream noise
 * that no widget reads, while a field the schema promises and the response
 * lacks is exactly the blank tile this whole mechanism exists to prevent.
 */
export function resultSchemaProblems(
  schema: ResultSchema,
  value: unknown,
  path = "result",
): string[] {
  switch (schema.type) {
    case "string":
    case "number":
    case "boolean": {
      if (value === null || value === undefined) {
        return schema.nullable ? [] : [`${path} is ${String(value)}, declared ${schema.type}`];
      }
      return typeof value === schema.type
        ? []
        : [`${path} is ${typeof value}, declared ${schema.type}`];
    }
    case "list": {
      if (value === null || value === undefined) {
        return schema.nullable ? [] : [`${path} is ${String(value)}, declared a list`];
      }
      if (!Array.isArray(value)) return [`${path} is ${describe(value)}, declared a list`];
      // Every element, not just the first: a list whose tenth entry is missing
      // a field is the case that reaches a user and not a reviewer.
      return value.flatMap((entry, index) =>
        resultSchemaProblems(schema.of, entry, `${path}[${index}]`),
      );
    }
    case "object": {
      if (value === null || value === undefined) {
        return schema.nullable ? [] : [`${path} is ${String(value)}, declared an object`];
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [`${path} is ${describe(value)}, declared an object`];
      }
      const record = value as Record<string, unknown>;
      return Object.entries(schema.fields).flatMap(([key, field]) =>
        resultSchemaProblems(field, record[key], `${path}.${key}`),
      );
    }
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}
