import type {
  ExtensionId, HttpCapability, HttpCapabilityDeclaration, ProviderError, ProviderHttpCapability, ProviderId,
} from "@sdk/contract/sdk";
import type { ProviderTransport } from "./providerTransport";

/**
 * Ported from docs/extension-sdk-reference/http.ts (Phase 1).
 *
 * In the shipped app this lives in Rust. Enforcing in JS would be bypassable
 * in one line by in-process widget code. This implementation exists so the
 * contract can be exercised; the policy check is the part that must be ported.
 *
 * KNOWN LIMIT (accepted for v1): an allowlist is not exfiltration protection.
 * A widget allowed to reach api.open-meteo.com can encode anything it has read
 * into query parameters. PR review is the control for that.
 *
 * One fix against the reference: the non-https check sat inside the `try` that
 * catches URL parse failures, so its own error was swallowed and re-thrown as
 * "unparseable url". Both messages say "denied" and no assertion could tell
 * them apart, which is precisely why it survived. Parsing and policy are now
 * separate steps.
 */
export type Fetcher = (url: string, init?: { method: string; body?: string }) => Promise<unknown>;

export class HttpBroker {
  constructor(
    private fetcher: Fetcher,
    /** Absent under `tsx`; present in the app, where Rust owns the boundary. */
    private transport?: ProviderTransport,
  ) {}

  /**
   * The provider path (finding 8). Unlike `forPolicy`, this does not check the
   * host here — the host process does, because it is the same decision as
   * "may a credential go there", and this side of the wire must not make it.
   *
   * Falls back to `forPolicy` when no transport is injected, which is what lets
   * the contract suite exercise provider fetches without Tauri.
   */
  forProvider(providerId: ProviderId, hosts: string[]): ProviderHttpCapability {
    const transport = this.transport;
    if (!transport) {
      const local = this.forPolicy({ hosts, methods: ["GET", "POST"] });
      return {
        ...local,
        put: async <T>(url: string, body?: unknown) => {
          checkHost(url, { hosts, methods: ["GET", "POST"] });
          return (await this.fetcher(url, {
            method: "PUT",
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })) as T;
        },
      };
    }

    const send = async <T>(url: string, method: "GET" | "POST" | "PUT", body?: unknown): Promise<T> => {
      const { status, body: payload } = await transport.fetch(providerId, url, method, body);
      if (status >= 400) throw statusError(status, payload, url);
      return payload as T;
    };

    return {
      // Deliberately NOT round-tripped through `new URL()`. A provider url may
      // still contain a `{{homeId}}` placeholder for the host to fill in
      // (finding 13), and URL normalisation percent-encodes the braces into
      // %7B%7B — after which the host finds no placeholder, substitutes
      // nothing, and tado° answers the mangled path with an accessDenied for
      // "home 0". Parsing this url is the host's job; this side only appends.
      get: <T>(url: string, params?: Record<string, string | number | boolean>) =>
        send<T>(withQuery(url, params), "GET"),
      post: <T>(url: string, body?: unknown) => send<T>(url, "POST", body),
      put: <T>(url: string, body?: unknown) => send<T>(url, "PUT", body),
    };
  }

  /**
   * The widget-capability path (finding 11). No credential is involved, so the
   * host process is not an auth boundary here — it is there for address
   * classification the webview cannot do, and to keep widget traffic out of the
   * main window's CSP.
   *
   * The declared policy is still checked on this side. That is not a duplicate
   * of the host's check pretending to be security: it is what turns a typo in a
   * manifest into an error the widget author sees, rather than a round trip
   * that fails opaquely.
   */
  forCapability(extensionId: ExtensionId, policy: HttpCapabilityDeclaration): HttpCapability {
    const transport = this.transport;
    const local = this.forPolicy(policy);
    if (!transport) return local;

    const send = async <T>(url: string, method: "GET" | "POST", body?: unknown): Promise<T> => {
      const { status, body: payload } = await transport.capabilityFetch(extensionId, url, method, body);
      if (status >= 400) throw statusError(status, payload, url);
      return payload as T;
    };

    return {
      get: async <T>(url: string, params?: Record<string, string | number | boolean>) => {
        const u = new URL(url);
        for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, String(v));
        assertDeclared(policy, u, "GET");
        return send<T>(u.toString(), "GET");
      },
      post: async <T>(url: string, body?: unknown) => {
        assertDeclared(policy, new URL(url), "POST");
        return send<T>(url, "POST", body);
      },
    };
  }

  forPolicy(policy: HttpCapabilityDeclaration): HttpCapability {
    const check = (url: string, method: "GET" | "POST") => {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        throw new Error(`http capability denied: unparseable url ${url}`);
      }
      assertDeclared(policy, u, method);
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

/**
 * Appends query parameters without parsing the url, so a `{{placeholder}}`
 * survives to the host process intact.
 */
function withQuery(url: string, params?: Record<string, string | number | boolean>): string {
  const entries = Object.entries(params ?? {});
  if (entries.length === 0) return url;
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

/**
 * Host and path only. A query string can carry an api key or a token an author
 * put there, and this string ends up in a log and a screenshot.
 */
function safePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "unparseable url";
  }
}

/** Host and scheme only — PUT is provider-only and is not in the widget method list. */
function checkHost(url: string, policy: HttpCapabilityDeclaration) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`http capability denied: unparseable url ${url}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`http capability denied: non-https ${parsed.href}`);
  if (!policy.hosts.includes(parsed.hostname)) {
    throw new Error(`http capability denied: host ${parsed.hostname}`);
  }
}

function assertDeclared(policy: HttpCapabilityDeclaration, url: URL, method: "GET" | "POST") {
  if (url.protocol !== "https:") throw new Error(`http capability denied: non-https ${url.href}`);
  // Exact hostnames, no wildcards — the contract says so, and a wildcard is
  // how an allowlist quietly stops being one.
  if (!policy.hosts.includes(url.hostname)) {
    throw new Error(`http capability denied: host ${url.hostname}`);
  }
  if (!policy.methods.includes(method)) {
    throw new Error(`http capability denied: method ${method}`);
  }
}

/**
 * Turns an HTTP status into the typed error the contract already models, so a
 * widget sees `auth-expired` rather than a 401 it would have to interpret, and
 * the runtime's error UI can be specific without parsing a body.
 */
function statusError(status: number, body: unknown, url?: string): ProviderError {
  // The server's own words, whatever shape they arrive in. Discarding a JSON
  // error body because it is not a string left "request failed with 403" as
  // the only clue, which cost three rounds of guessing — the endpoint that
  // failed and what it said about it are the whole diagnosis.
  const said =
    typeof body === "string"
      ? body.trim()
      : body != null
        ? JSON.stringify(body).slice(0, 400)
        : "";
  const where = url ? ` (${safePath(url)})` : "";
  const message = said ? `${status}${where}: ${said}` : `request failed with ${status}${where}`;
  if (status === 401) return { kind: "auth-expired", message };
  if (status === 403) return { kind: "permission-denied", message };
  if (status === 404) return { kind: "not-found", message };
  if (status === 429) return { kind: "rate-limited", message };
  return { kind: "provider-error", message };
}
