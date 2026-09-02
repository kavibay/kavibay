import type { ProviderId } from "@sdk/contract/sdk";

/**
 * Ported unchanged from docs/extension-sdk-reference/credentials.ts (Phase 1).
 *
 * Stands in for the OS keychain behind a Rust command. The only thing that
 * matters architecturally: this object is never reachable from widget code,
 * and no token value ever appears in a WidgetResponse.
 *
 * IN-MEMORY ONLY, AND DELIBERATELY SO. Phase 2 rewrites this against the OS
 * keychain in Rust, exposing only "exists" / "store" / "clear" so a token can
 * never be read back into JS. Adding persistence here — localStorage above all
 * — is the exact mistake that step exists to prevent, and would breach
 * AGENTS.md security invariant 5.
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
