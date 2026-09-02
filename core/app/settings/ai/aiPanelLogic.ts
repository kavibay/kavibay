/**
 * Pure logic for the AI panel's provider tabs.
 *
 * Kept free of Vue/Tauri so it can be asserted with `npx tsx` (repo testing
 * convention). Only the tab order and the short tab titles live here — which
 * credential a provider needs and which models it serves are both read off the
 * catalog, so adding a model in Rust needs no edit on this side.
 */
import type { LlmModelOption, LlmProviderId } from "./aiApi";

/** One tab: a provider, under the name the provider calls itself. */
export interface AiProviderTab {
  id: LlmProviderId;
  /** Short enough for a tab strip — the credential card repeats the long name. */
  label: string;
}

/**
 * Tab order. Fixed rather than derived from the catalog: the catalog is ordered
 * by model strength, and a tab strip that reshuffles when a model is added is
 * a tab strip the user has to re-read every time.
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
 * row here and Ctrl+Alt+Q sends to it, so a model without a key would turn a
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

/** Applies one toggle to a loaded catalog (immutable) so the UI need not refetch. */
export function withModelEnabled(
  models: readonly LlmModelOption[],
  modelId: string,
  enabled: boolean,
): LlmModelOption[] {
  return models.map((model) => (model.id === modelId ? { ...model, enabled } : model));
}
