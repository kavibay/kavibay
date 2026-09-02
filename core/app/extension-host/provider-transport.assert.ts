import type { ProviderError } from "@sdk/contract/sdk";
import { HttpBroker, type Fetcher } from "./http";
import type { ProviderTransport } from "./providerTransport";

/**
 * Asserts for the Phase 2 boundary.
 * Run: npx tsx core/app/extension-host/provider-transport.assert.ts
 *
 * The thing under test is a division of labour, not an algorithm: with a
 * transport present, this process must stop deciding where a request may go,
 * because that decision is now the same one as "may a credential go there" and
 * it belongs to whoever holds the credential.
 */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function caught(fn: () => Promise<unknown>): Promise<any> {
  try { await fn(); return undefined; } catch (e) { return e; }
}

/** Records what crossed the seam, so the tests can assert on the payload. */
function fakeTransport(reply: { status: number; body: unknown } = { status: 200, body: { ok: true } }) {
  const calls: { providerId: string; url: string; method: string; body?: unknown }[] = [];
  const capabilityCalls: { extensionId: string; url: string; method: string }[] = [];
  const transport: ProviderTransport = {
    fetch: async (providerId, url, method, body) => {
      calls.push({ providerId, url, method, body });
      return reply;
    },
    capabilityFetch: async (extensionId, url, method) => {
      capabilityCalls.push({ extensionId, url, method });
      return reply;
    },
    isConnected: async (providerId) => providerId === "kavibay.tado/tado",
  };
  return { transport, calls, capabilityCalls };
}

/** Fails loudly: with a transport present, nothing may reach the network here. */
const forbiddenFetcher: Fetcher = async () => {
  throw new Error("the in-process fetcher must not be used on the provider path");
};

const TADO = "kavibay.tado/tado";

// --- the provider id is what the host resolves the allowlist from ---
{
  const { transport, calls } = fakeTransport();
  const http = new HttpBroker(forbiddenFetcher, transport).forProvider(TADO, ["my.tado.com"]);

  await http.get("https://my.tado.com/api/v2/rooms", { zone: 1 });

  assert(calls.length === 1, "the request went to the host process");
  assert(calls[0]!.providerId === TADO, "the provider id crossed the seam");
  assert(calls[0]!.url.includes("zone=1"), "query parameters are applied before sending");
  // Nothing else: no allowlist, no credential, no header set by this side.
  assert(Object.keys(calls[0]!).length === 4, "nothing beyond id, url, method and body is sent");
}

// --- providers may PUT; widget capabilities still may not ---
{
  const { transport, calls, capabilityCalls } = fakeTransport({ status: 204, body: "" });
  const http = new HttpBroker(forbiddenFetcher, transport).forProvider(TADO, ["my.tado.com"]);

  await http.put("https://my.tado.com/api/v2/rooms/1/target", { temperature: 21 });

  assert(calls.length === 1, "PUT went to the host process");
  assert(calls[0]!.method === "PUT", "the method on the wire is PUT, not POST");
  assert(typeof calls[0]!.body === "object" && calls[0]!.body !== null, "a JSON body is forwarded");

  await http.put("https://my.tado.com/api/v2/pause");
  assert(calls[1]!.method === "PUT" && calls[1]!.body === undefined, "an empty PUT omits the body");

  const capability = new HttpBroker(forbiddenFetcher, transport).forCapability("kavibay.weather", {
    hosts: ["api.open-meteo.com"],
    methods: ["GET"],
  });
  assert(typeof (capability as { put?: unknown }).put !== "function", "widget http has no put");
  assert(capabilityCalls.length === 0, "capability PUT was never a path we could take");
}

// --- a placeholder must reach the host process unmangled ---
{
  const { transport, calls } = fakeTransport();
  const http = new HttpBroker(forbiddenFetcher, transport).forProvider(TADO, ["my.tado.com"]);

  await http.get("https://my.tado.com/api/v2/homes/{{homeId}}/zones");
  assert(
    calls[0]!.url === "https://my.tado.com/api/v2/homes/{{homeId}}/zones",
    `braces survive untouched, got ${calls[0]!.url}`,
  );

  // With parameters too: appending must not mean parsing. Running this url
  // through `new URL()` encodes the braces to %7B%7B, the host then finds no
  // placeholder, and tado° answers the mangled path with "access to home 0
  // denied" — which is how this reached a user.
  await http.get("https://my.tado.com/api/v2/homes/{{homeId}}/zones", { detail: "full" });
  assert(
    calls[1]!.url === "https://my.tado.com/api/v2/homes/{{homeId}}/zones?detail=full",
    `parameters append without encoding the braces, got ${calls[1]!.url}`,
  );

  await http.get("https://my.tado.com/x?a=1", { b: "two words" });
  assert(calls[2]!.url === "https://my.tado.com/x?a=1&b=two%20words", `merges and escapes, got ${calls[2]!.url}`);
}

