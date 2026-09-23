import { invoke } from "@tauri-apps/api/core";
import type { ExtensionId, ProviderId } from "@sdk/contract/sdk";
import type { ProviderTransport } from "./providerTransport";

/**
 * The real transport: both calls land in `src-tauri/src/extension_providers`.
 *
 * This file is the only place in the extension host that knows Tauri exists,
 * which is what keeps the contract and the host runnable under `tsx`.
 *
 * Note what is NOT sent: no allowlist and no credential. The host process
 * derives both from the provider id — a value the webview supplies must not
 * decide where this app is willing to send a token (finding 7's rule, applied
 * to finding 8's boundary).
 */
export const tauriProviderTransport: ProviderTransport = {
  // The body key is omitted rather than sent as null: `Option<Value>` on the
  // Rust side reads an explicit null as `Some(Null)`, not `None`.
  fetch: (providerId, url, method, body, connection) =>
    invoke<{ status: number; body: unknown }>("extension_provider_fetch", {
      providerId,
      owner: connection?.owner,
      credentialId: connection?.credentialId ?? undefined,
      packageId: connection?.packageId,
      url,
      method,
      ...(body === undefined ? {} : { body }),
    }),

  capabilityFetch: (extensionId: ExtensionId, url: string, method: "GET" | "POST", body?: unknown) =>
    invoke<{ status: number; body: unknown }>("extension_capability_fetch", {
      extensionId,
      url,
      method,
      ...(body === undefined ? {} : { body }),
    }),

  isConnected: (providerId: ProviderId, owner = "host:default") =>
    invoke<boolean>("extension_provider_is_connected", { providerId, owner }),
  connection: (providerId, owner, packageId) => invoke("extension_provider_connection", { providerId, owner, packageId }),
};
