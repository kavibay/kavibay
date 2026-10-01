/**
 * Validation of a runtime package's `api.json` (declarative HTTP endpoints).
 *
 * Design: `docs/design/declarative-http-api.md`.
 * Step D0 — format + validators only; nothing here performs a request.
 *
 * Mirrors `src-tauri/src/runtime_extensions/api_declaration.rs` (AGENTS.md
 * invariant 4): same rules, same error codes. Change both or neither.
 */

/** Only version the format has had. */
export const API_SCHEMA_VERSION = 1;

const MAX_ENDPOINTS = 32;
const MAX_ID_LEN = 64;
const MAX_DESCRIPTION_LEN = 160;
const MAX_FALLBACK_URLS = 4;
const MAX_USER_AGENT_LEN = 128;
const MAX_HEADERS = 8;
const MAX_HEADER_VALUE_LEN = 256;
const MAX_PARAMS_PER_LOCATION = 16;
const DEFAULT_STRING_MAX_LEN = 256;
const HARD_STRING_MAX_LEN = 2048;
const MAX_ENUM_VALUES = 32;
const MAX_ARRAY_ITEMS = 100;
const MAX_WINDOW_SECS = 86_400;

export type ApiMethod = "GET" | "POST" | "PUT";
export type ApiBodyType = "json" | "form";
export type ApiCharset = "alnum" | "alnumDash" | "alnumDot" | "alnumSymbol";

export type ApiParam =
  | { kind: "string"; required: boolean; maxLength: number; charset?: ApiCharset }
  | { kind: "number"; required: boolean }
  | { kind: "boolean"; required: boolean }
  | { kind: "enum"; required: boolean; values: string[] }
  | { kind: "array"; required: boolean; items: ApiParam; maxItems: number }
  | { kind: "const"; value: string | number | boolean };

export interface ApiEndpoint {
  id: string;
  /** User-visible consent text — author-supplied, render as text, never markup. */
  description: string;
  method: ApiMethod;
  url: string;
  fallbackUrls: string[];
  userAgent?: string;
  path: Record<string, ApiParam>;
  query: Record<string, ApiParam>;
  body: Record<string, ApiParam>;
  bodyType: ApiBodyType;
  headers: Record<string, string>;
  credential?: string;
  cacheTtlSeconds?: number;
  minIntervalSeconds?: number;
}

export interface ApiDeclaration {
  endpoints: ApiEndpoint[];
}

export type ApiValidateResult =
  | { ok: true; declaration: ApiDeclaration }
  | { ok: false; error: string };

const ENDPOINT_KEYS = [
  "id",
  "description",
  "method",
  "url",
  "fallbackUrls",
  "userAgent",
  "path",
  "query",
  "body",
  "bodyType",
  "headers",
  "credential",
  "cache",
  "rate",
];

const PARAM_KEYS = [
  "type",
  "required",
  "value",
  "values",
  "maxLength",
  "charset",
  "description",
  "items",
  "maxItems",
];

const CHARSETS: ReadonlySet<string> = new Set([
  "alnum",
  "alnumDash",
  "alnumDot",
  "alnumSymbol",
]);

function err(code: string): ApiValidateResult {
  return { ok: false, error: code };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Rejects any key the format does not define, so a declaration can never mean
 * more than what the consent dialog showed.
 */
function unknownKey(
  obj: Record<string, unknown>,
  allowed: string[],
  scope: string,
): string | null {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) return `unknown_key:${scope}.${key}`;
  }
  return null;
}

/** `[a-zA-Z][a-zA-Z0-9_]{0,63}` */
export function isValidEndpointId(id: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(id);
}

/** Path portion of a raw url string, untouched by url normalization. */
function rawPathOf(raw: string): string {
  const afterScheme = raw.includes("://") ? raw.slice(raw.indexOf("://") + 3) : raw;
  const slash = afterScheme.indexOf("/");
  return slash === -1 ? "" : afterScheme.slice(slash);
}

/**
 * Static, absolute, https url whose only variable parts are whole path segments
 * — the guarantee the security model rests on (design §6.1).
 *
 * A placeholder may occupy an entire segment (`/repos/{owner}/{repo}`) and
 * nothing else: never part of the host, never a fragment of a segment like
 * `/v1/user-{id}`. Returns the placeholder names in order, or an error code.
 */
