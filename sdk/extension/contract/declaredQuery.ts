// SPDX-License-Identifier: MIT
import type { ArgSpec, ProviderHostContext, ProviderQuery, QueryKey, ResultSchema } from "./sdk";

/**
 * A provider query written as data rather than as code.
 *
 * WHY THIS EXISTS. A query used to be a `fetch` function, which meant every new
 * endpoint on an already-allowed host was a code contribution: authored in the
 * repo, reviewed as code, shipped in a build. For a small API that is fine. For
 * GitHub it is the bottleneck — nobody wants to write a function per endpoint,
 * and the person who wants a "review requests" widget cannot add one at all,
 * because generated code may not contribute a provider.
 *
 * Most of what a query says is already data: a URL, some parameters, the shape
 * that comes back, and which fields of it matter. Only the few that need real
 * logic — GitHub's run/jobs pair makes two dependent calls — have to stay
 * functions.
 *
 * WHAT THIS IS NOT. Not a new host concept. It returns an ordinary
 * `ProviderQuery`, so the registry, the cache, the budget, the consent
 * vocabulary and the generated schema doc all see exactly what they saw before
 * and none of them changed. That is the whole reason it is a builder and not a
 * second kind of query: a declarative form the host had to understand would be
 * a second code path for the thing findings 4 and 7 are about.
 *
 * WHAT IT DELIBERATELY CANNOT DO. No expressions, no conditionals, no chained
 * requests, no computed URLs. A declaration that can express logic is a
 * language, and a language in JSON is one nobody can review at a glance. When a
 * query needs any of that, write the function — they sit side by side in the
 * same `queries` map.
 */

/** A query-string value: fixed by the author, or taken from an argument. */
export type ParamSource = { const: string | number | boolean } | { arg: string };

export interface DeclaredQuery<TArgs extends Record<string, unknown>> {
  /** The sentence a person and a model both read. Required, as everywhere. */
  description: string;
  /**
   * Absolute https URL. `{{placeholder}}` is filled host-side from credential
   * metadata (finding 13) — this code may not see a home id or an account id.
   */
  get: string;
  args?: Record<string, ArgSpec>;
  /** Query-string parameters. An `arg` that was not supplied is omitted. */
  query?: Record<string, ParamSource>;
  result: ResultSchema;
  /**
   * Dotted path to the payload inside the vendor's response.
   *
   * Omitted when the response *is* the payload. `"items"` for GitHub's search
   * envelope, `"results"` for Open-Meteo's geocoder.
   */
  select?: string;
  /**
   * Output field ← dotted path in the vendor's object.
   *
   * The whole normalization step, and the reason it is required rather than
   * optional: handing a widget the vendor's own JSON is what made `tile.ts`
   * read `sensorDataPoints.insideTemperature.celsius`, and a generated widget
   * would have had to guess that path from an example.
   */
  pick: Record<string, string>;
  /**
   * Fields that must be present, or the row is dropped.
   *
   * For the key a widget joins on. A zone with no id renders as a row that
   * matches nothing in `zoneStates` — visibly present, silently empty — and
   * that is worse than a list one item shorter. Declarative rather than a
   * predicate on purpose: "these fields must exist" is the only condition worth
   * having, and anything more expressive is the language this form refuses to
   * become.
   */
  require?: string[];
  key?: (args: TArgs) => QueryKey;
  staleTime?: number;
}

/** Reads `a.b.c` out of parsed JSON, without throwing on a missing branch. */
function at(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      value,
    );
}

/**
 * Applies `pick` to one vendor object. Missing fields become `null`.
 *
 * Values are coerced to the type the `result` schema declares. That is not
 * logic sneaking in — it is the declaration being kept. tado° returns a zone id
 * as a number and the widget joins it against `zoneStates`, whose keys are
 * strings; the hand-written query called `String()` and the first declarative
 * version did not, which produced a list that rendered and matched nothing.
 * A form that lets the author state a type and then hands back another is worse
 * than one with no types at all.
 */
function shape(
  row: unknown,
  pick: Record<string, string>,
  fields: Record<string, ResultSchema> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(pick)) {
    const value = at(row, path);
    out[field] = value === undefined ? null : coerce(value, fields?.[field]);
  }
  return out;
}

function coerce(value: unknown, schema: ResultSchema | undefined): unknown {
  if (value === null || schema === undefined) return value;
  if (schema.type === "string" && (typeof value === "number" || typeof value === "boolean")) {
    return String(value);
  }
  if (schema.type === "number" && typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

/** The declared fields of a list's element, or of the object itself. */
function fieldsOf(result: ResultSchema): Record<string, ResultSchema> | undefined {
  const target = result.type === "list" ? result.of : result;
  return target.type === "object" ? target.fields : undefined;
}

/**
 * Turns a declaration into the `ProviderQuery` the host already understands.
 *
 * The key defaults to every declared argument in declaration order, which is
 * the discriminating part and nothing more — finding 4's rule, applied for the
 * author rather than left to them. The host still prefixes provider id and
 * query name.
 */
export function declaredQuery<TArgs extends Record<string, unknown> = Record<string, never>>(
  declaration: DeclaredQuery<TArgs>,
): ProviderQuery<TArgs, unknown> {
  const argNames = Object.keys(declaration.args ?? {});

  return {
    description: declaration.description,
    args: declaration.args ?? {},
    result: declaration.result,
    key: declaration.key ?? ((args: TArgs) => argNames.map((name) => String(args?.[name] ?? ""))),
    staleTime: declaration.staleTime,
    fetch: async (args: TArgs, host: ProviderHostContext) => {
      const fields = fieldsOf(declaration.result);
      const params: Record<string, string | number | boolean> = {};
      for (const [name, source] of Object.entries(declaration.query ?? {})) {
        if ("const" in source) {
          params[name] = source.const;
          continue;
        }
        const supplied = args?.[source.arg];
        // Omitted rather than sent empty: a vendor treating `?q=` as "match
        // everything" is a different request from not asking at all. The type
        // narrowing is also the check — an ArgSpec only has these three types.
        if (typeof supplied === "string" && supplied !== "") params[name] = supplied;
        else if (typeof supplied === "number" || typeof supplied === "boolean") {
          params[name] = supplied;
        }
      }

      const raw = await host.http.get<unknown>(declaration.get, params);
      const payload = declaration.select ? at(raw, declaration.select) : raw;

      /**
       * A response that is not the declared shape is data, not a failure. The
       * dev-only result check in `runtime.ts` already reports a mismatch to the
       * person who can fix it; throwing here would put an error banner over a
       * widget whose other sources are fine.
       */
      if (declaration.result.type === "list") {
        if (!Array.isArray(payload)) return [];
        return payload
          .map((row) => shape(row, declaration.pick, fields))
          .filter((row) => (declaration.require ?? []).every((field) => row[field] !== null));
      }
      if (payload === null || typeof payload !== "object") return null;
      return shape(payload, declaration.pick, fields);
    },
  };
}
