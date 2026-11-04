/**
 * Host UI translation: one reactive locale, typed message keys, `t()`.
 *
 * Deliberately no i18n library. What the host needs is a lookup, `{name}`
 * interpolation and plural selection — `Intl.PluralRules` does the hard part.
 * vue-i18n would add a message compiler (either a build plugin or an
 * `eval`-style runtime the main-window CSP should not have to allow) for
 * features nobody here uses yet.
 *
 * Reactivity: `t()` reads `locale.value`, so a template or `computed` that calls
 * it re-renders when the locale changes. A string resolved once at module load
 * does not — call `t()` where the text is shown, not where data is declared.
 *
 * Scope: `core/app/` only. `sdk/` and `extensions/` must not import this file
 * (license and import boundaries, AGENTS.md); translating extension strings
 * is an SDK contract change of its own.
 */
import { readonly, ref } from "vue";
import { en } from "./messages/en";

/** Plural forms keyed by `Intl.PluralRules` category. `other` is mandatory. */
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

type Source = typeof en;
export type MessageKey = keyof Source;

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
export type MessageParams<K extends MessageKey> = {
  [Name in Placeholders<MessageText<Source[K]>>]: string | number;
} & (Source[K] extends string ? unknown : { count: number });

/** Keys that take no parameters — what data tables (nav labels…) may hold. */
export type SimpleMessageKey = {
  [K in MessageKey]: Source[K] extends string
    ? [Placeholders<Source[K]>] extends [never]
      ? K
      : never
    : never;
}[MessageKey];

/** A translation: any subset of the source keys, same kind of value. */
export type Catalog = {
  [K in MessageKey]?: Source[K] extends string ? string : PluralMessage;
};

export const SOURCE_LOCALE = "en";

/**
 * Every locale that ships a catalog. Adding one is: a file next to `en.ts`,
 * an entry here — nothing else; `resolveLocale` picks it up from the OS.
 */
export const CATALOGS = {
  en: en as Catalog,
} satisfies Record<string, Catalog>;

export type Locale = keyof typeof CATALOGS;

export const SUPPORTED_LOCALES = Object.keys(CATALOGS) as Locale[];

const current = ref<Locale>(SOURCE_LOCALE);

/** The active locale. Read-only: change it with `setLocale`. */
export const locale = readonly(current);

/**
 * First supported locale among `preferred` (BCP 47 tags, most wanted first, as
 * `navigator.languages` lists them). `de-AT` falls back to `de` before the next
 * preference is tried; nothing supported means the source locale.
 */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    for (const candidate of [lower, lower.split("-")[0]]) {
      const hit = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === candidate);
      if (hit) return hit;
    }
  }
  return SOURCE_LOCALE;
}

export function setLocale(next: Locale): void {
  current.value = next;
  // Screen readers and the browser's hyphenation read the document language.
  if (typeof document !== "undefined") document.documentElement.lang = next;
}

/** Pick the locale from the OS/browser languages. Call once per entry point. */
export function initLocale(): void {
  const preferred =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  setLocale(resolveLocale(preferred));
}

const pluralRules = new Map<string, Intl.PluralRules>();

/**
 * Render one message. Pure — exported for the assert file and for callers that
 * format a message they did not get from a catalog.
 *
 * A placeholder without a parameter stays visible as `{name}`: a wrong label is
 * easier to spot and report than an empty one. The types make it unreachable
 * through `t()`.
 */
export function formatMessage(
  message: string | PluralMessage,
  lang: string,
  params: Record<string, string | number> = {},
): string {
  let text: string;
  if (typeof message === "string") {
    text = message;
  } else {
    let rules = pluralRules.get(lang);
    if (!rules) pluralRules.set(lang, (rules = new Intl.PluralRules(lang)));
    const count = Number(params.count ?? 0);
    text = message[rules.select(count)] ?? message.other;
  }
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * The text for `key` in the active locale, falling back to English for a key
 * the locale has not translated.
 */
export function t<K extends MessageKey>(
  key: K,
  ...args: keyof MessageParams<K> extends never ? [] : [params: MessageParams<K>]
): string {
  const lang = current.value;
  const message = CATALOGS[lang][key] ?? (en[key] as string | PluralMessage);
  return formatMessage(message, lang, args[0] as Record<string, string | number> | undefined);
}