export function validateApiUrl(raw: string): string[] | string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "invalid_url";
  }
  if (parsed.protocol !== "https:") return "url_not_https";
  if (parsed.search !== "") return "url_has_query";
  if (parsed.hash !== "") return "url_has_fragment";
  if (parsed.username !== "" || parsed.password !== "") return "url_has_userinfo";
  const host = parsed.hostname;
  if (host === "") return "invalid_url";
  if (host.includes("{") || host.includes("}")) return "url_placeholder_in_host";
  // An IP literal skips DNS and is the classic way to reach a local service.
  if (host.startsWith("[")) return "url_is_ip_literal";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "url_is_ip_literal";

  // Read placeholders from the raw string: url parsing percent-encodes braces
  // (`{owner}` becomes `%7Bowner%7D`) and would hide every one of them.
  const placeholders: string[] = [];
  for (const segment of rawPathOf(raw).split("/")) {
    if (segment === "") continue;
    if (!segment.includes("{") && !segment.includes("}")) continue;
    if (!segment.startsWith("{") || !segment.endsWith("}")) {
      return "url_partial_placeholder";
    }
    const name = segment.slice(1, -1);
    if (name.includes("{") || name.includes("}")) return "url_partial_placeholder";
    if (!isValidEndpointId(name)) return "invalid_placeholder_name";
    if (placeholders.includes(name)) return "duplicate_placeholder";
    placeholders.push(name);
  }
  return placeholders;
}

/**
 * Headers a declaration may set. `Authorization` is absent on purpose: auth
 * comes from the credential layer, never from the package's file.
 */
export function isHeaderAllowed(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "accept" || lower === "content-type" || lower.startsWith("x-");
}

/** True when every character of `value` is inside `charset`. */
export function charsetAccepts(charset: ApiCharset, value: string): boolean {
  switch (charset) {
    case "alnum":
      return /^[A-Za-z0-9]*$/.test(value);
    case "alnumDash":
      return /^[A-Za-z0-9\-_]*$/.test(value);
    case "alnumDot":
      return /^[A-Za-z0-9.\-_]*$/.test(value);
    case "alnumSymbol":
      return /^[A-Za-z0-9.\-_^=:]*$/.test(value);
  }
}

/**
 * True when `value` may be used as a single URL path segment.
 *
 * A charset is a character *class* and nothing more: `alnumDot` happily accepts
 * `".."`. Path binding must run this **in addition to** the declared charset.
 */
export function isSafePathSegment(value: string): boolean {
  if (value === "" || value.length > HARD_STRING_MAX_LEN) return false;
  if (value === "." || value === ".." || value.startsWith(".")) return false;
  // `%` would let a pre-encoded `%2f` smuggle in a separator.
  // oxlint-disable-next-line no-control-regex
  return !/[/\\%\u0000-\u001f\u007f]/.test(value);
}

function parseParam(raw: unknown, scope: string): ApiParam | string {
  if (!isPlainObject(raw)) return "invalid_param_type";
  const unknown = unknownKey(raw, PARAM_KEYS, scope);
  if (unknown) return unknown;

  const kind = raw.type;
  if (typeof kind !== "string") return "invalid_param_type";

  let required = false;
  if (raw.required !== undefined) {
    if (typeof raw.required !== "boolean") return "invalid_param_type";
    required = raw.required;
  }

  switch (kind) {
    case "array": {
      if (scope !== "body") return "array_not_in_body";
      if (!isPlainObject(raw.items) || typeof raw.items.type !== "string" ||
          !["string", "number", "boolean", "enum"].includes(raw.items.type)) {
        return "invalid_array_items";
      }
      const maxItems = raw.maxItems === undefined ? MAX_ARRAY_ITEMS : raw.maxItems;
      if (typeof maxItems !== "number" || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > MAX_ARRAY_ITEMS) {
        return "invalid_array_max_items";
      }
      const items = parseParam(raw.items, "items");
      if (typeof items === "string") return items;
      return { kind: "array", required, items, maxItems };
    }
    case "string": {
      let maxLength = DEFAULT_STRING_MAX_LEN;
      if (raw.maxLength !== undefined) {
        if (typeof raw.maxLength !== "number" || !Number.isInteger(raw.maxLength)) {
          return "invalid_param_type";
        }
        if (raw.maxLength <= 0 || raw.maxLength > HARD_STRING_MAX_LEN) {
          return "invalid_param_max_length";
        }
        maxLength = raw.maxLength;
      }
      let charset: ApiCharset | undefined;
      if (raw.charset !== undefined) {
        if (typeof raw.charset !== "string" || !CHARSETS.has(raw.charset)) {
          return "invalid_charset";
        }
        charset = raw.charset as ApiCharset;
      }
      return charset === undefined
        ? { kind: "string", required, maxLength }
        : { kind: "string", required, maxLength, charset };
    }
    case "number":
      return { kind: "number", required };
    case "boolean":
      return { kind: "boolean", required };
    case "enum": {
      const values = raw.values;
      if (!Array.isArray(values) || values.length === 0 || values.length > MAX_ENUM_VALUES) {
        return "invalid_enum_values";
      }
      if (!values.every((v): v is string => typeof v === "string")) {
        return "invalid_enum_values";
      }
      return { kind: "enum", required, values: [...values] };
    }
    case "const": {
      const value = raw.value;
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        return "invalid_const";
      }
      return { kind: "const", value };
    }
    default:
      return "invalid_param_type";
  }
}

