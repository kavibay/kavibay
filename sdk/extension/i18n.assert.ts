// SPDX-License-Identifier: MIT
import { catalogProblems, createTranslator, resolveLocale, type Translation } from "./i18n";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const source = {
  hello: "Hello {name}",
  bye: "Bye",
  laps: { one: "{count} lap", other: "{count} laps" },
} as const;

const de: Translation<typeof source> = { hello: "Hallo {name}", laps: { one: "{count} Runde", other: "{count} Runden" } };
const deAt: Translation<typeof source> = { hello: "Servus {name}" };

let lang: string | undefined = "de";
const { t } = createTranslator(source, { de, "de-AT": deAt }, () => lang);

// --- lookup and fallback --------------------------------------------------

assert(t("hello", { name: "Alex" }) === "Hallo Alex", "the active locale wins");
assert(t("bye") === "Bye", "a key the locale lacks falls back to the source");
assert(t("laps", { count: 3 }) === "3 Runden", "plural forms come from the locale");
lang = "de-AT";
assert(t("hello", { name: "Alex" }) === "Servus Alex", "the regional catalog wins over its base");
assert(t("laps", { count: 1 }) === "1 Runde", "a regional gap falls to the base language");
lang = "fr";
assert(t("hello", { name: "Alex" }) === "Hello Alex", "an unknown locale is the source");
lang = undefined;
assert(t("laps", { count: 1 }) === "1 lap", "no locale at all is the source");
lang = "not a tag!";
assert(t("laps", { count: 2 }) === "2 laps", "an invalid tag does not throw");

// --- resolveLocale ---------------------------------------------------------

assert(resolveLocale(["de-AT", "en"], ["en", "de"], "en") === "de", "region falls to the base language");
assert(resolveLocale(["fr", "DE"], ["en", "de"], "en") === "de", "later preferences are tried, case-blind");
assert(resolveLocale(["fr"], ["en", "de"], "en") === "en", "nothing supported is the fallback");

// --- catalogProblems ---------------------------------------------------------

assert(catalogProblems(source).length === 0, "a clean source has no problems");
assert(catalogProblems(source, de).length === 0, "a clean translation has no problems");
const found = (translation: Record<string, unknown>) => catalogProblems(source, translation).join(" | ");
assert(found({ helo: "x" }).includes("not a key"), "an unknown key is reported");
assert(found({ hello: "Hallo {nmae}" }).includes("{nmae}"), "a renamed placeholder is reported");
assert(found({ laps: "Runden" }).includes("plural in the source"), "a plural turned string is reported");
assert(found({ bye: "  " }).includes("empty"), "an empty message is reported");
assert(found({ laps: { one: "x" } }).includes("other"), "plural forms without other are reported");

console.log("sdk/extension/i18n.assert.ts: ok");
