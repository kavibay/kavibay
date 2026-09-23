import { invoke } from "@tauri-apps/api/core";
import { ref } from "vue";

export interface ConnectionBinding {
  typeId: string;
  credentialId: string | null;
  available: boolean;
  revision: number;
}

/**
 * The consumer id for everything that runs outside a widget instance — the
 * command palette, quick AI actions, the Wizard. Mirrors `bindings::HOST_OWNER`
 * in Rust. A widget instance uses `widgetConnectionOwner` instead.
 */
export const HOST_OWNER = "host:default";

export const connectionEpoch = ref(0);
const pendingCopies = new Map<string, Promise<void>>();
export async function awaitConnectionCopy(instanceId: string): Promise<void> {
  await pendingCopies.get(instanceId);
}
export const widgetConnectionOwner = (instanceId: string) => `widget:${instanceId}`;
export function connectionsChanged(): void { connectionEpoch.value++; }

export function connectionSelection(owner: string, typeId: string): Promise<ConnectionBinding> {
  return invoke("connections_selection", { owner, typeId });
}

export async function selectConnection(owner: string, typeId: string, credentialId: string): Promise<void> {
  await invoke("connections_select", { owner, typeId, credentialId });
  connectionsChanged();
}

export function copyConnections(source: string, target: string): Promise<void> {
  const pending = invoke<void>("connections_copy", { source: widgetConnectionOwner(source), target: widgetConnectionOwner(target) });
  pendingCopies.set(target, pending);
  void pending.then(() => pendingCopies.delete(target)).catch(() => {});
  return pending;
}

export async function disposeConnections(instanceId: string): Promise<void> {
  await invoke("connections_dispose", { owner: widgetConnectionOwner(instanceId) });
}

/**
 * Collect bindings whose widget instance is gone.
 *
 * Removing a card already disposes its binding, so this only picks up what
 * earlier sessions left behind. Pass the *whole* catalog, every desk: a partial
 * list would read as "these instances are gone" and take live choices with it.
 * The backend prunes nothing at all for an empty list.
 */
export async function pruneConnections(instanceIds: readonly string[]): Promise<number> {
  return invoke<number>("connections_prune", {
    live: instanceIds.map(widgetConnectionOwner),
  });
}
