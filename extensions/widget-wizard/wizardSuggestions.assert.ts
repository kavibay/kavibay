import {
  appendWizardSuggestion,
  currentWizardSuggestions,
  readWizardSuggestions,
} from "./wizardSuggestions";
import { emptyWizardSession, parseGeneratedFiles, parseWizardSession } from "./widgetWizardLogic";

function equal(actual: unknown, expected: unknown): void {
  if (!Object.is(actual, expected)) throw new Error(`${String(actual)} !== ${String(expected)}`);
}

function deepEqual(actual: unknown, expected: unknown): void {
  equal(JSON.stringify(actual), JSON.stringify(expected));
}

const suggestions = [
  { label: "Wochenansicht", prompt: "Zeige meinen Wasserverbrauch für diese Woche an." },
  { label: "Ziel einstellen", prompt: "Mache das tägliche Trinkziel in den Einstellungen änderbar." },
  { label: "Kompakter", prompt: "Mache das Widget kompakter und halte die Hauptaktion sichtbar." },
];
const fence = (body: string, ticks = "```") => `${ticks}kavibay-suggestions\n${body}\n${ticks}`;
const files = '```json path=manifest.json\n{"id":"water-tracker"}\n```';
const reply = parseGeneratedFiles(`A water tracker.\n${files}\n${fence(JSON.stringify(suggestions))}`);
deepEqual(reply.suggestions, suggestions);
equal(reply.prose, "A water tracker.");
deepEqual(reply.files, [{ path: "manifest.json", contents: '{"id":"water-tracker"}' }]);
equal(reply.unterminated, null);

// Invalid or incomplete metadata never rejects valid files or leaks into the explanation.
for (const body of ["not json", "null", "{}", '[{"label":3}]']) {
  const parsed = parseGeneratedFiles(`${files}\n${fence(body)}`);
  deepEqual(parsed.suggestions, []);
  deepEqual(parsed.files, reply.files);
  equal(parsed.prose, "");
  equal(parsed.unterminated, null);
}
const incomplete = parseGeneratedFiles(`${files}\n\`\`\`kavibay-suggestions\n[{"label":"unfinished"`);
deepEqual(incomplete.files, reply.files);
deepEqual(incomplete.suggestions, []);
equal(incomplete.prose, "");
equal(incomplete.unterminated, null);
deepEqual(parseGeneratedFiles(files).suggestions, []);
deepEqual(parseGeneratedFiles(fence(JSON.stringify(suggestions), "````")).suggestions, suggestions);

// Fences inside a generated source file are widget content, not assistant metadata.
const nested = fence(JSON.stringify(suggestions));
const embedded = parseGeneratedFiles(`\`\`\`\`text path=example.txt\n${nested}\n\`\`\`\``);
equal(embedded.files[0].contents, nested);
deepEqual(embedded.suggestions, []);
const malformedWithFile = parseGeneratedFiles(fence('```js path=surprise.js\nalert(1)'));
deepEqual(malformedWithFile.files, []);

deepEqual(readWizardSuggestions([
  null, 42, {}, { label: "", prompt: "x" },
  { label: "Too long", prompt: "x".repeat(301) },
  { label: "x".repeat(49), prompt: "A request" },
  { label: " Wochenansicht  ", prompt: "  Zeige meinen\nWasserverbrauch für diese Woche an. " },
  { label: "WOCHENANSICHT", prompt: "A duplicate label" },
  { label: "Same request", prompt: suggestions[0].prompt },
  ...suggestions.slice(1),
  { label: "Fourth", prompt: "Not shown" },
]), suggestions);

const first = { role: "assistant", version: "v1", suggestions };
const secondSuggestions = [{ label: "Monatsansicht", prompt: "Ergänze eine Monatsübersicht." }];
const second = { role: "assistant", version: "v2", suggestions: secondSuggestions };
deepEqual(currentWizardSuggestions([first], "v1"), suggestions);
deepEqual(currentWizardSuggestions([first, { role: "system" }], "v1"), suggestions);
deepEqual(currentWizardSuggestions([first, { role: "user" }], "v1"), []);
deepEqual(currentWizardSuggestions([first, { role: "user" }, { role: "system" }], "v1"), []);
deepEqual(currentWizardSuggestions([first, second], "v2"), secondSuggestions);
deepEqual(currentWizardSuggestions([first, second], "v1"), []);
deepEqual(currentWizardSuggestions([first], "mcp-version"), []);
deepEqual(currentWizardSuggestions([first, { role: "assistant" }], "v1"), []);
deepEqual(currentWizardSuggestions([first], undefined), []);
deepEqual(currentWizardSuggestions([{ ...first, suggestions: "corrupt" }], "v1"), []);

const session = { ...emptyWizardSession(), currentVersion: "v1", bubbles: [first] };
const restored = parseWizardSession(JSON.stringify(session));
deepEqual(currentWizardSuggestions(restored.bubbles, restored.currentVersion), suggestions);
const legacy = parseWizardSession(JSON.stringify({ ...session, bubbles: [{ role: "assistant", text: "Done", version: "v1" }] }));
deepEqual(currentWizardSuggestions(legacy.bubbles, legacy.currentVersion), []);

const prompt = suggestions[0].prompt;
equal(appendWizardSuggestion("", prompt), prompt);
equal(appendWizardSuggestion("  ", prompt), prompt);
equal(appendWizardSuggestion("Keep this text.  ", prompt), `Keep this text.  \n${prompt}`);
equal(appendWizardSuggestion("Keep this text.\n", prompt), `Keep this text.\n${prompt}`);
equal(appendWizardSuggestion(`Keep this text.\n${prompt}`, prompt), `Keep this text.\n${prompt}`);

console.log("wizardSuggestions assertions passed");
