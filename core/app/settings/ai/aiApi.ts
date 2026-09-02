/**
 * Typed wrappers around the LLM catalog commands used by Settings → AI.
 *
 * The model list itself lives in `src-tauri/src/llm/models.json` and is loaded
 * by Rust. It is never restated here: every LLM consumer reads the same data.
 */
import { invoke } from "@tauri-apps/api/core";

/** Who serves the model — and therefore which credential it needs. */
export type LlmProviderId = "anthropic" | "openai" | "cloudflare";

/** Token price metadata from the editable JSON catalog. */
export interface LlmPricing {
  currency: string;
  unitTokens: number;
  input: number;
  cachedInput?: number;
  output: number;
  note?: string;
  validUntil?: string;
}

/** One catalog model as `llm_catalog` reports it. */
export interface LlmModelOption {
  id: string;
  label: string;
  note: string;
  description: string;
  provider: LlmProviderId;
  /** Free-form builder/vendor id; Cloudflare serves other people's models. */
  vendor: string;
  context: { windowTokens: number; maxOutputTokens?: number };
  pricing: LlmPricing;
  capabilities: string[];
  sourceUrl: string;
  /** Credential type id this model's provider needs (matches the registry). */
  credentialType: string;
  /** A key for the provider is stored and connected. */
  configured: boolean;
  /** The user has this model switched on. */
  enabled: boolean;
}

/** Every catalog model, including the ones the user switched off. */
export function listLlmCatalog(): Promise<LlmModelOption[]> {
  return invoke<LlmModelOption[]>("llm_catalog");
}

/** Switches one model on or off for every widget at once. */
export function setLlmModelEnabled(modelId: string, enabled: boolean): Promise<void> {
  return invoke<void>("llm_model_set_enabled", { modelId, enabled });
}

/** Which model selection quick actions (Ctrl+Alt+Q) run on. */
export interface QuickActionModel {
  /** The user's choice; "" means "let the app pick". */
  selected: string;
  /** What that currently resolves to; "" when no provider is set up. */
  resolved: string;
}

export function getQuickActionModel(): Promise<QuickActionModel> {
  return invoke<QuickActionModel>("llm_quick_model");
}

/** Stores the quick-action model; "" returns to automatic selection. */
export function setQuickActionModel(modelId: string): Promise<void> {
  return invoke<void>("llm_quick_model_set", { modelId });
}

/** The global shortcut that opens selection quick actions. */
export function getQuickActionShortcut(): Promise<string> {
  return invoke<string>("quick_action_shortcut");
}

/** Replaces the live native shortcut after Windows accepts it. */
export function setQuickActionShortcut(shortcut: string): Promise<void> {
  return invoke<void>("quick_action_shortcut_set", { shortcut });
}

/** Pause/resume the active shortcut while Settings records its replacement. */
export function setQuickActionShortcutCapture(active: boolean): Promise<void> {
  return invoke<void>("quick_action_shortcut_capture", { active });
}

/** Manifest action keys hidden from the selection quick-action popup. */
export function getDisabledQuickActionTemplates(): Promise<string[]> {
  return invoke<string[]>("quick_action_disabled_templates");
}

export function setDisabledQuickActionTemplates(actionIds: string[]): Promise<void> {
  return invoke<void>("quick_action_disabled_templates_set", { actionIds });
}
