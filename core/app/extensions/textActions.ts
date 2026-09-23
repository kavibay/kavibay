/**
 * Selection quick actions, discovered from manifests only.
 *
 * Deliberately *not* built on `loadExtensions.ts`: that glob is eager and pulls
 * every extension's `index.ts` — and with it every widget component, composable
 * and module-level timer — into whatever bundle imports it. The quick-action
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
type TextActionModule = Pick<
  ExtensionModule,
  "textActions" | "dynamicTextActionHandler" | "dynamicTextActions" | "isTextActionAvailable"
>;

const extensionModules = import.meta.glob("/extensions/*/index.ts", {
  import: "default",
}) as Record<string, () => Promise<TextActionModule>>;
/** Contract extensions keep headless selection handlers out of `index.ts`. */
const contractTextActionModules = import.meta.glob("/extensions/*/textActions.ts", {
  import: "default",
}) as Record<string, () => Promise<TextActionModule>>;

const textActions: ResolvedTextAction[] = sortTextActions(
  Object.entries(manifestModules).flatMap(([path, manifest]) => {
    const folder = folderFromManifestPath(path);
    if (!folder) return [];
    return normalizeTextActions(folder, manifest);
  }),
);

/** Folders whose manifest explicitly opts in to runtime-created menu rows. */
const dynamicTextActionFolders = Object.entries(manifestModules).flatMap(([path, manifest]) => {
  const folder = folderFromManifestPath(path);
  if (!folder || !manifest || typeof manifest !== "object") return [];
  return (manifest as { dynamicTextActions?: unknown }).dynamicTextActions === true ? [folder] : [];
});

/** Every quick action, including user-defined rows from opted-in extensions. */
export async function listTextActions(): Promise<ResolvedTextAction[]> {
  const dynamic = await Promise.all(
    dynamicTextActionFolders.map(async (folder) => {
      try {
        const mod = await extensionModules[`/extensions/${folder}/index.ts`]?.();
        const rows = mod?.dynamicTextActions?.() ?? [];
        return {
          folder,
          rows: normalizeTextActions(folder, { textActions: rows }),
          isAvailable: mod?.isTextActionAvailable,
        };
      } catch (error) {
        console.warn(`[kavibay] Could not load dynamic text actions for "${folder}":`, error);
        return { folder, rows: [], isAvailable: undefined };
      }
    }),
  );
  const availability = new Map(
    dynamic.map(({ folder, isAvailable }) => [folder, isAvailable] as const),
  );
  const seen = new Set(textActions.map((action) => `${action.extensionId}/${action.actionId}`));
  return sortTextActions([
    ...textActions,
    ...dynamic.flatMap(({ rows }) => rows).filter((action) => {
      const key = `${action.extensionId}/${action.actionId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ]).filter((action) => availability.get(action.extensionId)?.(action.actionId) !== false);
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
  const load =
    contractTextActionModules[`/extensions/${action.extensionId}/textActions.ts`] ??
    extensionModules[`/extensions/${action.extensionId}/index.ts`];
  if (!load) {
    throw new Error(`Extension "${action.extensionId}" has no text-action handler`);
  }
  const mod = await load();
  const handler = mod?.textActions?.[action.actionId];
  const isStatic = typeof handler === "function";
  const ctx = { text, signal, onChunk, llm: quickActionLlm };
  const result = isStatic
    ? await handler(ctx)
    : await mod?.dynamicTextActionHandler?.(action.actionId, ctx);
  if (typeof result !== "string" || !result.trim()) {
    throw new Error(
      isStatic
        ? "The model returned nothing"
        : mod?.dynamicTextActionHandler
          ? "This template is no longer available"
          : `Extension "${action.extensionId}" declares "${action.actionId}" but has no handler`,
    );
  }
  return result;
}
