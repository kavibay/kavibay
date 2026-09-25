/**
 * One-purpose LLM: purposes, per-instance settings, model-list helpers.
 *
 * A purpose is a named system prompt with a default text. The user may edit
 * that text; the edit is stored per purpose, so switching back and forth never
 * loses it.
 *
 * The model list is not here — it comes from the host's shared catalog
 * (`llm_models`), the same one the Widget Wizard reads. A second list in the
 * frontend would drift from it, and a key the user entered once would work in
 * one widget and fail in the other.
 */

import {
  ANONYMIZE_SYSTEM_NOTE,
  type AnonymizedTerm,
  normalizeTerms,
  redactText,
} from "./anonymizeLogic";
import type { LlmChatMessage, LlmImage } from "@sdk/contract/sdk";

export const ONE_PURPOSE_LLM_ID = "one-purpose-llm";

export const ONE_PURPOSE_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const MAX_ONE_PURPOSE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ONE_PURPOSE_ATTACHMENTS = 6;

export function attachmentProblem(
  file: { type: string; size: number },
  alreadyAttached: number,
): string | null {
  if (alreadyAttached >= MAX_ONE_PURPOSE_ATTACHMENTS) {
    return `At most ${MAX_ONE_PURPOSE_ATTACHMENTS} images per message.`;
  }
  if (!(ONE_PURPOSE_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
    return `${file.type || "That file"} is not an image the model accepts.`;
  }
  if (file.size > MAX_ONE_PURPOSE_ATTACHMENT_BYTES) {
    return "That image is larger than 4 MB.";
  }
  return null;
}

export function base64FromDataUrl(dataUrl: string): string {
  const marker = "base64,";
  const index = dataUrl.indexOf(marker);
  return index >= 0 ? dataUrl.slice(index + marker.length) : dataUrl;
}

/** One model as `llm_models` reports it. */
export interface LlmModelOption {
  id: string;
  label: string;
  /** One line on what it is for. */
  note: string;
  /** `anthropic` | `openai` | `cloudflare`. */
  provider: string;
  /** Who built the model — Cloudflare serves other people's open models. */
  vendor: string;
  /** Token price metadata from the host's JSON catalog. */
  pricing?: {
    currency: string;
    unitTokens: number;
    input: number;
    output: number;
  };
  credentialType: string;
  /** A key for this model's provider is stored and connected. */
  configured: boolean;
}

/** Provider display names, for the "add a key" hint and the picker's groups. */
export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  cloudflare: "Cloudflare Workers AI",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** Compact input/output pricing for a model-picker row. */
export function formatModelPricing(model: LlmModelOption): string | null {
  const pricing = model.pricing;
  if (
    !pricing ||
    pricing.currency !== "USD" ||
    pricing.unitTokens !== 1_000_000 ||
    !Number.isFinite(pricing.input) ||
    !Number.isFinite(pricing.output)
  ) {
    return null;
  }
  const format = (value: number) =>
    value >= 1 ? value.toFixed(2).replace(/\.?0+$/, "") : String(value);
  return `$${format(pricing.input)} in · $${format(pricing.output)} out / M tokens`;
}

/**
 * Models you can actually use first, the rest after.
 *
 * Order within each group is the host's, which is capability order — so the
 * list still reads best-first, it just stops opening with entries that cannot
 * run. A stable sort keeps that intact.
 */
export function sortModels(models: LlmModelOption[]): LlmModelOption[] {
  return [
    ...models.filter((model) => model.configured),
    ...models.filter((model) => !model.configured),
  ];
}

/**
 * Which model to select: the one already chosen as long as it works, otherwise
 * the best one with a key. Only when nothing is configured does an unusable
 * model get selected — and then it is the first, so the "no key" hint names the
 * provider the user would most likely want.
 */
export function defaultModel(models: LlmModelOption[], current?: string): string {
  if (current && models.some((model) => model.id === current && model.configured)) {
    return current;
  }
  return models.find((model) => model.configured)?.id ?? models[0]?.id ?? "";
}

/** One named transform: a system prompt plus the UI copy around it. */
export interface PurposeDef {
  id: string;
  label: string;
  /** One line under the picker explaining what the purpose does. */
  hint: string;
  inputPlaceholder: string;
  /** Default system prompt; the user may override it per purpose. */
  systemPrompt: string;
}

/** A user-created purpose. The input stays deliberately generic; creation only
 * asks for the three things that define a reusable LLM template. */
export interface CustomPurposeTemplate {
  id: string;
  title: string;
  description: string;
  systemPrompt: string;
}

export interface CustomPurposeTemplateInput {
  title: string;
  description: string;
  systemPrompt: string;
}

const CUSTOM_PURPOSE_ID_PREFIX = "custom-";
const MAX_CUSTOM_PURPOSES = 50;
const MAX_CUSTOM_TITLE_LENGTH = 80;
const MAX_CUSTOM_DESCRIPTION_LENGTH = 180;
const MAX_CUSTOM_PROMPT_LENGTH = 12_000;

/**
 * Adding a purpose is one entry here — the widget renders whatever this holds.
 * Every prompt insists on output-only so the result can be pasted directly.
 */
export const ONE_PURPOSE_PURPOSES: PurposeDef[] = [
  {
    id: "translate",
    label: "Translate",
    hint: "German ↔ English, output only.",
    inputPlaceholder: "Text to translate…",
    systemPrompt: `You are a translator between German and English.

Detect the language of the user's text. If it is German, translate it to English. Otherwise, translate it to German.

Reply with ONLY the translation. No quotes, no explanations, no notes about the source language. Keep the tone, formatting and line breaks of the original.`,
  },
  {
    id: "correct-grammar",
    label: "Correct grammar",
    hint: "Fixes grammar and spelling, keeps the wording.",
    inputPlaceholder: "Text to check…",
    systemPrompt: `You are a grammar and spelling corrector.

Correct grammar, spelling and punctuation in the user's text. Keep the original language, wording, tone and formatting — do not rewrite, shorten, or improve the style.

Reply with ONLY the corrected text. If the text was already correct, reply with the text unchanged.`,
  },
  {
    id: "new-email",
    label: "New email",
    hint: "Turns notes into an email with a subject.",
    inputPlaceholder: "What the email should say…",
    systemPrompt: `You write emails from rough notes.

Turn the user's text into a complete email: a subject line and a body. Keep the user's language, intent and any facts they gave — do not invent details, names, dates or numbers they did not mention.

Reply in exactly this format and nothing else:

Subject: <one line>

<email body>

Write the body as finished prose with paragraphs, no bullet points unless the notes are clearly a list. Use a neutral, professional tone. Leave the greeting and sign-off generic if the notes do not say who it is to or from.`,
  },
  {
    id: "answer-email",
    label: "Write a reply",
    hint: "Drafts a reply to a pasted message.",
    inputPlaceholder: "Paste the message you received…",
    systemPrompt: `You draft replies to messages.

The user pastes a message they received. Answer the newest message in it — ignore quoted history, signatures and disclaimers except as context. Reply in the language the message is written in, and match how formal it is.

Address every question and request the message actually makes. Where it asks something only the user can decide — a date, a price, a yes or no — do NOT invent an answer: write a short placeholder in square brackets, like [confirm the date], so it is obvious what still has to be filled in.

Reply with ONLY the body of the reply: no subject line, no "Here is your reply", no explanation of what you wrote.`,
  },
  {
    id: "explain-like-im-12",
    label: "Explain it like I'm 12",
    hint: "Makes difficult ideas clear without talking down.",
    inputPlaceholder: "What should be explained?…",
    systemPrompt: `You explain things clearly to a curious 12-year-old.

Use everyday language, short sentences and a concrete example when it helps. Explain unfamiliar terms before using them. Keep the important nuance, but skip unnecessary jargon and detail.

Answer the user's question directly. Do not mention this instruction or the user's age.`,
  },
];

export const DEFAULT_ONE_PURPOSE_ID = ONE_PURPOSE_PURPOSES[0].id;

/** Custom templates use the same picker shape as shipped purposes. */
export function customPurposeAsDef(template: CustomPurposeTemplate): PurposeDef {
  return {
    id: template.id,
    label: template.title,
    hint: template.description,
    inputPlaceholder: "What should it do?…",
    systemPrompt: template.systemPrompt,
  };
}

/** Shipped purposes always lead; custom ones follow in the order the user created them. */
export function purposesForTemplates(
  customTemplates: CustomPurposeTemplate[],
  hiddenTemplateIds: string[] = [],
): PurposeDef[] {
  const hidden = new Set(hiddenTemplateIds);
  return [
    ...ONE_PURPOSE_PURPOSES.filter((purpose) => !hidden.has(purpose.id)),
    ...customTemplates.map(customPurposeAsDef),
  ];
}

function isCustomPurposeId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(CUSTOM_PURPOSE_ID_PREFIX);
}

