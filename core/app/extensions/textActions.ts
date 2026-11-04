/**
 * Selection quick actions, discovered from manifests only.
 *
 * Deliberately *not* built on `loadExtensions.ts`: that registry is eager and
 * pulls every extension definition — and with it composables and module-level
 * timers — into whatever bundle imports it. The quick-action
 * popup is a second, short-lived window that shows a five-row menu; booting the
 * whole extension catalog inside it would be both heavy and wrong (module state
 * would exist twice, once per webview).
 *
 * So: manifests eagerly (they are data), modules lazily (they are code). Only
 * the one extension whose row was picked is ever loaded.
 */
import type { ExtensionModule } from "@sdk/types";
import type { LlmCapability } from "@sdk/contract/sdk";
import { tauriWidgetCapabilityTransport } from "../extension-host/tauriWidgetCapabilityTransport";
import {
  folderFromManifestPath,
  normalizeTextActions,
  sortTextActions,
  type ResolvedTextAction,
} from "./textActionsLogic";

export type { ResolvedTextAction } from "./textActionsLogic";

const QUICK_ACTION_INSTANCE_ID = "quick-action";
const quickActionLlm: LlmCapability = {
  models: <T>() => tauriWidgetCapabilityTransport.llmModels() as Promise<T>,
  quickModel: <T>() => tauriWidgetCapabilityTransport.llmQuickModel() as Promise<T>,
  stream: (request, onEvent) =>
    tauriWidgetCapabilityTransport.llmStream(QUICK_ACTION_INSTANCE_ID, request, onEvent, "host:default"),
  cancel: (requestId) => tauriWidgetCapabilityTransport.llmCancel(requestId),
  // The quick-action popup is a second window; Settings lives in the main one.
  openSettings: () => {},
};

const manifestModules = import.meta.glob("/extensions/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/** Lazy: each value is an `() => import(...)` that Vite code-splits. */
type TextActionModule = Pick<ExtensionModule, "textActions">;

const textActionModules = import.meta.glob("/extensions/*/textActions.ts", {
  import: "default",
}) as Record<string, () => Promise<TextActionModule>>;

const textActions: ResolvedTextAction[] = sortTextActions(
  Object.entries(manifestModules).flatMap(([path, manifest]) => {
    const folder = folderFromManifestPath(path);
    if (!folder) return [];
    return normalizeTextActions(folder, manifest);
  }),
);

/** Every quick action the manifests declare. */
export async function listTextActions(): Promise<ResolvedTextAction[]> {
  return textActions;
}

/**
 * Load the owning extension and run one action.
 *
 * Rejects rather than returning a fallback string: the caller replaces the
 * user's selection with whatever comes back, so "something went wrong" must
 * never be a value that can be pasted.
 */
export async function runTextAction(
  action: ResolvedTextAction,
  text: string,
  signal: AbortSignal,
  onChunk?: (text: string) => void,
): Promise<string> {
  const load = textActionModules[`/extensions/${action.extensionId}/textActions.ts`];
  if (!load) {
    throw new Error(`Extension "${action.extensionId}" has no text-action handler`);
  }
  const mod = await load();
  const handler = mod?.textActions?.[action.actionId];
  if (typeof handler !== "function") {
    throw new Error(`Extension "${action.extensionId}" declares "${action.actionId}" but has no handler`);
  }
  const result = await handler({ text, signal, onChunk, llm: quickActionLlm });
  if (typeof result !== "string" || !result.trim()) {
    throw new Error("The model returned nothing");
  }
  return result;
}
