import type { HttpCapability, HttpCapabilityDeclaration } from "../sdk.js";

/**
 * In the shipped app this lives in Rust. Enforcing in JS would be bypassable
 * in one line by in-process widget code. This implementation exists so the
 * contract can be exercised; the policy check is the part that must be ported.
 *
 * KNOWN LIMIT (accepted for v1): an allowlist is not exfiltration protection.
 * A widget allowed to reach api.open-meteo.com can encode anything it has read
 * into query parameters. PR review is the control for that.
 */
export type Fetcher = (url: string, init?: { method: string; body?: string }) => Promise<unknown>;

export class HttpBroker {
  constructor(private fetcher: Fetcher) {}

  forPolicy(policy: HttpCapabilityDeclaration): HttpCapability {
    const check = (url: string, method: "GET" | "POST") => {
      let host: string;
      try {
        const u = new URL(url);
        if (u.protocol !== "https:") throw new Error(`http capability denied: non-https ${url}`);
        host = u.hostname;
      } catch {
        throw new Error(`http capability denied: unparseable url ${url}`);
      }
      if (!policy.hosts.includes(host)) throw new Error(`http capability denied: host ${host}`);
      if (!policy.methods.includes(method)) throw new Error(`http capability denied: method ${method}`);
    };

    return {
      get: async <T>(url: string, params?: Record<string, string | number | boolean>) => {
        check(url, "GET");
        const u = new URL(url);
        for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, String(v));
        return (await this.fetcher(u.toString(), { method: "GET" })) as T;
      },
      post: async <T>(url: string, body?: unknown) => {
        check(url, "POST");
        return (await this.fetcher(url, { method: "POST", body: JSON.stringify(body ?? {}) })) as T;
      },
    };
  }
}
