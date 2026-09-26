/**
 * api.json validation — mirrors the Rust tests in
 * src-tauri/src/runtime_extensions/api_declaration.rs.
 * Run: npx tsx core/app/runtime/apiDeclarationValidate.assert.ts
 */
import {
  charsetAccepts,
  isSafePathSegment,
  isValidEndpointId,
  validateApiDeclaration,
  validateApiUrl,
} from "./apiDeclarationValidate";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const KNOWN_CREDENTIALS = new Set(["githubPat", "cloudflareWorkersAi", "spotifyOAuth2"]);

function endpoint(extra: Record<string, unknown> = {}) {
  return {
    id: "forecast",
    description: "Reads the current temperature from Open-Meteo.",
    method: "GET",
    url: "https://api.open-meteo.com/v1/forecast",
    ...extra,
  };
}

function declaration(endpoints: unknown[]) {
  return { schemaVersion: 1, endpoints };
}

function parseOne(extra: Record<string, unknown> = {}) {
  return validateApiDeclaration(declaration([endpoint(extra)]), KNOWN_CREDENTIALS);
}

function errorOf(extra: Record<string, unknown>): string {
  const result = parseOne(extra);
  assert(!result.ok, `expected an error for ${JSON.stringify(extra)}`);
  return result.error;
}

// --- the documented weather example ---
{
  const result = parseOne({
    query: {
      latitude: { type: "number", required: true },
      longitude: { type: "number", required: true },
      current: { type: "const", value: "temperature_2m" },
    },
    cache: { ttlSeconds: 600 },
    rate: { minIntervalSeconds: 60 },
  });
  assert(result.ok, "weather example validates");
  if (result.ok) {
    const ep = result.declaration.endpoints[0];
    assert(ep.method === "GET", "method parsed");
    assert(ep.cacheTtlSeconds === 600, "cache ttl parsed");
    assert(ep.minIntervalSeconds === 60, "rate parsed");
    assert(ep.query.current.kind === "const", "const param parsed");
  }
}

// --- schema version ---
assert(
  !validateApiDeclaration({ schemaVersion: 2, endpoints: [] }).ok,
  "unsupported schema version",
);
assert(!validateApiDeclaration({ endpoints: [] }).ok, "missing schema version");
assert(!validateApiDeclaration("nope").ok, "non-object declaration");

// --- unknown keys at every level (a silently-ignored key cannot be audited) ---
{
  const root = validateApiDeclaration(
    { schemaVersion: 1, endpoints: [endpoint()], extra: true },
    KNOWN_CREDENTIALS,
  );
  assert(!root.ok && root.error.startsWith("unknown_key:root."), "unknown root key");
  assert(errorOf({ retries: 3 }).startsWith("unknown_key:endpoint."), "unknown endpoint key");
  assert(
    errorOf({ query: { a: { type: "string", pattern: "^x$" } } }).startsWith("unknown_key:query."),
    "unknown param key",
  );
}

// --- endpoint ids ---
assert(isValidEndpointId("forecast"), "plain id");
assert(!isValidEndpointId("9lives"), "id may not start with a digit");
assert(!isValidEndpointId("has-dash"), "id may not contain a dash");
assert(!isValidEndpointId(""), "empty id");
assert(errorOf({ id: "9lives" }) === "invalid_endpoint_id", "invalid id code");
{
  const dup = validateApiDeclaration(
    declaration([endpoint(), endpoint()]),
    KNOWN_CREDENTIALS,
  );
  assert(!dup.ok && dup.error === "duplicate_endpoint_id", "duplicate ids rejected");
}

// --- description is consent text ---
assert(errorOf({ description: "   " }) === "missing_description", "blank description");
assert(
  errorOf({ description: "x".repeat(161) }) === "description_too_long",
  "description cap",
);

// --- urls must be static https hosts (design §6.1) ---
for (const [url, code] of [
  ["http://api.example.com/v1", "url_not_https"],
  ["https://api.example.com/v1?key=1", "url_has_query"],
  ["https://api.example.com/v1#frag", "url_has_fragment"],
  ["https://user:pw@api.example.com/v1", "url_has_userinfo"],
  ["https://127.0.0.1/v1", "url_is_ip_literal"],
  ["https://[::1]/v1", "url_is_ip_literal"],
  ["not a url", "invalid_url"],
] as const) {
  assert(validateApiUrl(url) === code, `url ${url} → ${code}`);
  assert(errorOf({ url }) === code, `endpoint url ${url} → ${code}`);
}
{
  const ok = validateApiUrl("https://api.open-meteo.com/v1/forecast");
  assert(Array.isArray(ok) && ok.length === 0, "valid url without placeholders");
}

