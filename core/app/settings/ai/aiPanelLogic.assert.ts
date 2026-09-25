/**
 * AI panel tab logic.
 * Run: npx tsx core/app/settings/ai/aiPanelLogic.assert.ts
 */
import type { LlmModelOption } from "./aiApi";
import {
  AI_PROVIDER_TABS,
  altGrCharacter,
  credentialTypeForProvider,
  enabledSummary,
  modelsForProvider,
  providerHasKey,
  resolveAiProviderFocus,
  quickModelChoices,
  quickModelSelection,
  shortcutFromKey,
  withModelEnabled,
  type ShortcutKey,
} from "./aiPanelLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function model(over: Partial<LlmModelOption> & { id: string }): LlmModelOption {
  return {
    label: over.id,
    note: "n",
    description: "description",
    provider: "anthropic",
    vendor: "anthropic",
    context: { windowTokens: 1_000_000 },
    pricing: { currency: "USD", unitTokens: 1_000_000, input: 1, output: 2 },
    capabilities: ["text"],
    sourceUrl: "https://example.com/model",
    credentialType: "anthropicApi",
    configured: true,
    enabled: true,
    ...over,
  };
}

const catalog: LlmModelOption[] = [
  model({ id: "claude-opus-5" }),
  model({ id: "claude-sonnet-5", enabled: false }),
  model({
    id: "gpt-5.6-luna",
    provider: "openai",
    vendor: "openai",
    credentialType: "openaiApi",
    configured: false,
  }),
  model({
    id: "@cf/meta/llama-3.2-1b-instruct",
    provider: "cloudflare",
    vendor: "meta",
    credentialType: "cloudflareWorkersAi",
    configured: false,
    enabled: false,
  }),
];

// Every tab the panel renders must be able to find its models — a tab with a
// provider id the catalog never uses would show an empty card and no reason why.
for (const tab of AI_PROVIDER_TABS) {
  assert(modelsForProvider(catalog, tab.id).length > 0, `${tab.id} has no models`);
  assert(credentialTypeForProvider(catalog, tab.id) !== null, `${tab.id} has no credential`);
}

assert(AI_PROVIDER_TABS.length === 3, "three provider tabs");
assert(
  AI_PROVIDER_TABS.map((tab) => tab.id).join() === "anthropic,openai,cloudflare",
  "tab order is fixed",
);

// Grouping keeps catalog order (strongest first), so the list does not reshuffle.
assert(
  modelsForProvider(catalog, "anthropic")
    .map((entry) => entry.id)
    .join() === "claude-opus-5,claude-sonnet-5",
  "provider models keep catalog order",
);

assert(
  credentialTypeForProvider(catalog, "cloudflare") === "cloudflareWorkersAi",
  "credential type comes from the model rows",
);
assert(
  credentialTypeForProvider([], "anthropic") === null,
  "an empty catalog reports no credential rather than guessing one",
);

const anthropic = enabledSummary(catalog, "anthropic");
assert(anthropic.enabled === 1 && anthropic.total === 2, "counts on and total");
const cloudflare = enabledSummary(catalog, "cloudflare");
assert(cloudflare.enabled === 0 && cloudflare.total === 1, "a fully-off provider counts zero");

assert(providerHasKey(catalog, "anthropic"), "a stored key shows the model list");
assert(!providerHasKey(catalog, "openai"), "no key, no model list");
assert(!providerHasKey(catalog, "cloudflare"), "an unkeyed provider stays hidden");
assert(!providerHasKey([], "anthropic"), "an empty catalog has no key");

assert(resolveAiProviderFocus("openai") === "openai", "a tab id selects that tab");
assert(
  resolveAiProviderFocus("cloudflareWorkersAi", catalog) === "cloudflare",
  "a credential type selects the provider that uses it",
);
assert(resolveAiProviderFocus("nope", catalog) === null, "unknown focus is ignored");
assert(resolveAiProviderFocus(null) === null, "absent focus leaves the default tab");

