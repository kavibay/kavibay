/**
 * Pure-logic checks: `npx tsx extensions/one-purpose-llm/onePurposeLlmLogic.assert.ts`
 */
import {
  buildApiMessages,
  createCustomPurposeTemplate,
  DEFAULT_ONE_PURPOSE_ID,
  defaultModel,
  findPurpose,
  formatModelPricing,
  isPromptDefault,
  normalizeHiddenPurposeIds,
  type LlmModelOption,
  MAX_ONE_PURPOSE_WIDTH,
  MIN_ONE_PURPOSE_HEIGHT,
  normalizeOnePurposeSettings,
  normalizeCustomPurposeTemplates,
  ONE_PURPOSE_PURPOSES,
  providerLabel,
  resolveSystemPrompt,
  settingsForDuplicate,
  sortModels,
  purposesForTemplates,
} from "./onePurposeLlmLogic";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: ${String(actual)} !== ${String(expected)}`);
}

function deepEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`);
}

/** A catalog row as the host reports it. */
function model(id: string, provider: string, configured: boolean): LlmModelOption {
  return {
    id,
    label: id,
    note: "",
    provider,
    vendor: provider,
    credentialType: `${provider}Api`,
    configured,
  };
}

// Purpose invariants — a typo here would ship a purpose with no prompt.
{
  const purposeIds = new Set(ONE_PURPOSE_PURPOSES.map((purpose) => purpose.id));
  eq(purposeIds.size, ONE_PURPOSE_PURPOSES.length, "duplicate purpose id");
  assert(purposeIds.has(DEFAULT_ONE_PURPOSE_ID), "default purpose must exist");
  for (const purpose of ONE_PURPOSE_PURPOSES) {
    assert(purpose.systemPrompt.trim().length > 0, `${purpose.id} has no prompt`);
    assert(purpose.hint.trim().length > 0, `${purpose.id} has no hint`);
  }
}

// This purpose should stay available as a general explanation aid, independent
// of the email and rewrite flows above.
{
  const explain = findPurpose("explain-like-im-12");
  eq(explain.label, "Explain it like I'm 12", "the explanation purpose exists");
  assert(explain.systemPrompt.includes("12-year-old"), "the explanation prompt sets its audience");
}

// The email purpose is the one with a shape the reader depends on: a subject
// line they can paste separately. An edit that drops it should fail here.
{
  const email = findPurpose("new-email");
  eq(email.id, "new-email", "the email purpose exists");
  assert(
    email.systemPrompt.includes("Subject:"),
    "the email prompt must still ask for a subject line",
  );
}

// An unknown purpose falls back; the model id is the host's to validate.
{
  const settings = normalizeOnePurposeSettings({ purposeId: "nope", model: "  gpt-9  " });
  eq(settings.purposeId, DEFAULT_ONE_PURPOSE_ID, "unknown purpose falls back");
  eq(settings.model, "gpt-9", "model id is kept, only trimmed");
  deepEq(settings.prompts, {}, "no prompts by default");
  eq(settings.promptCollapsed, true, "missing prompt state defaults to collapsed");
}

// A custom template carries exactly the user-authored title, description and
// system prompt, then remains selectable after settings were persisted.
{
  const custom = createCustomPurposeTemplate(
    {
      title: "Summarize meeting",
      description: "Turns rough notes into decisions and actions.",
      systemPrompt: "Summarize the notes as decisions and action items.",
    },
    "custom-meeting-summary",
  );
  if (!custom) throw new Error("valid custom template is created");
  deepEq(
    normalizeCustomPurposeTemplates({ templates: [custom, { id: "bad", title: "x" }] }),
    [custom],
    "only complete custom templates are kept",
  );

  const settings = normalizeOnePurposeSettings({ purposeId: custom.id });
  eq(settings.purposeId, custom.id, "custom purpose survives persistence");
  eq(resolveSystemPrompt(settings, [custom]), custom.systemPrompt, "custom prompt is used");
  assert(isPromptDefault(settings, [custom]), "new custom template starts at its default prompt");
  deepEq(
    buildApiMessages(settings, "Raw notes", [custom]),
    [
      { role: "system", content: custom.systemPrompt },
      { role: "user", content: "Raw notes" },
    ],
    "custom prompt reaches the API",
  );

}

// Built-in templates can be hidden just like custom ones are removed. Invalid
// ids cannot make an unrelated purpose disappear, and one visible default remains.
{
  deepEq(
    normalizeHiddenPurposeIds(["translate", "translate", "custom-nope", "missing"]),
    ["translate"],
    "only shipped template ids can be hidden",
  );
  const visible = purposesForTemplates([], ["translate"]);
  assert(!visible.some((purpose) => purpose.id === "translate"), "hidden purpose leaves picker");
  eq(findPurpose("translate", [], ["translate"]).id, "correct-grammar", "hidden active purpose falls back");
}

// The UI state is stored with the instance, not reset whenever it remounts.
{
  const settings = normalizeOnePurposeSettings({ promptCollapsed: true });
  eq(settings.promptCollapsed, true, "prompt collapse state survives persistence");
}

// Usable models first, host order preserved inside each half.
{
  const catalog = [
    model("locked-a", "openai", false),
    model("usable-a", "anthropic", true),
    model("locked-b", "openai", false),
    model("usable-b", "anthropic", true),
  ];
  deepEq(
    sortModels(catalog).map((entry) => entry.id),
    ["usable-a", "usable-b", "locked-a", "locked-b"],
    "configured models come first, order otherwise unchanged",
  );
}

