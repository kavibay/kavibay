import type { ProviderId } from "../sdk.js";

/**
 * Stands in for the OS keychain behind a Rust command. The only thing that
 * matters architecturally: this object is never reachable from widget code,
 * and no token value ever appears in a WidgetResponse.
 */
export class CredentialVault {
  private store = new Map<ProviderId, { accessToken?: string; apiKey?: string; expiresAt?: number }>();

  put(provider: ProviderId, v: { accessToken?: string; apiKey?: string; expiresAt?: number }) {
    this.store.set(provider, v);
  }
  clear(provider: ProviderId) {
    this.store.delete(provider);
  }
  has(provider: ProviderId) {
    return this.store.has(provider);
  }
  isExpired(provider: ProviderId) {
    const v = this.store.get(provider);
    return !!v?.expiresAt && v.expiresAt < Date.now();
  }
  read(provider: ProviderId) {
    return this.store.get(provider);
  }
}
