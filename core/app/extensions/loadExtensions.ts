import type { ExtensionActionContext, RegisteredExtension } from "@sdk/types";
import { extensionHostWidgets } from "../extension-host/cockpit";
import { copyConnections, disposeConnections } from "../settings/credentials/connections";
import { forgetWidgetChat } from "../host/widgetChatSessions";

/**
 * Every first-party extension, as the extension host contributes it
 * (`bundledExtensions.ts` discovers the folders). Adapted to
 * `RegisteredExtension` so nothing downstream — palette, catalog, layout,
 * hooks — needs to know about the contract, the same reason runtime packages
 * adapt to `HostExtensionRef` rather than getting their own branch in the host.
 */
const extensionRegistry: RegisteredExtension[] = extensionHostWidgets().sort((a, b) =>
  a.id.localeCompare(b.id),
);

/** Full catalog (sorted by id). */
export function listExtensions(): RegisteredExtension[] {
  return extensionRegistry;
}

/** Lookup by manifest id. */
export function getExtension(id: string): RegisteredExtension | undefined {
  return extensionRegistry.find((ext) => ext.id === id);
}

/**
 * Simple keyword search over name, id, keywords, and description.
 * Empty query returns the full list.
 */
export function searchExtensions(query: string): RegisteredExtension[] {
  const q = query.trim().toLowerCase();
  if (!q) return listExtensions();
  return extensionRegistry.filter((ext) => {
    const hay = [ext.id, ext.title, ext.description, ...ext.keywords]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Safe lifecycle call — one bad hook must not break the host. */
export function runExtensionHook(
  ext: RegisteredExtension | undefined,
  hook: "onCreate" | "onSuspend" | "onResume" | "onDispose",
  instanceId: string,
): void {
  if (hook === "onDispose") {
    void disposeConnections(instanceId).catch(console.error);
    forgetWidgetChat(instanceId);
  }
  if (!ext) return;
  const fn = ext[hook];
  if (!fn) return;
  try {
    fn(instanceId);
  } catch (err) {
    console.error(`[kavibay] Extension "${ext.id}" ${hook} failed:`, err);
  }
}

/**
 * Safe action call — returns false when the action is unknown or the handler
 * throws, so the palette can stay open instead of pretending it worked.
 */
export async function runExtensionAction(
  ext: RegisteredExtension | undefined,
  actionId: string,
  ctx: ExtensionActionContext,
): Promise<boolean> {
  const handler = ext?.actionHandlers[actionId];
  if (!handler) {
    console.warn(`[kavibay] Unknown action "${actionId}" on extension "${ext?.id ?? "?"}"`);
    return false;
  }
  try {
    await handler(ctx);
    return true;
  } catch (err) {
    console.error(`[kavibay] Extension "${ext!.id}" action "${actionId}" failed:`, err);
    return false;
  }
}

/** Safe onDuplicate lifecycle call. */
export async function runDuplicateHook(
  ext: RegisteredExtension | undefined,
  fromInstanceId: string,
  toInstanceId: string,
): Promise<void> {
  const copied = copyConnections(fromInstanceId, toInstanceId);
  if (!ext?.onDuplicate) { await copied; return; }
  try {
    ext.onDuplicate(fromInstanceId, toInstanceId);
  } catch (err) {
    console.error(`[kavibay] Extension "${ext.id}" onDuplicate failed:`, err);
  }
  await copied;
}