// --- this side no longer enforces the allowlist ---
{
  const { transport, calls } = fakeTransport();
  const http = new HttpBroker(forbiddenFetcher, transport).forProvider(TADO, ["my.tado.com"]);

  // A host outside the declared list still goes to the host process, which is
  // the point: if TypeScript refused here, the real check would never be
  // exercised and a JS-side bypass would look like a working allowlist.
  await http.get("https://evil.example.com/collect");

  assert(calls.length === 1, "an off-list host is forwarded, not refused locally");
  assert(calls[0]!.url.startsWith("https://evil.example.com"), "forwarded unchanged");
}

// --- http status becomes the contract's typed error ---
{
  for (const [status, kind] of [
    [401, "auth-expired"],
    [403, "permission-denied"],
    [404, "not-found"],
    [429, "rate-limited"],
    [500, "provider-error"],
  ] as const) {
    const { transport } = fakeTransport({ status, body: "nope" });
    const http = new HttpBroker(forbiddenFetcher, transport).forProvider(TADO, ["my.tado.com"]);
    const error = (await caught(() => http.get("https://my.tado.com/x"))) as ProviderError;
    assert(error?.kind === kind, `status ${status} maps to ${kind}, got ${JSON.stringify(error)}`);
  }
}

// --- a success is unwrapped to the body, not the envelope ---
{
  const { transport } = fakeTransport({ status: 200, body: [{ id: "living-room" }] });
  const http = new HttpBroker(forbiddenFetcher, transport).forProvider(TADO, ["my.tado.com"]);
  const rooms = await http.get<{ id: string }[]>("https://my.tado.com/api/v2/rooms");
  assert(rooms[0]?.id === "living-room", "the provider receives the body, not {status, body}");
}

// --- without a transport the in-process check still applies ---
{
  const seen: string[] = [];
  const fetcher: Fetcher = async (url) => { seen.push(url); return { ok: true }; };
  const http = new HttpBroker(fetcher).forProvider(TADO, ["my.tado.com"]);

  await http.get("https://my.tado.com/api/v2/rooms");
  assert(seen.length === 1, "falls back to the injected fetcher");

  const denied = await caught(() => http.get("https://evil.example.com/collect"));
  assert(
    denied instanceof Error && denied.message.includes("denied"),
    "the fallback still refuses an off-list host, which is what keeps the suite honest",
  );
}

// --- the capability path is separate, and never touches the provider entry ---
{
  const { transport, calls, capabilityCalls } = fakeTransport();
  const http = new HttpBroker(forbiddenFetcher, transport).forCapability("kavibay.weather", {
    hosts: ["api.open-meteo.com"],
    methods: ["GET"],
  });

  await http.get("https://api.open-meteo.com/v1/forecast", { latitude: 52.4 });

  assert(capabilityCalls.length === 1, "the request went through the capability entry point");
  assert(calls.length === 0, "and never through the one that attaches a credential");
  assert(capabilityCalls[0]!.extensionId === "kavibay.weather", "the extension id crossed");
  assert(capabilityCalls[0]!.url.includes("latitude=52.4"), "query parameters are applied");
}

// --- unlike the provider path, the declaration is still checked here ---
{
  const { transport, capabilityCalls } = fakeTransport();
  const http = new HttpBroker(forbiddenFetcher, transport).forCapability("kavibay.weather", {
    hosts: ["api.open-meteo.com"],
    methods: ["GET"],
  });

  // No credential is at stake, so a local check is not security theatre hiding
  // the real one — it turns a manifest typo into an error the author sees.
  const denied = await caught(() => http.get("https://evil.example.com/collect"));
  assert(denied instanceof Error && denied.message.includes("denied"), "off-list host refused");
  assert(capabilityCalls.length === 0, "and refused before crossing the wire");

  const wrongMethod = await caught(() => http.post("https://api.open-meteo.com/v1/forecast", {}));
  assert(wrongMethod instanceof Error, "an undeclared method is refused too");
}

// --- isConnected is a boolean and nothing more ---
{
  const { transport } = fakeTransport();
  assert((await transport.isConnected(TADO)) === true, "connected provider reports true");
  assert(
    (await transport.isConnected("kavibay.google-calendar/calendar")) === false,
    "unconfigured provider reports false",
  );
}

console.log("provider-transport.assert.ts: ok");