/** Strip persisted values down to templates the picker can safely render. */
export function normalizeCustomPurposeTemplates(raw: unknown): CustomPurposeTemplate[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && "templates" in raw
      ? (raw as { templates?: unknown }).templates
      : [];
  if (!Array.isArray(source)) return [];

  const seen = new Set<string>();
  const out: CustomPurposeTemplate[] = [];
  for (const value of source) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const systemPrompt = typeof item.systemPrompt === "string" ? item.systemPrompt.trim() : "";
    if (
      !isCustomPurposeId(id) ||
      seen.has(id) ||
      !title ||
      !systemPrompt ||
      title.length > MAX_CUSTOM_TITLE_LENGTH ||
      description.length > MAX_CUSTOM_DESCRIPTION_LENGTH ||
      systemPrompt.length > MAX_CUSTOM_PROMPT_LENGTH
    ) {
      continue;
    }
    seen.add(id);
    out.push({ id, title, description, systemPrompt });
    if (out.length >= MAX_CUSTOM_PURPOSES) break;
  }
  return out;
}

/** Validate one draft before adding it to the shared custom-template catalog. */
export function createCustomPurposeTemplate(
  input: CustomPurposeTemplateInput,
  id: string,
): CustomPurposeTemplate | null {
  return normalizeCustomPurposeTemplates([{ id, ...input }])[0] ?? null;
}