function parseParams(
  raw: unknown,
  scope: string,
): Record<string, ApiParam> | string {
  if (raw === undefined) return {};
  if (!isPlainObject(raw)) return "invalid_params";
  const names = Object.keys(raw);
  if (names.length > MAX_PARAMS_PER_LOCATION) return "too_many_params";

  const out: Record<string, ApiParam> = {};
  for (const name of names) {
    if (name === "" || name.length > MAX_ID_LEN) return "invalid_param_name";
    const parsed = parseParam(raw[name], scope);
    if (typeof parsed === "string") return parsed;
    out[name] = parsed;
  }
  return out;
}

function parseWindow(
  raw: unknown,
  field: string,
  scope: string,
): number | undefined | string {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) return "invalid_window";
  const unknown = unknownKey(raw, [field], scope);
  if (unknown) return unknown;
  const seconds = raw[field];
  if (typeof seconds !== "number" || !Number.isInteger(seconds)) return "invalid_window";
  if (seconds <= 0 || seconds > MAX_WINDOW_SECS) return "invalid_window";
  return seconds;
}

function parseEndpoint(raw: unknown, knownCredentialTypes: ReadonlySet<string>): ApiEndpoint | string {
  if (!isPlainObject(raw)) return "invalid_endpoint";
  const unknown = unknownKey(raw, ENDPOINT_KEYS, "endpoint");
  if (unknown) return unknown;

  if (typeof raw.id !== "string" || !isValidEndpointId(raw.id)) return "invalid_endpoint_id";

  if (typeof raw.description !== "string" || raw.description.trim() === "") {
    return "missing_description";
  }
  if ([...raw.description].length > MAX_DESCRIPTION_LEN) return "description_too_long";

  if (raw.method !== "GET" && raw.method !== "POST" && raw.method !== "PUT") return "invalid_method";
  const method: ApiMethod = raw.method;

  if (typeof raw.url !== "string") return "invalid_url";
  const placeholders = validateApiUrl(raw.url);
  if (typeof placeholders === "string") return placeholders;

  const fallbackUrls: string[] = [];
  if (raw.fallbackUrls !== undefined) {
    if (!Array.isArray(raw.fallbackUrls)) return "invalid_fallback_urls";
    if (raw.fallbackUrls.length > MAX_FALLBACK_URLS) return "too_many_fallback_urls";
    for (const entry of raw.fallbackUrls) {
      if (typeof entry !== "string") return "invalid_fallback_urls";
      const fallbackPlaceholders = validateApiUrl(entry);
      if (typeof fallbackPlaceholders === "string") return fallbackPlaceholders;
      // A fallback with a different shape would bind different arguments.
      if (fallbackPlaceholders.join("\u0000") !== placeholders.join("\u0000")) {
        return "fallback_placeholder_mismatch";
      }
      fallbackUrls.push(entry);
    }
  }

  let userAgent: string | undefined;
  if (raw.userAgent !== undefined) {
    if (
      typeof raw.userAgent !== "string" ||
      raw.userAgent.trim() === "" ||
      raw.userAgent.length > MAX_USER_AGENT_LEN ||
      // printable ASCII only, matching the Rust check
      !/^[ -~]+$/.test(raw.userAgent)
    ) {
      return "invalid_user_agent";
    }
    userAgent = raw.userAgent;
  }

  const path = parseParams(raw.path, "path");
  if (typeof path === "string") return path;
  // Declaration and url must agree exactly: an undeclared placeholder could
  // never be filled, and a declared-but-unused path param would look like an
  // input in the consent dialog while doing nothing.
  for (const name of placeholders) {
    if (!(name in path)) return `undeclared_placeholder:${name}`;
  }
  for (const name of Object.keys(path)) {
    if (!placeholders.includes(name)) return `unused_path_param:${name}`;
    if (path[name].kind === "const") return `const_path_param:${name}`;
  }

  const query = parseParams(raw.query, "query");
  if (typeof query === "string") return query;
  const body = parseParams(raw.body, "body");
  if (typeof body === "string") return body;
  if (method === "GET" && Object.keys(body).length > 0) return "body_on_get";

  let bodyType: ApiBodyType = "json";
  if (raw.bodyType !== undefined) {
    if (raw.bodyType !== "json" && raw.bodyType !== "form") return "invalid_body_type";
    bodyType = raw.bodyType;
  }
  if (bodyType === "form" && Object.values(body).some((param) => param.kind === "array")) {
    return "array_on_form";
  }

  const headers: Record<string, string> = {};
  if (raw.headers !== undefined) {
    if (!isPlainObject(raw.headers)) return "invalid_headers";
    const names = Object.keys(raw.headers);
    if (names.length > MAX_HEADERS) return "too_many_headers";
    for (const name of names) {
      if (!isHeaderAllowed(name)) return `header_not_allowed:${name}`;
      const value = raw.headers[name];
      if (
        typeof value !== "string" ||
        value.length > MAX_HEADER_VALUE_LEN ||
        !/^[ -~]+$/.test(value)
      ) {
        return "invalid_headers";
      }
      headers[name] = value;
    }
  }

  let credential: string | undefined;
  if (raw.credential !== undefined && raw.credential !== null) {
    if (typeof raw.credential !== "string") return "invalid_credential";
    // A stale type id would name a credential the consent dialog cannot show.
    if (!knownCredentialTypes.has(raw.credential)) {
      return `unknown_credential_type:${raw.credential}`;
    }
    credential = raw.credential;
  }

  const cache = parseWindow(raw.cache, "ttlSeconds", "cache");
  if (typeof cache === "string") return cache;
  const rate = parseWindow(raw.rate, "minIntervalSeconds", "rate");
  if (typeof rate === "string") return rate;

  const endpoint: ApiEndpoint = {
    id: raw.id,
    description: raw.description.trim(),
    method,
    url: raw.url,
    fallbackUrls,
    path,
    query,
    body,
    bodyType,
    headers,
  };
  if (userAgent !== undefined) endpoint.userAgent = userAgent;
  if (credential !== undefined) endpoint.credential = credential;
  if (cache !== undefined) endpoint.cacheTtlSeconds = cache;
  if (rate !== undefined) endpoint.minIntervalSeconds = rate;
  return endpoint;
}

