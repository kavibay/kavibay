import type { ExtensionId, ProviderId } from "@sdk/contract/sdk";

/**
 * The seam between the extension host and the process that actually owns
 * credentials and the network.
 *
 * It is an interface rather than a direct `invoke` for the same reason
 * `StorageBackend` is: the 37-assertion suite runs the whole host under `tsx`
 * with no Tauri and no network. Keeping the boundary named means the suite
 * exercises the real host code and only the last hop is swapped.
 *
 * Nothing here carries a credential in either direction. The provider id goes
 * out, a status and a body come back.
 */
export interface ProviderTransport {
  /** Executes a request as the provider, with auth attached host-side. */
  fetch(
    providerId: ProviderId,
    url: string,
    method: "GET" | "POST" | "PUT",
    body?: unknown,
  ): Promise<{ status: number; body: unknown }>;

  /**
   * Executes a widget-capability request. Separate from `fetch` because no
   * credential is ever attached here — the two paths answer different
   * questions and must not share an entry point that could confuse them.
   */
  capabilityFetch(
    extensionId: ExtensionId,
    url: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<{ status: number; body: unknown }>;

  /** Backs `ProviderHostContext.credentials.isConnected()`. */
  isConnected(providerId: ProviderId): Promise<boolean>;
}
