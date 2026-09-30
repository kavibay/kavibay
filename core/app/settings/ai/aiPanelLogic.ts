/**
 * Pure logic for the AI panel's provider list (once tabs, hence the names).
 *
 * Kept free of Vue/Tauri so it can be asserted with `npx tsx` (repo testing
 * convention). Only the provider order and their names live here — which
 * credential a provider needs and which models it serves are both read off the
 * catalog, so adding a model in Rust needs no edit on this side.
 */
import type { LlmModelOption, LlmProviderId } from "./aiApi";

/** One provider row, under the name the provider calls itself. */
export interface AiProviderTab {
  id: LlmProviderId;
  /** Row title — the credential card repeats the long name. */
  label: string;
}

/**
 * Row order. Fixed rather than derived from the catalog: the catalog is ordered
 * by model strength, and a list that reshuffles when a model is added is a
 * list the user has to re-read every time.
 */
export const AI_PROVIDER_TABS: readonly AiProviderTab[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "cloudflare", label: "Cloudflare Workers AI" },
];

/** The catalog models one provider serves, in catalog order. */
export function modelsForProvider(
  models: readonly LlmModelOption[],
  provider: LlmProviderId,
): LlmModelOption[] {
  return models.filter((model) => model.provider === provider);
}

/**
 * Which credential type a provider's tab should edit, taken from its models.
 *
 * Derived instead of mapped by hand: the pairing already exists in
 * `LlmProvider::credential_type()`, and a second copy here would be the one
 * that goes stale.
 */
export function credentialTypeForProvider(
  models: readonly LlmModelOption[],
  provider: LlmProviderId,
): string | null {
  return modelsForProvider(models, provider)[0]?.credentialType ?? null;
}

/** "3 of 4 on" summary for a tab; used to spot a provider switched fully off. */
export function enabledSummary(
  models: readonly LlmModelOption[],
  provider: LlmProviderId,
): { enabled: number; total: number } {
  const forProvider = modelsForProvider(models, provider);
  return {
    enabled: forProvider.filter((model) => model.enabled).length,
    total: forProvider.length,
  };
}

/**
 * Which AI tab a deep-link should open.
 *
 * Accepts a catalog provider id (`anthropic`) or a credential type id
 * (`anthropicApi`) so callers can pass whichever they already have. An unknown
 * value is ignored — a stale link must not invent a tab.
 */
export function resolveAiProviderFocus(
  requested: string | null | undefined,
  models: readonly LlmModelOption[] = [],
): LlmProviderId | null {
  if (!requested) return null;
  if (AI_PROVIDER_TABS.some((tab) => tab.id === requested)) {
    return requested as LlmProviderId;
  }
  return models.find((model) => model.credentialType === requested)?.provider ?? null;
}

/**
 * The line under a provider's name in the list: how much of it is on once
 * connected (the row says "Connected" itself), and before that what connecting
 * would give you — read off the catalog, so it never names a model the app
 * does not offer.
 */
export function providerStatusLine(
  models: readonly LlmModelOption[],
  provider: LlmProviderId,
): string {
  if (providerHasKey(models, provider)) {
    const { enabled, total } = enabledSummary(models, provider);
    return `${enabled} of ${total} models on`;
  }
  const labels = modelsForProvider(models, provider).map((model) => model.label);
  const shown = labels.slice(0, 2).join(", ");
  return labels.length > 2 ? `${shown} and ${labels.length - 2} more` : shown;
}

/**
 * Whether this provider has a stored key.
 *
 * The model list is pointless without one: toggling rows cannot make a 401
 * go away. Every model of a provider shares the same credential, so any
 * `configured` row is enough.
 */
export function providerHasKey(
  models: readonly LlmModelOption[],
  provider: LlmProviderId,
): boolean {
  return modelsForProvider(models, provider).some((model) => model.configured);
}

/**
 * The models selectable for quick actions: switched on *and* keyed.
 *
 * Narrower than the switch list above on purpose. That list exists to show
 * everything, including what is unavailable; this one is a commitment — pick a
 * row here and Ctrl+Shift+Q sends to it, so a model without a key would turn a
 * setting into a 401 the popup has no room to explain.
 */
export function quickModelChoices(models: readonly LlmModelOption[]): LlmModelOption[] {
  return models.filter((model) => model.enabled && model.configured);
}

/**
 * What the picker should have selected.
 *
 * A stored model that has since been switched off or lost its key falls back to
 * "Automatic" — the same thing the backend resolves to, so the panel never
 * shows a choice that is no longer in effect.
 */
export function quickModelSelection(
  models: readonly LlmModelOption[],
  selected: string,
): string {
  return quickModelChoices(models).some((model) => model.id === selected) ? selected : "";
}

/** What shortcut capture needs from a `KeyboardEvent`. */
export interface ShortcutKey {
  /** What the layout produced — `"@"` for AltGr+Q on a German keyboard. */
  key: string;
  /** Which physical key — `"KeyQ"` for that same press. */
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** The character a physical key produces unmodified on a US layout. */
function plainCharacterFor(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return null;
}

/**
 * The character this combination would stop producing everywhere, or null.
 *
 * AltGr on Windows is Ctrl + Alt, and a globally registered `Ctrl+Alt+<key>`
 * takes the keypress before the layout turns it into a character — so binding
 * one costs the user that character in every application, with no error
 * anywhere to explain it.
 *
 * Which combinations that hits depends on the layout, so it is read off the
 * event rather than guessed from a list: `key` is what this keyboard produced,
 * `code` is the key that was pressed. They differ exactly when AltGr composed
 * something (`KeyQ` → `@`). On a US layout they never differ and Ctrl+Alt stays
 * available, which is the point of testing instead of banning.
 *
 * Only names what it can prove. A combination that produces a dead key reports
 * `Dead` rather than a character and is let through — rare enough that a wrong
 * refusal would cost more than the miss.
 */
export function altGrCharacter(event: ShortcutKey): string | null {
  if (!event.ctrlKey || !event.altKey || event.metaKey) return null;
  if (event.key.length !== 1) return null;
  const plain = plainCharacterFor(event.code);
  if (plain === null) return event.key;
  return event.key.toLowerCase() === plain ? null : event.key;
}

/**
 * The shortcut string for a captured keypress, or null when it is not one yet.
 *
 * Built from `code`, not `key`: the backend parses physical key names, and on a
 * German keyboard the same press reports `key: "@"` — a shortcut Tauri cannot
 * parse and nobody could press again on purpose.
 */
export function shortcutFromKey(event: ShortcutKey): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  const modifiers = [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
  ].filter(Boolean);
  if (modifiers.length === 0) return null;
  const key = event.code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace(/^Numpad/, "Num")
    .replace(" ", "Space");
  if (!key || key === "Unidentified") return null;
  return [...modifiers, key].join("+");
}

/** Applies one toggle to a loaded catalog (immutable) so the UI need not refetch. */
export function withModelEnabled(
  models: readonly LlmModelOption[],
  modelId: string,
  enabled: boolean,
): LlmModelOption[] {
  return models.map((model) => (model.id === modelId ? { ...model, enabled } : model));
}
