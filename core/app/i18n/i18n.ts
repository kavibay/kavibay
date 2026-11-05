/**
 * Host UI translation: one reactive locale, typed message keys, `t()`.
 *
 * Deliberately no i18n library. What the host needs is a lookup, `{name}`
 * interpolation and plural selection — `Intl.PluralRules` does the hard part.
 * vue-i18n would add a message compiler (either a build plugin or an
 * `eval`-style runtime the main-window CSP should not have to allow) for
 * features nobody here uses yet.
 *
 * The formatter, the key/parameter types and the catalog checks live in
 * `@sdk/i18n` (MIT), because widgets use the same ones and may not import core.
 * This file adds what only the host has: the app's locale and its catalogs.
 *
 * Reactivity: `t()` reads `locale.value`, so a template or `computed` that calls
 * it re-renders when the locale changes. A string resolved once at module load
 * does not — call `t()` where the text is shown, not where data is declared.
 */
import { readonly, ref } from "vue";
import {
  createTranslator,
  resolveLocale as resolveFrom,
  type MessageParams as ParamsOf,
  type SimpleKey,
  type Translation,
} from "@sdk/i18n";
import { en } from "./messages/en";

type Source = typeof en;
export type MessageKey = keyof Source;
export type MessageParams<K extends MessageKey> = ParamsOf<Source, K>;
/** Keys that take no parameters — what data tables (nav labels…) may hold. */
export type SimpleMessageKey = SimpleKey<Source>;
export type Catalog = Translation<Source>;

export const SOURCE_LOCALE = "en";

/**
 * Every locale the host UI ships. Adding one is: a file next to `en.ts`, an
 * entry here — nothing else; `initLocale` picks it up from the OS.
 *
 * This list also caps what widgets are shown in (`ctx.locale` is this locale):
 * a widget with a German catalog stays English in an English app rather than
 * mixing languages on one desk.
 */
export const CATALOGS = {
  en: en as Catalog,
} satisfies Record<string, Catalog>;

export type Locale = keyof typeof CATALOGS;

export const SUPPORTED_LOCALES = Object.keys(CATALOGS) as Locale[];

const current = ref<Locale>(SOURCE_LOCALE);

/** The active locale. Read-only: change it with `setLocale`. */
export const locale = readonly(current);

export function resolveLocale(preferred: readonly string[]): Locale {
  return resolveFrom(preferred, SUPPORTED_LOCALES, SOURCE_LOCALE);
}

export function setLocale(next: Locale): void {
  current.value = next;
  // Screen readers and the browser's hyphenation read the document language.
  if (typeof document !== "undefined") document.documentElement.lang = next;
}

/**
 * Pick the locale from the OS/browser languages. Call once per entry point,
 * before anything that reads extension catalogs is imported — bundled
 * extensions are localized when their module loads (`bundledExtensions.ts`).
 */
export function initLocale(): void {
  const preferred =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  setLocale(resolveLocale(preferred));
}

/**
 * The text for `key` in the active locale, falling back to English for a key
 * the locale has not translated.
 */
export const { t } = createTranslator(en, CATALOGS, () => current.value);