const toggled = withModelEnabled(catalog, "claude-sonnet-5", true);
assert(toggled[1].enabled, "the named model flips");
assert(!catalog[1].enabled, "the source list is untouched");
assert(toggled[0] === catalog[0], "untouched rows are not rebuilt");
assert(
  withModelEnabled(catalog, "nope", false).every((entry, i) => entry === catalog[i]),
  "an unknown id changes nothing",
);

// --- quick-action model picker ---
// Only one row in the fixture is both switched on and keyed; the panel must
// offer exactly that one, never a model the hotkey would fail on.
const choices = quickModelChoices(catalog);
assert(
  choices.map((entry) => entry.id).join() === "claude-opus-5",
  `unexpected quick-action choices: ${choices.map((entry) => entry.id).join()}`,
);
assert(quickModelChoices([]).length === 0, "nothing set up, nothing to pick");

assert(
  quickModelSelection(catalog, "claude-opus-5") === "claude-opus-5",
  "a usable stored model stays selected",
);
assert(
  quickModelSelection(catalog, "claude-sonnet-5") === "",
  "a model switched off since falls back to Automatic",
);
assert(
  quickModelSelection(catalog, "gpt-5.6-luna") === "",
  "a model whose key was removed falls back to Automatic",
);
assert(quickModelSelection(catalog, "") === "", "Automatic stays Automatic");

// --- shortcut capture ------------------------------------------------------
//
// The pressed key is described the way the browser reports it: `key` is what
// the layout produced, `code` is the key under the finger.

function press(over: Partial<ShortcutKey> & { code: string }): ShortcutKey {
  return {
    key: over.key ?? "",
    code: over.code,
    ctrlKey: over.ctrlKey ?? false,
    altKey: over.altKey ?? false,
    shiftKey: over.shiftKey ?? false,
    metaKey: over.metaKey ?? false,
  };
}

/** German layout: AltGr+Q is the `@` key, and Windows reports AltGr as Ctrl+Alt. */
const altGrQ = press({ key: "@", code: "KeyQ", ctrlKey: true, altKey: true });

assert(altGrCharacter(altGrQ) === "@", "the character AltGr+Q would cost is named");
assert(
  altGrCharacter(press({ key: "{", code: "Digit7", ctrlKey: true, altKey: true })) === "{",
  "digits carry AltGr characters too",
);
assert(
  altGrCharacter(press({ key: "\\", code: "Minus", ctrlKey: true, altKey: true })) === "\\",
  "a key this layout places elsewhere counts as AltGr territory",
);
// A US keyboard has no AltGr: the same press produces the plain letter, and
// Ctrl+Alt is a shortcut like any other. Testing beats banning the modifier.
assert(
  altGrCharacter(press({ key: "q", code: "KeyQ", ctrlKey: true, altKey: true })) === null,
  "Ctrl+Alt stays available where it produces nothing",
);
assert(
  altGrCharacter(press({ key: "Q", code: "KeyQ", ctrlKey: true, shiftKey: true })) === null,
  "Ctrl+Shift is never AltGr",
);
assert(
  altGrCharacter(press({ key: "Dead", code: "Equal", ctrlKey: true, altKey: true })) === null,
  "a dead key names no character, so it is not refused on a guess",
);

assert(shortcutFromKey(altGrQ) === "Ctrl+Alt+Q", "the physical key names the shortcut, not `@`");
assert(
  shortcutFromKey(press({ key: "Q", code: "KeyQ", ctrlKey: true, shiftKey: true })) ===
    "Ctrl+Shift+Q",
  "the shipped default round-trips through capture",
);
assert(
  shortcutFromKey(press({ key: "1", code: "Numpad1", ctrlKey: true })) === "Ctrl+Num1",
  "numpad keys keep their own names",
);
assert(
  shortcutFromKey(press({ key: "Control", code: "ControlLeft", ctrlKey: true })) === null,
  "a modifier alone is not a shortcut",
);
assert(
  shortcutFromKey(press({ key: "q", code: "KeyQ" })) === null,
  "a bare key is not a shortcut",
);

console.log("aiPanelLogic.assert.ts: ok");
