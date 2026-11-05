// SPDX-License-Identifier: MIT
/**
 * Message catalogs, typed lookup and plural selection — shared by the host and
 * every widget.
 *
 * Here and not in `core/app/i18n/` because a widget may not import core
 * (license and import boundaries, AGENTS.md). The host's own translation layer
 * is built on this file, so there is one formatter, one plural rule and one
 * set of catalog checks.
 *
 * A catalog is a flat object of `key → message`:
 * - `{name}` is replaced by the `name` parameter.
 * - An object is a plural message, picked by `Intl.PluralRules` from the
 *   `count` parameter. `other` is required; the rest is what the language
 *   needs (English: `one`).
 *
 * Declare the source (English) catalog `as const`: the key and parameter types
 * below are read from its literal strings, so a typo in a key or a forgotten
 * parameter fails typecheck instead of rendering `{name}`.
 */

/** Plural forms keyed by `Intl.PluralRules` category. `other` is mandatory. */
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export type MessageValue = string | PluralMessage;

/** Any catalog. The source one is `as const` so its strings stay literal. */
export type Messages = { readonly [key: string]: MessageValue };

/** The `{name}` placeholders of one string, as a union of names. */
type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/** All text a message can render, whether it is a string or plural forms. */
type MessageText<M> = M extends string ? M : M[keyof M];

/**
 * Parameters `t(key, params)` requires: every placeholder, plus `count` for a
 * plural message even when no form prints it.
 */
export type MessageParams<S extends Messages, K extends keyof S> = {
  [Name in Placeholders<MessageText<S[K]>>]: string | number;
} & (S[K] extends string ? unknown : { count: number });

/** What follows the key in a `t()` call: nothing, or the parameters. */
export type TranslateArgs<S extends Messages, K extends keyof S> =
  keyof MessageParams<S, K> extends never ? [] : [params: MessageParams<S, K>];

/** Keys that take no parameters — what a data table (nav labels…) may hold. */
export type SimpleKey<S extends Messages> = {
  [K in keyof S]: S[K] extends string
    ? [Placeholders<S[K]>] extends [never]
      ? K
      : never
    : never;
}[keyof S];

/** A translation of `S`: any subset of its keys, each the same kind of value. */
export type Translation<S extends Messages> = {
  [K in keyof S]?: S[K] extends string ? string : PluralMessage;
};

export interface Translator<S extends Messages> {
  t<K extends keyof S & string>(key: K, ...args: TranslateArgs<S, K>): string;
}

const pluralRules = new Map<string, Intl.PluralRules>();

function rulesFor(lang: string): Intl.PluralRules {
  let rules = pluralRules.get(lang);
  if (!rules) {
    // An unknown tag would throw here; plural rules are never worth a crash.
    try {
      rules = new Intl.PluralRules(lang);
    } catch {
      rules = new Intl.PluralRules("en");
    }
    pluralRules.set(lang, rules);
  }
  return rules;
}

/**
 * Render one message. A placeholder without a parameter stays visible as
 * `{name}`: a wrong label is easier to spot and report than an empty one. The
 * types make that unreachable through `t()`.
 */
export function formatMessage(
  message: MessageValue,
  lang: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const text =
    typeof message === "string"
      ? message
      : (message[rulesFor(lang).select(Number(params.count ?? 0))] ?? message.other);
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * First of `supported` that matches `preferred` (BCP 47 tags, most wanted
 * first, as `navigator.languages` lists them). `de-AT` falls back to `de` before
 * the next preference is tried; no match means `fallback`.
 */
export function resolveLocale<L extends string>(
  preferred: readonly string[],
  supported: readonly L[],
  fallback: L,
): L {
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    for (const candidate of [lower, lower.split("-")[0]]) {
      const hit = supported.find((l) => l.toLowerCase() === candidate);
      if (hit) return hit;
    }
  }
  return fallback;
}

/**
 * A `t()` over `source` and its translations.
 *
 * `locale` is read on every call, so a getter over a reactive value keeps a
 * template in step with it. A tag with a region (`de-AT`) uses `de-AT`, then
 * `de`, then the source — per key, so a half-finished translation shows English
 * where it has gaps rather than nothing.
 */
export function createTranslator<S extends Messages>(
  source: S,
  translations: Readonly<Record<string, Translation<S> | undefined>>,
  locale: () => string | undefined,
): Translator<S> {
  const lookup = (key: string, lang: string): MessageValue => {
    const base = lang.split("-")[0]!;
    const found =
      (translations[lang] as Messages | undefined)?.[key] ??
      (translations[base] as Messages | undefined)?.[key];
    return found ?? (source as Messages)[key] ?? key;
  };
  return {
    t(key, ...args) {
      const lang = locale() || "en";
      return formatMessage(lookup(key, lang), lang, args[0] as Record<string, string | number>);
    },
  };
}

const placeholdersOf = (value: MessageValue): string =>
  [
    ...new Set(
      (typeof value === "string" ? [value] : Object.values(value)).flatMap((text) =>
        [...String(text ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
      ),
    ),
  ]
    .sort()
    .join(",");

/**
 * What a translator can get wrong, as readable problems; empty means fine.
 * `source` is checked on its own when `translation` is omitted.
 *
 * Runtime checks rather than types, because a catalog that arrives as JSON or
 * is written without `satisfies Translation<…>` has no types to catch it.
 */
export function catalogProblems(
  source: Messages,
  translation?: Readonly<Record<string, unknown>>,
): string[] {
  const problems: string[] = [];
  const valid = (key: string, value: unknown): value is MessageValue => {
    if (typeof value === "string") {
      if (value.trim()) return true;
      problems.push(`"${key}" is empty`);
      return false;
    }
    if (typeof value === "object" && value !== null && typeof (value as PluralMessage).other === "string") {
      return true;
    }
    problems.push(`"${key}" is neither a string nor plural forms with "other"`);
    return false;
  };

  if (!translation) {
    for (const [key, value] of Object.entries(source)) valid(key, value);
    return problems;
  }
  for (const [key, value] of Object.entries(translation)) {
    const original = source[key];
    if (original === undefined) {
      problems.push(`"${key}" is not a key of the source catalog`);
      continue;
    }
    if (!valid(key, value)) continue;
    if (typeof value !== typeof original) {
      problems.push(`"${key}" ${typeof original === "string" ? "is plural here but not in the source" : "is plural in the source but not here"}`);
      continue;
    }
    if (placeholdersOf(value) !== placeholdersOf(original)) {
      problems.push(`"${key}" uses {${placeholdersOf(value)}} but the source uses {${placeholdersOf(original)}}`);
    }
  }
  return problems;
}