// The selection prefers what still works over what was chosen.
{
  const catalog = [model("usable", "anthropic", true), model("locked", "openai", false)];
  eq(defaultModel(catalog, "usable"), "usable", "a working choice is kept");
  eq(defaultModel(catalog, "locked"), "usable", "a choice without a key is replaced");
  eq(defaultModel(catalog, "retired"), "usable", "a model that no longer exists is replaced");
  eq(defaultModel([], "usable"), "", "an empty catalog selects nothing");
  // With no key anywhere, the first entry is still selected so the banner can
  // name the provider the user would most likely want.
  eq(
    defaultModel([model("locked", "openai", false)]),
    "locked",
    "nothing configured still selects the first model",
  );
}

// Provider ids are the host's; the labels are ours.
{
  eq(providerLabel("anthropic"), "Anthropic", "known provider is labelled");
  eq(providerLabel("cloudflare"), "Cloudflare Workers AI", "known provider is labelled");
  eq(providerLabel("brand-new"), "brand-new", "an unknown provider shows its id");
}

// Prices are metadata from the host catalog, not a second local model list.
{
  eq(
    formatModelPricing({
      ...model("priced", "openai", true),
      pricing: { currency: "USD", unitTokens: 1_000_000, input: 2, output: 12 },
    }),
    "$2 in · $12 out / M tokens",
    "model pricing is formatted compactly",
  );
  eq(formatModelPricing(model("unpriced", "openai", true)), null, "missing prices stay hidden");
}

// Size is clamped both ways.
{
  const settings = normalizeOnePurposeSettings({ width: 5000, height: 10 });
  eq(settings.width, MAX_ONE_PURPOSE_WIDTH, "width clamped down");
  eq(settings.height, MIN_ONE_PURPOSE_HEIGHT, "height clamped up");
}

// Overrides for retired purposes are dropped, current ones survive.
{
  const settings = normalizeOnePurposeSettings({
    prompts: { translate: "Nur Bairisch.", "retired-purpose": "x", "correct-grammar": "  " },
  });
  deepEq(settings.prompts, { translate: "Nur Bairisch." }, "only live, non-blank overrides kept");
}

// The prompt actually sent is the override, and reverts when it is removed.
{
  const base = normalizeOnePurposeSettings({ purposeId: "translate" });
  eq(resolveSystemPrompt(base), findPurpose("translate").systemPrompt, "default prompt used");
  assert(isPromptDefault(base), "unedited prompt reports as default");

  const edited = normalizeOnePurposeSettings({
    ...base,
    prompts: { translate: "Nur Bairisch." },
  });
  eq(resolveSystemPrompt(edited), "Nur Bairisch.", "override wins");
  assert(!isPromptDefault(edited), "edited prompt reports as edited");

  // A per-purpose edit must not leak into the other purpose.
  const switched = normalizeOnePurposeSettings({ ...edited, purposeId: "correct-grammar" });
  eq(
    resolveSystemPrompt(switched),
    findPurpose("correct-grammar").systemPrompt,
    "other purpose keeps its default",
  );
  // …and the edit is still there on the way back.
  eq(
    resolveSystemPrompt(normalizeOnePurposeSettings({ ...switched, purposeId: "translate" })),
    "Nur Bairisch.",
    "override survives a purpose round-trip",
  );
}

// One purpose, one shot: system + exactly one user turn, no history.
{
  const settings = normalizeOnePurposeSettings({
    purposeId: "translate",
    prompts: { translate: "Nur Bairisch." },
  });
  deepEq(
    buildApiMessages(settings, "Hello"),
    [
      { role: "system", content: "Nur Bairisch." },
      { role: "user", content: "Hello" },
    ],
    "messages are system + one user turn",
  );
}

// Redaction happens on the way out, and the real value must not be in what
// leaves the machine. This is the check the whole feature rests on.
{
  const settings = normalizeOnePurposeSettings({
    purposeId: "answer-email",
    anonymized: [{ id: 1, term: "Max Müller", all: true, ordinal: 0 }],
  });
  const messages = buildApiMessages(settings, "Hallo Max Müller, danke für Ihre Mail.");
  const wire = JSON.stringify(messages);
  assert(!wire.includes("Max Müller"), "the marked value must not reach the provider");
  assert(wire.includes("[ANONYMIZED_1]"), "the placeholder takes its place");
  assert(
    messages[0].role === "system" && messages[0].content.includes("[ANONYMIZED_1]"),
    "the system prompt tells the model to keep placeholders intact",
  );
}

// With nothing marked the outgoing text and prompt are untouched — no stray
// instruction about placeholders that do not exist.
{
  const settings = normalizeOnePurposeSettings({ purposeId: "translate" });
  const messages = buildApiMessages(settings, "Hallo Max");
  eq(messages[1].content, "Hallo Max", "unmarked text is sent as typed");
  assert(
    !messages[0].content.includes("ANONYMIZED"),
    "no placeholder instruction when nothing is marked",
  );
}

// Marks describe the text; a duplicate starts with neither.
// Duplicate keeps the setup, drops the text.
{
  const source = normalizeOnePurposeSettings({
    purposeId: "correct-grammar",
    model: "claude-sonnet-5",
    prompts: { "correct-grammar": "Be strict." },
    input: "teh",
    output: "the",
    anonymized: [{ id: 1, term: "teh", all: true, ordinal: 0 }],
  });
  const copy = settingsForDuplicate(source);
  deepEq(copy.anonymized, [], "duplicate clears the marks with the text");
  eq(copy.purposeId, "correct-grammar", "duplicate keeps purpose");
  eq(copy.model, "claude-sonnet-5", "duplicate keeps model");
  deepEq(copy.prompts, { "correct-grammar": "Be strict." }, "duplicate keeps prompt edits");
  eq(copy.input, "", "duplicate clears input");
  eq(copy.output, "", "duplicate clears output");
}

console.log("onePurposeLlmLogic.assert.ts: OK");