/** Only shipped templates are hidden. Custom templates are removed outright. */
export function normalizeHiddenPurposeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const shipped = new Set(ONE_PURPOSE_PURPOSES.map((purpose) => purpose.id));
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && shipped.has(id)))];
}

export const DEFAULT_ONE_PURPOSE_WIDTH = 340;
export const DEFAULT_ONE_PURPOSE_HEIGHT = 420;
export const MIN_ONE_PURPOSE_WIDTH = 260;
export const MIN_ONE_PURPOSE_HEIGHT = 260;
export const MAX_ONE_PURPOSE_WIDTH = 800;
export const MAX_ONE_PURPOSE_HEIGHT = 800;

export interface OnePurposeLlmSettings {
  /** Selected purpose id. */
  purposeId: string;
  /** Edited system prompts, keyed by purpose id. Missing = purpose default. */
  prompts: Record<string, string>;
  /** Chosen model id, or "" until the catalog has been read once. */
  model: string;
  /** Last input text (kept so a reopened widget is where you left it). */
  input: string;
  /** Optional context sent with the input. */
  context: string;
  /** Images attached to the next run. */
  attachments: LlmImage[];
  /** Relative heights of the context, prompt and result areas. */
  contextFlex: number;
  promptFlex: number;
  resultFlex: number;
  /** Values redacted before the input leaves the machine. */
  anonymized: AnonymizedTerm[];
  /** Last result. */
  output: string;
  /** Widget content width in CSS pixels. */
  width: number;
  /** Widget content height in CSS pixels. */
  height: number;
  /** Whether the supporting system-prompt column is currently hidden. */
  promptCollapsed: boolean;
}

