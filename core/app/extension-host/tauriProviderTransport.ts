import { invoke } from "@tauri-apps/api/core";
import type { ExtensionId, ProviderId } from "@sdk/contract/sdk";
import type { ProviderConnection, ProviderTransport } from "./providerTransport";
import { connectionEpoch } from "../settings/credentials/connections";

/** How long a usable connection is reused before the host is asked again. */
const CONNECTION_TTL_MS = 5_000;

/**
 * Remembers usable connections for a few seconds.
 *
 * `Host.query` needs the connection before it can even look in its cache (the
 * account is part of the key), so every read cost an IPC round trip and a
 * SQLite open, hit or not. A connection changes when the user picks another
 * account — `connectionEpoch` moves, and the widgets remount — or when an
 * account stops working, which the host reports on the fetch itself. An
 * unusable answer is never reused: right after a connect it would hold a
 * widget on "reconnect" for the length of the TTL.
 */
export function connectionCache(
  load: (providerId: ProviderId, owner: string, packageId?: string) => Promise<ProviderConnection | null>,
  epoch: () => number,
  now: () => number = Date.now,
) {
  const entries = new Map<string, { epoch: number; at: number; value: Promise<ProviderConnection | null> }>();
  return (providerId: ProviderId, owner: string, packageId?: string): Promise<ProviderConnection | null> => {
    const key = JSON.stringify([providerId, owner, packageId ?? null]);
    const hit = entries.get(key);
    if (hit && hit.epoch === epoch() && now() - hit.at < CONNECTION_TTL_MS) return hit.value;
    const value = load(providerId, owner, packageId);
    entries.set(key, { epoch: epoch(), at: now(), value });
    const forget = () => {
      if (entries.get(key)?.value === value) entries.delete(key);
    };
    value.then((connection) => {
      if (connection && !connection.available) forget();
    }, forget);
    return value;
  };
}

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
  connection: connectionCache(
    (providerId, owner, packageId) => invoke("extension_provider_connection", { providerId, owner, packageId }),
    () => connectionEpoch.value,
  ),
};
