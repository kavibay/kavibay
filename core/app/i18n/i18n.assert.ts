import { catalogProblems, formatMessage, type PluralMessage } from "@sdk/i18n";
import { CATALOGS, resolveLocale, setLocale, t } from "./i18n";
import { en } from "./messages/en";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

setLocale("en");

// --- t(): lookup, interpolation, plurals -----------------------------------

assert(t("settings.nav.about") === "About", "plain key resolves");
assert(t("about.version", { version: "0.1.4" }) === "Version 0.1.4", "placeholder is filled");
assert(t("extensions.bulkAdd.added", { count: 1 }) === "Added 1 widget.", "one is singular");
assert(t("extensions.bulkAdd.added", { count: 4 }) === "Added 4 widgets.", "several are plural");
assert(t("extensions.bulkAdd.added", { count: 0 }) === "Added 0 widgets.", "zero is plural in English");

// --- formatMessage(): the rules t() relies on ------------------------------

assert(formatMessage("Hi {name}", "en", {}) === "Hi {name}", "a missing parameter stays visible");
assert(formatMessage("{a}{a}", "en", { a: 1 }) === "11", "every occurrence is replaced");
const forms: PluralMessage = { one: "one", few: "few", many: "many", other: "other" };
assert(formatMessage(forms, "pl", { count: 3 }) === "few", "plural category comes from the locale");
assert(formatMessage(forms, "pl", { count: 5 }) === "many", "Polish 5 is many");
assert(formatMessage({ other: "x" }, "en", { count: 1 }) === "x", "a missing category falls to other");

// --- resolveLocale(): OS languages to a supported locale -------------------

assert(resolveLocale([]) === "en", "no preference is the source locale");
assert(resolveLocale(["EN-gb"]) === "en", "region and case are ignored");
assert(resolveLocale(["xx-YY"]) === "en", "an unsupported language falls back");

// --- catalog hygiene: what a translator can get wrong ----------------------

const sourceProblems = catalogProblems(en);
assert(sourceProblems.length === 0, `en: ${sourceProblems.join("; ")}`);
for (const [lang, catalog] of Object.entries(CATALOGS)) {
  if (lang === "en") continue;
  const problems = catalogProblems(en, catalog);
  assert(problems.length === 0, `${lang}: ${problems.join("; ")}`);
}

console.log("i18n.assert.ts: ok");