export const DEFAULT_ONE_PURPOSE_SETTINGS: OnePurposeLlmSettings = {
  purposeId: DEFAULT_ONE_PURPOSE_ID,
  prompts: {},
  model: "",
  input: "",
  context: "",
  attachments: [],
  contextFlex: 0.2,
  promptFlex: 1,
  resultFlex: 1,
  anonymized: [],
  output: "",
  width: DEFAULT_ONE_PURPOSE_WIDTH,
  height: DEFAULT_ONE_PURPOSE_HEIGHT,
  promptCollapsed: true,
};

/** Resolve a purpose, falling back to the first one for unknown ids. */
export function findPurpose(
  purposeId: string,
  customTemplates: CustomPurposeTemplate[] = [],
  hiddenTemplateIds: string[] = [],
): PurposeDef {
  return (
    purposesForTemplates(customTemplates, hiddenTemplateIds).find(
      (purpose) => purpose.id === purposeId,
    ) ??
    purposesForTemplates(customTemplates, hiddenTemplateIds)[0] ??
    ONE_PURPOSE_PURPOSES[0]
  );
}

/** The prompt actually sent: the user's edit, else the purpose default. */
export function resolveSystemPrompt(
  settings: OnePurposeLlmSettings,
  customTemplates: CustomPurposeTemplate[] = [],
  hiddenTemplateIds: string[] = [],
): string {
  const override = settings.prompts[settings.purposeId];
  if (typeof override === "string" && override.trim()) return override;
  return findPurpose(settings.purposeId, customTemplates, hiddenTemplateIds).systemPrompt;
}

/** True when the active purpose still uses its shipped prompt. */
export function isPromptDefault(
  settings: OnePurposeLlmSettings,
  customTemplates: CustomPurposeTemplate[] = [],
  hiddenTemplateIds: string[] = [],
): boolean {
  return (
    resolveSystemPrompt(settings, customTemplates, hiddenTemplateIds) ===
    findPurpose(settings.purposeId, customTemplates, hiddenTemplateIds).systemPrompt
  );
}

/** Clamp width/height into allowed bounds. */
export function clampOnePurposeSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const w = Number.isFinite(width) ? width : DEFAULT_ONE_PURPOSE_WIDTH;
  const h = Number.isFinite(height) ? height : DEFAULT_ONE_PURPOSE_HEIGHT;
  return {
    width: Math.min(MAX_ONE_PURPOSE_WIDTH, Math.max(MIN_ONE_PURPOSE_WIDTH, Math.round(w))),
    height: Math.min(MAX_ONE_PURPOSE_HEIGHT, Math.max(MIN_ONE_PURPOSE_HEIGHT, Math.round(h))),
  };
}

/** Keep only string overrides for shipped or well-formed custom purpose ids. */
function normalizePrompts(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(source)) {
    const known = ONE_PURPOSE_PURPOSES.some((purpose) => purpose.id === id);
    if ((known || isCustomPurposeId(id)) && typeof value === "string" && value.trim()) {
      out[id] = value;
    }
  }
  return out;
}

function normalizeAttachments(raw: unknown): LlmImage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    .map((value) => ({
      mediaType: typeof value.mediaType === "string" ? value.mediaType : "",
      data: typeof value.data === "string" ? value.data : "",
    }))
    .filter(
      (image) =>
        (ONE_PURPOSE_ATTACHMENT_TYPES as readonly string[]).includes(image.mediaType) &&
        image.data.length > 0,
    )
    .slice(0, MAX_ONE_PURPOSE_ATTACHMENTS);
}