/**
 * Validate a raw `api.json` value. `knownCredentialTypes` comes from the host's
 * credential registry (`credential_types_list`), so a declaration can only
 * reference a type that actually exists.
 */
export function validateApiDeclaration(
  raw: unknown,
  knownCredentialTypes: ReadonlySet<string> = new Set(),
): ApiValidateResult {
  if (!isPlainObject(raw)) return err("declaration_not_object");
  const unknown = unknownKey(raw, ["schemaVersion", "endpoints"], "root");
  if (unknown) return err(unknown);

  if (raw.schemaVersion !== API_SCHEMA_VERSION) return err("schema_version_unsupported");

  if (!Array.isArray(raw.endpoints)) return err("invalid_endpoints");
  if (raw.endpoints.length === 0) return err("no_endpoints");
  if (raw.endpoints.length > MAX_ENDPOINTS) return err("too_many_endpoints");

  const endpoints: ApiEndpoint[] = [];
  const seen = new Set<string>();
  for (const rawEndpoint of raw.endpoints) {
    const parsed = parseEndpoint(rawEndpoint, knownCredentialTypes);
    if (typeof parsed === "string") return err(parsed);
    if (seen.has(parsed.id)) return err("duplicate_endpoint_id");
    seen.add(parsed.id);
    endpoints.push(parsed);
  }

  return { ok: true, declaration: { endpoints } };
}