// --- placeholders are whole path segments, matched against declared params ---
{
  const named = validateApiUrl("https://api.github.com/repos/{owner}/{repo}/actions/runs");
  assert(
    Array.isArray(named) && named.join(",") === "owner,repo",
    "placeholders returned in url order",
  );

  const ok = parseOne({
    url: "https://api.github.com/repos/{owner}/{repo}/actions/runs",
    path: {
      owner: { type: "string", required: true, charset: "alnumDash" },
      repo: { type: "string", required: true, charset: "alnumDash" },
    },
  });
  assert(ok.ok, "declared placeholders validate");

  assert(
    errorOf({ url: "https://api.example.com/v1/{id}" }) === "undeclared_placeholder:id",
    "undeclared placeholder",
  );
  assert(
    errorOf({ path: { id: { type: "string" } } }) === "unused_path_param:id",
    "unused path param",
  );
  assert(
    errorOf({ url: "https://api.example.com/v1/user-{id}" }) === "url_partial_placeholder",
    "partial segment",
  );
  assert(
    errorOf({ url: "https://{host}.example.com/v1" }) === "url_placeholder_in_host",
    "no placeholder in host",
  );
  assert(
    errorOf({
      url: "https://api.example.com/{id}/{id}",
      path: { id: { type: "string" } },
    }) === "duplicate_placeholder",
    "duplicate placeholder",
  );
  assert(
    errorOf({
      url: "https://api.example.com/{kind}",
      path: { kind: { type: "const", value: "runs" } },
    }) === "const_path_param:kind",
    "const path param",
  );
  assert(
    errorOf({
      url: "https://a.example.com/{id}",
      path: { id: { type: "string" } },
      fallbackUrls: ["https://b.example.com/fixed"],
    }) === "fallback_placeholder_mismatch",
    "fallback shape must match",
  );
}

// --- fallbacks are validated like the primary ---
{
  const ok = parseOne({ fallbackUrls: ["https://query2.finance.yahoo.com/v8"] });
  assert(ok.ok && ok.declaration.endpoints[0].fallbackUrls.length === 1, "fallback parsed");
  assert(errorOf({ fallbackUrls: ["http://q2.example.com"] }) === "url_not_https", "fallback https");
  assert(errorOf({ fallbackUrls: ["https://10.0.0.1/x"] }) === "url_is_ip_literal", "fallback ip");
}

