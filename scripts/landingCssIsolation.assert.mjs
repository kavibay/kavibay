/**
 * CI guard: nothing in `landing/styles.css` may paint inside `<kavibay-widget>`.
 *
 * WHAT THIS CATCHES:
 *
 * The landing page and the app were written years apart by the same hands, so
 * they reach for the same words. `.widget-card` is the gallery tile here and
 * the shipping `WidgetCard.vue` there. `.wiz` is the old wizard mock-up here
 * and the root of `WidgetWizardWidget.vue` there. `note` is a callout box here
 * and a transcript-line modifier there. Once the playground mounted the real
 * component into this document, every one of those names addressed two things
 * at once — and the page's rule, being unscoped, won wherever the component
 * had not declared the same property.
 *
 * Measured, before this file existed: the Wizard card carried a second
 * background and a second drop shadow, `will-change: transform` (which creates
 * a containing block and would have thrown the Wizard's `position: fixed`
 * integrations menu somewhere else entirely), `scale(1.05)` on hover, and a
 * `width: 97%` that left it standing 31 px short inside its own card body.
 * None of it looked broken. It looked like a slightly different product.
 *
 * WHY A STATIC CHECK AND NOT A SCREENSHOT:
 *
 * Most of these only appear in a state the page is rarely in — a system note
 * in the transcript, a hovered card, a menu that is open. A rendered check
 * sees the state it happens to catch; this one sees every rule.
 *
 * THE RULE:
 *
 * A selector in `landing/styles.css` fails if the class it *targets* (the last
 * compound — what the rule actually paints) is a class the widget bundle also
 * styles, unless some ancestor in the same selector is a class that only the
 * landing has. `.widget-gallery .widget-card` passes: `.widget-gallery` never
 * occurs inside a widget, so the rule cannot reach one. Bare `.widget-card`
 * fails.
 *
 * Deliberate styling of the embed — `.wizplay kavibay-widget`, the token block
 * it shares with the palette — targets the element, not a class inside it, and
 * never trips this.
 *
 * Run: node scripts/landingCssIsolation.assert.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = join(repoRoot, "../www.kavibay.com");
const EMBED_CSS = join(siteRoot, "embed/kavibay-embed.css");
const LANDING_CSS = join(siteRoot, "styles.css");

/**
 * Comments out, without moving anything: replaced by spaces so the line
 * numbers in a failure still point at the rule.
 */
const stripComments = (css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));

/** Class names in a chunk of selector text. */
const classesIn = (text) =>
  [...text.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);

/**
 * Every selector list in a stylesheet, with the line its selector starts on.
 *
 * A brace scanner rather than a CSS parser: what precedes a `{`, back to the
 * last `}` or `;`, is the selector list. That is true for both files — one is
 * hand-written and one is minified — and a parser dependency for this would be
 * more surface than the check itself.
 */
function selectorLists(css) {
  const found = [];
  let buffer = "";
  let line = 1;
  let startLine = 1;

  for (const character of css) {
    if (character === "\n") line += 1;

    if (character === "{") {
      const selector = buffer.trim();
      if (selector) found.push({ selector, line: startLine });
      buffer = "";
      startLine = line;
    } else if (character === "}" || character === ";") {
      buffer = "";
      startLine = line;
    } else {
      if (!buffer.trim()) startLine = line;
      buffer += character;
    }
  }

  return found;
}

/**
 * Combinators inside `:is(…)`, `:not(…)` or an attribute value are not
 * combinators of this selector, so blank those out before splitting on them.
 */
const maskGroups = (selector) =>
  selector
    .replace(/\([^()]*\)/g, (match) => `(${"_".repeat(match.length - 2)})`)
    .replace(/\[[^\]]*\]/g, (match) => `[${"_".repeat(match.length - 2)}]`);

const splitCompounds = (selector) => selector.split(/[\s>+~]+/).filter(Boolean);

if (!existsSync(EMBED_CSS)) {
  // Same courtesy `embedImportGuard.assert.mjs` extends: the bundle is a build
  // artifact (`npm run build:embed`), not something a fresh clone has.
  console.log("scripts/landingCssIsolation.assert.mjs: skipped (no built embed CSS)");
  process.exit(0);
}

/** Every class the widget bundle styles — i.e. every class that can occur inside a card. */
const widgetClasses = new Set(
  selectorLists(stripComments(readFileSync(EMBED_CSS, "utf8"))).flatMap((rule) =>
    classesIn(rule.selector),
  ),
);

const violations = [];

for (const { selector, line } of selectorLists(stripComments(readFileSync(LANDING_CSS, "utf8")))) {
  if (selector.startsWith("@")) continue;

  for (const single of selector.split(",")) {
    const one = single.trim();
    if (!one) continue;

    const compounds = splitCompounds(one);
    const masked = splitCompounds(maskGroups(one));
    // The masked split is the authority on how many compounds there are; the
    // unmasked one carries the text.
    const subject = compounds[masked.length - 1] ?? one;

    const targeted = classesIn(subject).filter((name) => widgetClasses.has(name));
    if (targeted.length === 0) continue;

    const ancestors = compounds.slice(0, masked.length - 1).join(" ");
    if (classesIn(ancestors).some((name) => !widgetClasses.has(name))) continue;

    violations.push(
      `www.kavibay.com/styles.css:${line}  ${one}\n` +
        `    targets ${targeted.map((name) => `.${name}`).join(", ")}, which the widget bundle also styles.\n` +
        `    Bind it to a landing-only ancestor, or rename it.`,
    );
  }
}

if (violations.length > 0) {
  console.error(
    `${violations.length} landing rule(s) reach inside <kavibay-widget>:\n\n${violations.join("\n\n")}\n`,
  );
  process.exit(1);
}

console.log("scripts/landingCssIsolation.assert.mjs: ok");
