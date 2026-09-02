/**
 * Fuzzy quality gates — reject sparse false positives, keep acronyms.
 * Run: npx tsx src/palette/fuzzy.assert.ts
 */
import { fuzzyMatch } from "./fuzzy";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(fuzzyMatch("heidi", "HeidiSQL").matched, "heidi → HeidiSQL");
assert(
  !fuzzyMatch("heidi", "Grand Theft Auto IV The Complete Edition").matched,
  "heidi must not match GTA",
);
assert(
  !fuzzyMatch(
    "heidi",
    "Realtek USB Ethernet Controller All-In-One Windows Driver",
  ).matched,
  "heidi must not match Realtek driver",
);

assert(fuzzyMatch("ob", "Open Browser").matched, "ob → Open Browser word starts");
assert(fuzzyMatch("chr", "Google Chrome").matched, "chr → Chrome");
assert(fuzzyMatch("ala", "Alarm").matched, "ala → Alarm");
assert(!fuzzyMatch("ala", "Calculator").matched, "ala must not match Calculator");
assert(fuzzyMatch("gta", "Grand Theft Auto").matched, "gta → GTA word starts");
assert(fuzzyMatch("note", "Notes").matched, "note → Notes");
assert(fuzzyMatch("s", "Spotify").matched, "s → Spotify word start");
assert(fuzzyMatch("s", "Settings").matched, "s → Settings word start");
assert(
  !fuzzyMatch("s", "Discord").matched,
  "s must not match mid-word-only titles",
);

const chrome = fuzzyMatch("chr", "Google Chrome");
const calc = fuzzyMatch("chr", "Calculator");
assert(chrome.matched && !calc.matched, "chr prefers Chrome over Calculator");

assert(!fuzzyMatch("sb", "Create USB Recovery").matched, "sb ↛ USB mid-token");
assert(!fuzzyMatch("sb", "Windows Backup").matched, "sb ↛ Windows Backup density");
assert(
  !fuzzyMatch("sb", "ODBC Data Sources (32-bit)").matched,
  "sb ↛ Sources+bit weak acronym",
);
assert(fuzzyMatch("sl", "Slack").matched, "sl → Slack prefix");
assert(fuzzyMatch("sb", "Sublime Text").matched, "sb → Sublime Text prefixDense");
assert(fuzzyMatch("ob", "Open Browser").matched, "ob → Open Browser twoWordStarts");
assert(fuzzyMatch("st", "Sublime Text").matched, "st → Sublime Text twoWordStarts");

// --- separators are interchangeable ----------------------------------------
// A generated widget is named by its id, and an id is hyphenated. Typing the
// name the way a person says it used to find nothing: the comparison was
// character-for-character, so the space failed against the hyphen and the whole
// query was rejected. The widget was in the palette the entire time.
assert(fuzzyMatch("hello world", "hello-world").matched, "a typed space finds a hyphen");
assert(fuzzyMatch("hello-world", "hello world").matched, "and the other way round");
assert(fuzzyMatch("air quality", "air_quality").matched, "underscores too");
assert(fuzzyMatch("helloworld", "hello-world").matched, "leaving it out still works");
assert(fuzzyMatch("hello world", "Hello World").matched, "and so does typing it exactly");

// Only separators widen. A letter must still be that letter, or every query
// would start matching things it has no business matching.
assert(!fuzzyMatch("hello worlt", "hello-world").matched, "a wrong letter is still wrong");
assert(!fuzzyMatch("hello-world", "helloworld").matched, "a separator is not free to invent");

// --- the query spells a later word ------------------------------------------
// Greedy-from-the-left spends the w and the i on "Widget" and reaches "Wizard"
// with only the z left, which the density rule for 3-char queries rejects. The
// Widget Wizard was in the palette and typing "wiz" did not find it.
assert(fuzzyMatch("wiz", "Widget Wizard").matched, "wiz → Widget Wizard");
assert(fuzzyMatch("wiz", "widget-wizard").matched, "and the same for its id");

// Scored on the word it actually spells, so it ranks like the exact hit it is:
// above a title where the same three letters are merely dense enough.
assert(
  fuzzyMatch("wiz", "Widget Wizard").score > fuzzyMatch("wiz", "Window Size").score,
  "a whole word outranks a scattered-but-dense hit",
);

// Reading from the right must not turn the matcher into a bag of letters.
assert(!fuzzyMatch("wzi", "Widget Wizard").matched, "order still decides");
assert(!fuzzyMatch("wiz", "Windows Explorer").matched, "a missing letter is still missing");

console.log("fuzzy.assert: ok");