// --- headers: auth never comes from the package's file ---
assert(
  errorOf({ headers: { Authorization: "Bearer x" } }).startsWith("header_not_allowed:"),
  "Authorization rejected",
);
assert(
  errorOf({ headers: { Cookie: "a=b" } }).startsWith("header_not_allowed:"),
  "Cookie rejected",
);
{
  const ok = parseOne({
    headers: { Accept: "application/json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  assert(ok.ok && Object.keys(ok.declaration.endpoints[0].headers).length === 2, "headers kept");
}

// --- credentials must exist in the host registry ---
{
  const ok = parseOne({ credential: "githubPat" });
  assert(ok.ok && ok.declaration.endpoints[0].credential === "githubPat", "known credential");
  assert(
    errorOf({ credential: "nopeToken" }).startsWith("unknown_credential_type:"),
    "unknown credential",
  );
}

// --- bodies belong to POST and PUT ---
assert(errorOf({ body: { text: { type: "string" } } }) === "body_on_get", "no body on GET");
for (const method of ["POST", "PUT"]) {
  const ok = parseOne({
    method,
    body: { text: { type: "string", required: true } },
    bodyType: "form",
  });
  assert(ok.ok && ok.declaration.endpoints[0].bodyType === "form", "form body");
}

for (const body of [undefined, { context_uri: { type: "string" } }]) {
  const result = parseOne({
    method: "PUT",
    url: "https://api.spotify.com/v1/me/player/play",
    credential: "spotifyOAuth2",
    query: { device_id: { type: "string" } },
    body,
  });
  assert(result.ok && result.declaration.endpoints[0].method === "PUT", "Spotify playback validates");
}
for (const method of ["PATCH", "DELETE", "put"]) {
  assert(errorOf({ method }) === "invalid_method", "unsupported methods stay rejected");
}

// --- bounded scalar arrays belong only to JSON bodies ---
{
  const array = { type: "array", items: { type: "string", maxLength: 64 }, required: true };
  for (const method of ["POST", "PUT"]) {
    const result = parseOne({ method, body: { uris: array } });
    assert(result.ok, "JSON array body validates");
    const param = result.declaration.endpoints[0].body.uris;
    assert(param.kind === "array" && param.maxItems === 100 && param.required, "array defaults and required parsed");
  }
  for (const items of [{ type: "number" }, { type: "boolean" }, { type: "enum", values: ["a"] }]) {
    assert(parseOne({ method: "PUT", body: { values: { ...array, items, maxItems: 1 } } }).ok, "scalar item types validate");
  }
  for (const maxItems of [0, -1, 101, 1.5, "2", null]) {
    assert(errorOf({ method: "PUT", body: { uris: { ...array, maxItems } } }) === "invalid_array_max_items", "invalid array limit");
  }
  for (const items of [undefined, {}, { type: "object" }, { type: "array", items: { type: "string" } }, { type: "const", value: "a" }]) {
    assert(errorOf({ method: "PUT", body: { uris: { ...array, items } } }) === "invalid_array_items", "unsupported item type");
  }
  assert(errorOf({ method: "PUT", body: { uris: { ...array, items: { type: "string", surprise: true } } } }) === "unknown_key:items.surprise", "item schema fails closed");
  assert(errorOf({ method: "PUT", body: { uris: array }, bodyType: "form" }) === "array_on_form", "no arrays in forms");
  assert(errorOf({ body: { uris: array } }) === "body_on_get", "no array body on GET");
  assert(errorOf({ query: { uris: array } }) === "array_not_in_body", "no array query parameters");
  assert(errorOf({ url: "https://api.example.com/{id}", path: { id: array } }) === "array_not_in_body", "no array path parameters");
}

// --- parameter types ---
assert(errorOf({ query: { a: { type: "object" } } }) === "invalid_param_type", "bad param type");
assert(
  errorOf({ query: { a: { type: "enum", values: [] } } }) === "invalid_enum_values",
  "empty enum",
);
assert(errorOf({ query: { a: { type: "const" } } }) === "invalid_const", "const needs a value");
assert(
  errorOf({ query: { a: { type: "string", maxLength: 9999 } } }) === "invalid_param_max_length",
  "maxLength cap",
);
assert(
  errorOf({ query: { a: { type: "string", charset: "regex" } } }) === "invalid_charset",
  "unknown charset",
);

// --- charsets are character classes, nothing more ---
assert(charsetAccepts("alnum", "AAPL"), "alnum accepts letters/digits");
assert(!charsetAccepts("alnum", "BRK.B"), "alnum rejects dots");
assert(charsetAccepts("alnumDot", "BRK.B"), "alnumDot accepts dots");
assert(charsetAccepts("alnumSymbol", "^GDAXI"), "alnumSymbol accepts carets");
assert(!charsetAccepts("alnumDash", "a/b"), "no separators");
assert(!charsetAccepts("alnumSymbol", "a b"), "no spaces");

// A charset is not a traversal defence — path binding needs both checks.
assert(charsetAccepts("alnumDot", ".."), "charset alone accepts ..");
assert(!isSafePathSegment(".."), "path segment rejects ..");
assert(!isSafePathSegment("."), "path segment rejects .");
assert(!isSafePathSegment(".hidden"), "path segment rejects a leading dot");
assert(!isSafePathSegment("a/b"), "path segment rejects a slash");
assert(!isSafePathSegment("a\\b"), "path segment rejects a backslash");
assert(!isSafePathSegment("%2f"), "path segment rejects percent escapes");
assert(!isSafePathSegment("a\nb"), "path segment rejects control characters");
assert(!isSafePathSegment(""), "path segment rejects empty");
assert(isSafePathSegment("AAPL") && isSafePathSegment("BRK.B"), "ordinary segments pass");

// --- windows are bounded ---
assert(errorOf({ cache: { ttlSeconds: 0 } }) === "invalid_window", "zero ttl");
assert(errorOf({ rate: { minIntervalSeconds: 86_401 } }) === "invalid_window", "ttl cap");
assert(parseOne({ cache: { ttlSeconds: 86_400 } }).ok, "one day is allowed");

// --- user agent ---
assert(parseOne({ userAgent: "Mozilla/5.0 (compatible)" }).ok, "printable user agent");
assert(errorOf({ userAgent: "" }) === "invalid_user_agent", "empty user agent");
assert(errorOf({ userAgent: "bad\nheader" }) === "invalid_user_agent", "header splitting");

// --- endpoint count ---
{
  const many = Array.from({ length: 33 }, (_, i) => endpoint({ id: `e${i}` }));
  const tooMany = validateApiDeclaration(declaration(many), KNOWN_CREDENTIALS);
  assert(!tooMany.ok && tooMany.error === "too_many_endpoints", "endpoint cap");
  const none = validateApiDeclaration(declaration([]), KNOWN_CREDENTIALS);
  assert(!none.ok && none.error === "no_endpoints", "at least one endpoint");
}

console.log("apiDeclarationValidate.assert.ts: ok");