/**
 * Normalize raw settings from `ctx.data` or partial updates.
 *
 * The model id is kept as stored rather than checked against a list: the list
 * lives in the host now, and a model that was retired between two runs is
 * caught there with a message that names it.
 */
export function normalizeOnePurposeSettings(raw: unknown): OnePurposeLlmSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const flex = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(10, Math.max(0.2, value))
      : fallback;
  const compactLegacyLayout =
    o.contextFlex === 0.7 && o.promptFlex === 1 && o.resultFlex === 1;
  const purposeId =
    typeof o.purposeId === "string" &&
    (findPurpose(o.purposeId).id === o.purposeId || isCustomPurposeId(o.purposeId))
      ? o.purposeId
      : DEFAULT_ONE_PURPOSE_ID;
  const size = clampOnePurposeSize(
    typeof o.width === "number" ? o.width : DEFAULT_ONE_PURPOSE_WIDTH,
    typeof o.height === "number" ? o.height : DEFAULT_ONE_PURPOSE_HEIGHT,
  );
  return {
    purposeId,
    prompts: normalizePrompts(o.prompts),
    model: typeof o.model === "string" ? o.model.trim() : "",
    input: typeof o.input === "string" ? o.input : "",
    context: typeof o.context === "string" ? o.context : "",
    attachments: normalizeAttachments(o.attachments),
    contextFlex: compactLegacyLayout
      ? DEFAULT_ONE_PURPOSE_SETTINGS.contextFlex
      : flex(o.contextFlex, DEFAULT_ONE_PURPOSE_SETTINGS.contextFlex),
    promptFlex: flex(o.promptFlex, DEFAULT_ONE_PURPOSE_SETTINGS.promptFlex),
    resultFlex: flex(o.resultFlex, DEFAULT_ONE_PURPOSE_SETTINGS.resultFlex),
    anonymized: normalizeTerms(o.anonymized),
    output: typeof o.output === "string" ? o.output : "",
    // Existing instances without this newer field should get the new compact default too.
    promptCollapsed: o.promptCollapsed !== false,
    ...size,
  };
}

/**
 * Duplicate keeps purpose, prompts, model and size; the text and anything
 * marked in it start empty — the marks describe text that is no longer there.
 */
export function settingsForDuplicate(source: OnePurposeLlmSettings): OnePurposeLlmSettings {
  const n = normalizeOnePurposeSettings(source);
  return { ...n, input: "", context: "", attachments: [], anonymized: [], output: "" };
}

/**
 * Build the API `messages` array: the purpose prompt plus one user turn.
 * One purpose, one shot — there is deliberately no chat history.
 *
 * This is the last point before the text leaves the machine, so redaction
 * happens here rather than at the call site: a caller that forgot would send
 * the real values.
 */
export function buildApiMessages(
  settings: OnePurposeLlmSettings,
  userText: string,
  customTemplates: CustomPurposeTemplate[] = [],
  hiddenTemplateIds: string[] = [],
): LlmChatMessage[] {
  const marks = settings.anonymized;
  const out: LlmChatMessage[] = [];
  let system = resolveSystemPrompt(settings, customTemplates, hiddenTemplateIds).trim();
  if (marks.length) {
    // Without this the model happily translates or "corrects" a placeholder,
    // and the answer can no longer be mapped back.
    system = system ? `${system}\n\n${ANONYMIZE_SYSTEM_NOTE}` : ANONYMIZE_SYSTEM_NOTE;
  }
  if (system) out.push({ role: "system", content: system });
  const context = redactText(settings.context.trim(), marks);
  const input = redactText(userText, marks);
  out.push({
    role: "user",
    content: context ? `Context:\n${context}\n\nInput:\n${input}` : input,
    ...(settings.attachments.length
      ? { images: settings.attachments.map((image) => ({ ...image })) }
      : {}),
  });
  return out;
}
