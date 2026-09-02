# Declarative HTTP for Extensions (Design)

Date: 2026-08-01
Status: **the rollout is complete** — D0 through D4, with the migration scope
corrected in section 11.1 (calendar turned out not to be migratable). What
remains is a manual run against live providers, which no test here replaces.

## 1. Goal

Let an extension author add network data **without writing backend code**, and
let the user see **exactly** what an extension will call before enabling it.

Two audiences, one mechanism:

- **Community packages** (sandboxed runtime packages) — for them this is not a
  convenience. They have no IPC, and their frame CSP is `connect-src 'none'`, so
  today they cannot reach the network at all. A host-mediated declarative call is
  the only mechanism that can give them data *and* stay auditable.
- **First-party widgets** — allowed to use the layer, and the ones whose value
  really is "one request" migrate onto it (section 11.1). A second consumer is
  also what keeps the format honest.

The declaration file is the product, not the plumbing: it feeds the request, the
consent dialog, and the audit trail from one source.

## 2. Non-goals (v1)

Explicitly unsupported, and documented as unsupported so the format does not
grow into a programming language:

- Response mapping / transformation DSL (JSONPath & friends) — parsing stays in
  the package's own JS.
- Streaming (SSE), WebSockets, long-polling.
- Pagination loops, dependent request chains, conditional logic.
- File upload/download, non-JSON/non-form bodies.
- Arbitrary request headers chosen by the package.
- OAuth flows *initiated* by a package (using an already-connected credential is
  in scope; starting a sign-in is not).
- Automatic retries — with exactly one exception, added by decision 4: a single
  retry after `401` on a credential endpoint, where the host refreshes the token
  first. Only the host can do that, because only the host has the token.

An API that needs any of these is a first-party integration in Rust, or it is not
supported. That boundary is the feature.

## 3. Why not simply open the CSP

The roadmap's P0.3 sketch (`network.client` + `network.allowedHosts` → per-package
`connect-src`) lets a package `fetch` on its own. Compared with a host-mediated
declarative call:

| | CSP allowlist (raw fetch) | Declarative call (this design) |
|---|---|---|
| Granularity shown to the user | host | endpoint, method, purpose |
| Credentials usable | **no** — the secret would have to enter the frame | yes, host injects, package never sees it |
| Auditable after install | no (arbitrary paths/bodies at runtime) | yes (calls are enumerable from disk) |
| Rate limiting / quota | no | host-enforced |
| Streaming, WebSockets | yes | no |

**Decided (§12.1): v1 ships the declarative path only; `connect-src` stays
`'none'` for packages.** This supersedes the raw-fetch half of roadmap P0.3, which
should be updated to point here. If a raw path is ever added, it must be a
separate, louder permission — never the same one.

## 4. Author experience (the thing being optimized)

A weather package, complete:

```
weather-mini/
  manifest.json
  api.json
  ui/index.html
```

`api.json`:

```json
{
  "schemaVersion": 1,
  "endpoints": [
    {
      "id": "forecast",
      "description": "Reads the current temperature for a location from Open-Meteo.",
      "method": "GET",
      "url": "https://api.open-meteo.com/v1/forecast",
      "query": {
        "latitude": { "type": "number", "required": true },
        "longitude": { "type": "number", "required": true },
        "current": { "type": "const", "value": "temperature_2m" }
      },
      "cache": { "ttlSeconds": 600 },
      "rate": { "minIntervalSeconds": 60 }
    }
  ]
}
```

`manifest.json` adds `"permissions": ["network.declared"]`.

The package's JS:

```js
const res = await kavibay.http("forecast", { latitude: 52.52, longitude: 13.405 });
if (!res.ok) return showError(res.code);
render(res.data.current.temperature_2m);
```

No Rust, no `lib.rs` entry, no CSP edit, no maintainer review round. That is the
DX target the rest of this document has to stay compatible with.

## 5. Declaration format

One `api.json` per package, sibling of `manifest.json`. Separate file on purpose:
it is the artefact a reviewer reads and the consent dialog renders.

### 5.1 Top level

| Key | Type | Rule |
|---|---|---|
| `schemaVersion` | number | must be `1`; unknown → reject package |
| `endpoints` | array | 1..32 entries, unique `id` |

Unknown keys anywhere → package `status: error` (fail closed). This is what keeps
the format auditable across releases.

### 5.2 Endpoint

| Key | Type | Rule |
|---|---|---|
| `id` | string | `[a-zA-Z][a-zA-Z0-9_]{0,63}`, unique |
| `description` | string | **required**, ≤ 160 chars — user-visible consent text |
| `method` | `"GET"` \| `"POST"` | v1 only these |
| `url` | string | absolute `https://`, no query, no userinfo, no IP literal; `{name}` allowed as a **whole path segment** |
| `path` | object? | one entry per `{name}` in `url`, exactly matching |
| `query` | object? | named query params |
| `body` | object? | `POST` only |
| `bodyType` | `"json"` \| `"form"` | default `json` |
| `headers` | object? | static values only, keys from an allowlist (`Accept`, `Content-Type`, `X-*` on request of the provider); `Authorization` is **rejected** — use `credential` |
| `credential` | string? | credential **type id** from the Rust registry |
| `cache` | `{ ttlSeconds }`? | host-side response cache, ≤ 24 h |
| `rate` | `{ minIntervalSeconds }`? | host-enforced floor between calls |

### 5.3 Parameter

| Key | Type | Rule |
|---|---|---|
| `type` | `string` \| `number` \| `boolean` \| `enum` \| `const` | — |
| `required` | boolean | default `false` |
| `value` | any | `const` only — not settable by the caller |
| `values` | array | `enum` only |
| `maxLength` | number | `string` only, default 256, hard cap 2048 |
| `description` | string? | shown in developer tooling, not in consent |

The parameter model is deliberately as small as `FieldDef` in the credential
registry — not JSON Schema. A full JSON Schema validator is a large surface that
would have to be implemented **twice** (FE and Rust, mirrored per AGENTS.md
invariant 4).

## 6. Security rules

These are not guidelines; a violation of any of them makes the feature a
liability rather than a convenience.

1. **The host is static.** Scheme, host, port and the static path come from
   `api.json` only. No caller value can influence them.

   Variable parts are `{name}` placeholders that occupy a **whole path segment**
   (`/repos/{owner}/{repo}`). Never part of the host, never a fragment of a
   segment like `/v1/user-{id}` — a partial segment would let one argument carry
   a separator's worth of meaning. Declaration and url must match exactly: an
   undeclared placeholder can never be filled, and an unused `path` param would
   claim an input that does nothing.

   Bound values are rejected if they contain `/`, `\`, `%`, control characters,
   or are `.`/`..`/leading-dot, and are then percent-encoded down to RFC 3986
   `unreserved`. A `?` or `#` inside an argument therefore becomes `%3F` / `%23`
   and cannot open a query or fragment.
2. **Redirects are not followed.** A 3xx is returned as `http_error` with the
   status. This closes redirect-to-internal without needing per-hop validation.
3. **No private network.** Reject non-`https`, reject IP-literal hosts, and
   reject resolution results in loopback / private / link-local / ULA /
   metadata-service ranges (extends the P0.5 hygiene already planned for
   `fetch_url_icon`). *Caveat to implement honestly:* checking after resolution
   leaves a DNS-rebinding TOCTOU window; the resolved address should be pinned
   for the connection, and the residual risk documented if it is not.
4. **Credentials are host-injected and separately granted.** `credential: "githubPat"`
   resolves through `credentials::resolve_for_type` and applies the type's
   `Injection` (Bearer today). The package never receives the token, and the user
   grants *this package* access to *that credential type* explicitly at enable
   time — owning a credential is not the same as sharing it.
5. **No secrets in URLs.** v1 refuses to place a credential into query or path,
   only into the `Authorization` header. Query strings end up in logs and error
   messages.
6. **No ambient authority.** No cookie jar, no `Set-Cookie` retention, no
   redirect of credentials to another host, no proxy/system auth.
7. **Bounded**: 10 s timeout, 1 MiB response cap, ≤ 4 concurrent calls per
   package, per-endpoint `minIntervalSeconds`, **and** a per-package daily call
   budget (default 500, shown and adjustable in Settings). Both layers exist on
   purpose: the interval protects a single endpoint from a tight poll loop, the
   budget protects the provider from an extension that spreads the same abuse
   over many endpoints. Bounds are enforced host-side; a package cannot raise
   them.
8. **Untrusted text.** `description` and every string in `api.json` are authored
   by a stranger. They are rendered as text, never HTML, and length-capped, in
   the consent dialog and the settings list.
9. **Logging.** Never log the full URL of a call that carries a credential;
   endpoint id + host only.

## 7. Runtime path

```
package JS
  └─ kavibay.http(endpointId, args)          runtime SDK (sdk/runtime)
       └─ postMessage  kavibay.ext.http.call bridge, frame-identity bound
            └─ FE bridge handler                   core/app/runtime
                 └─ invoke runtime_extensions_http_call
                      └─ Rust: look up declaration for extId (host-side scan
                         result, never the payload), validate args, resolve
                         credential, build request, enforce limits, fetch
```

Bridge additions, following the existing storage pattern in
`core/app/runtime/bridgeProtocol.ts`:

```ts
| { type: "kavibay.ext.http.call"; requestId: string; endpointId: string; args: unknown }
| { type: "kavibay.ext.http.result"; requestId: string; ok: true; status: number; data: unknown }
| { type: "kavibay.ext.http.result"; requestId: string; ok: false; code: ErrorCode; status?: number }
```

`extId` in the payload is ignored exactly as it is for storage today: the host
resolves the frame to an identity and looks the declaration up itself. The
package cannot call another package's endpoints, because it cannot name them.

### Binding errors (before any request is attempted)

`binding.rs` maps a call to a declaration and refuses anything that does not fit,
with `code:field` detail behind the `invalid_arguments` the package sees:

`unknown_argument:<name>` · `missing_argument:<name>` · `invalid_argument:<name>` ·
`argument_too_long:<name>` · `argument_charset:<name>` ·
`invalid_path_argument:<name>` · `const_not_settable:<name>`

An undeclared argument is an error, not a silently dropped filter — a typo in a
package should surface, not change what the request means.

### Error codes (stable, normalized)

`invalid_arguments` · `permission_denied` · `consent_stale` · `unknown_endpoint` ·
`not_configured` · `needs_reauth` · `rate_limited` · `budget_exhausted` ·
`blocked_address` · `http_error` (+ `status`) · `network_error` · `timeout` ·
`too_large`

`not_configured` / `needs_reauth` map straight onto `ResolveError` from the
credential layer, so a package can render "connect your account" without knowing
anything about auth.

## 8. Permission and consent

New permission id: **`network.declared`** — "may call the endpoints listed in its
`api.json`". `network.client` stays reserved for a possible future raw-fetch path
so the two can never be confused.

Enable flow (builds on P0.4's consent step):

> **weather-mini wants to:**
> · Read the current temperature for a location from Open-Meteo — `GET api.open-meteo.com`
> · Show workflow runs for a repository — `GET api.github.com`, using your **GitHub Personal Access Token** (the package never sees the token)
>
> [Cancel] [Enable]

Rules: declining leaves the package disabled; a changed `api.json` (content hash)
invalidates the grant and requires re-consent; credential grants are per package
and per credential type and revocable in Settings → Credentials, which is where
the user already looks.

Implemented in D1: enabling goes through a confirm step listing the permissions
in plain language plus every endpoint's purpose, method and hosts. The consented
declaration's SHA-256 is stored with the grant and recomputed from disk on every
call — a package that edits `api.json` afterwards gets `consent_stale` until the
user has seen the new endpoints and enabled it again. The hash is computed in
Rust from the bytes the backend will actually read, never taken from the
frontend.

Grants are Rust-owned (the store P0.3 already introduces), because Rust builds the
request and must not ask the frontend for permission.

## 9. Validation (before anything runs)

Mirrored: `core/app/runtime/apiDeclarationValidate.ts` and
`src-tauri/src/runtime_extensions/api_declaration.rs`, same rules, same codes,
per invariant 4. A package fails to scan when any of these fire:

| Group | Codes |
|---|---|
| Document | `declaration_not_object`, `schema_version_unsupported`, `invalid_endpoints`, `no_endpoints`, `too_many_endpoints`, `unknown_key:<scope>.<key>` |
| Endpoint | `invalid_endpoint`, `invalid_endpoint_id`, `duplicate_endpoint_id`, `missing_description`, `description_too_long`, `invalid_method`, `invalid_body_type`, `body_on_get`, `invalid_user_agent` |
| URL | `invalid_url`, `url_not_https`, `url_has_query`, `url_has_fragment`, `url_has_userinfo`, `url_is_ip_literal`, `url_has_placeholder`, `invalid_fallback_urls`, `too_many_fallback_urls` |
| Headers | `header_not_allowed:<name>`, `invalid_headers`, `too_many_headers` |
| Params | `invalid_params`, `invalid_param_name`, `invalid_param_type`, `invalid_param_max_length`, `invalid_charset`, `invalid_enum_values`, `invalid_const`, `too_many_params` |
| Placeholders | `url_partial_placeholder`, `url_placeholder_in_host`, `invalid_placeholder_name`, `duplicate_placeholder`, `undeclared_placeholder:<name>`, `unused_path_param:<name>`, `const_path_param:<name>`, `fallback_placeholder_mismatch` |
| Credential | `invalid_credential`, `unknown_credential_type:<id>` |
| Windows | `invalid_window` |

Unknown keys are an error, not a warning. A format that silently ignores what it
does not understand cannot be audited — the consent dialog would under-report
what the package does.

**Declaration and permission must agree**, checked during the package scan:

| Situation | Result |
|---|---|
| `api.json` present, `network.declared` granted | endpoints parsed, summaries attached to the scan row |
| `api.json` present, permission absent | `api_permission_missing` — a file appearing on disk must not grant a capability the user never saw |
| permission granted, no `api.json` | `api_declaration_missing` — consent would promise endpoints that do not exist |
| declaration invalid | `api:<code>` — the whole package is `error`, never partly usable |

## 10. Testing (security-first, mirroring the ipc-probe precedent)

- Mirrored validator tests (FE `.assert.ts`, Rust `#[cfg(test)]`) for every code
  in §9.
- Argument-binding unit tests: path segment escaping, `/` and `..` rejection,
  host immutability under hostile args, `const` params not overridable.
- SSRF unit tests: IP literals, private/loopback resolution, 3xx handling.
- Limit tests: size cap, timeout, `minIntervalSeconds`, concurrency.
- **`examples/http-probe/`** — a package that *tries to break out*: undeclared
  endpoint id, host override via args, redirect to `127.0.0.1`, 10 MiB response,
  credential without a grant, another package's endpoint id. Expected output is
  ALL BLOCKED, and it ships as the acceptance artefact the way `ipc-probe` did
  for IPC isolation.

## 11. Relationship to existing work

- **Credential layer** (`src-tauri/src/credentials/`): reused unchanged. `credential`
  in an endpoint is a type id from `registry.rs`; injection uses the same
  `Injection` enum. This design is the reason that enum exists as data.
- **P0.3**: superseded in part — hosts are derived from `api.json`, and raw fetch
  is dropped from v1 (§3, §12).
- **P0.4** (consent on enable): prerequisite; this design extends its dialog.
- **P0.5** (SSRF hygiene for `fetch_url_icon`): the address-range check should be
  one shared helper, not two.
- **P3** ("host-mediated command bridge, design when a real need appears"): this
  is that design, scoped to HTTP instead of arbitrary commands.
- **First-party extensions** may use the layer (decision 4). What that means
  per extension is section 11.1 — it is less than "migrate everything", and the
  reason is measured, not stylistic.

### 11.1 First-party migration scope

Decision 4 asks for the existing first-party extensions to move onto the layer.
Measured against what those modules actually do, the honest split is:

| Extension | Today | Verdict |
|---|---|---|
| **weather** | ~~2 keyless GETs via frontend `fetch`, 2 hosts in the CSP~~ | ✅ **Migrated** in D1: `extensions/weather/api.json`, and `connect-src` in `tauri.conf.json` is back to `ipc:` only. |
| **stocks** | ~~`stocks/mod.rs`, 98 lines~~ | ✅ **Migrated** in D4: `extensions/stocks/api.json` carries the browser-like User-Agent, the `query1`→`query2` failover and the symbol charset. `stocks/mod.rs` is gone. |
| **calendar** | multi-endpoint, pagination, nested JSON body | ❌ **Not migratable — my earlier estimate was wrong.** See below. |
| **github-actions** | `api.rs`, 571 lines: two endpoints, rate-limit headers → stable error prefixes, spotlight/job aggregation | **Keep Rust.** The requests are trivial; the value is in the aggregation and the rate-limit-aware polling, which is not fetch logic. |
| **tado** | shared cross-instance cache, paced polling against a 100 calls/day budget, bulk `zoneStates` → view models | **Keep Rust.** The per-package budget covers the quota, but the shared cache and pacing across widget instances are app logic. |
| **ask-llm** | SSE streaming | **Keep Rust.** Streaming is a §2 non-goal. |

The cost that makes the difference: migrating a first-party extension moves its
response parsing from tested Rust into the widget's TypeScript. For weather that
is free (the parsing is already in TS). For github-actions and tado it would
trade ~1000 lines of covered Rust for new TS with no user-visible benefit — the
opposite of why this layer exists.

**Correction on calendar (found while implementing D4).** I wrote that its
list/create calls "fit" once the 401 refresh-retry existed. Reading
`calendar/google/api.rs` again while migrating, they do not, and the reasons are
§2 non-goals rather than missing features:

- `list_events` iterates over the selected calendars **and** follows Google's
  `pageToken` until the pages run out — a loop over dependent requests.
- It first fetches `calendarList` to colour the events, so one call feeds the
  next.
- `create_event` posts a **nested** JSON body (`start: { dateTime }`), while the
  parameter model carries scalars only.

Adding loops, chaining and nested bodies to the format to fit one integration is
exactly the growth §2 exists to prevent. Calendar stays in Rust; the 401
refresh-retry from addition (d) shipped anyway, because it belongs to any
credential endpoint.

**Format additions required by this decision** (not part of the v1 sketch above;
each is small and none of them weakens section 6):

- **(a) `userAgent`** per endpoint — a fixed string from the declaration, shown
  in consent. Needed by Yahoo; useful generally. Still host-controlled: the
  package cannot set it at call time.
- **(b) `fallbackUrls`** — an ordered list of alternates tried on network error
  or 5xx only. Every entry is validated exactly like `url` (https, static host,
  no IP literal), and all of them are listed in the consent dialog.
- **(c) parameter `charset`** — `"alnum" | "alnumDash" | "alnumDot" | "alnumSymbol"`
  instead of a regex. Deliberately not a regex: it would need two compatible
  implementations (FE + Rust, invariant 4) and brings ReDoS into a validator that
  runs on untrusted input.
- **(d) one automatic retry after 401 for credential endpoints** — host calls
  `oauth::force_refresh` and retries once, exactly as `with_auth_retry` does today
  for calendar and `get_with_retry` for tado. This belongs in the layer regardless
  of the migration: the host owns the credential, so it is the only party that
  can refresh it.

With (a)–(d) the migration list becomes: weather and stocks fully, calendar's
data calls, and three extensions that stay in Rust with the reason recorded
above. Recommendation: do weather in D1 as the proof, stocks in D4, and revisit
calendar only after the layer has run in production for a release.

## 12. Decisions (maintainer, 2026-08-01)

1. **Raw `fetch` for packages is dropped in v1.** ✅ Packages reach the network
   only through declared endpoints; `connect-src` stays `'none'`. This supersedes
   the raw-fetch half of roadmap P0.3, which should be updated to point here.
2. **Both limits.** ✅ Per-endpoint `minIntervalSeconds` *and* a per-package daily
   budget (default 500) — see §6.7 for why one does not replace the other.
3. **`form` bodies ship in v1.** ✅ `bodyType: "json" | "form"`, one encoder, no
   new attack surface.
4. **First-party may use the layer, and existing extensions migrate** — scoped in
   §11.1. Three of six move (weather now, stocks and calendar's data calls after
   format additions a–d); github-actions, tado and ask-llm stay in Rust because
   their value is aggregation, pacing and streaming rather than the request.
   Forcing those three would trade tested Rust for new TypeScript with no
   user-visible gain.
5. **Ask-LLM tools: later, not now.** ✅ The declaration shape stays close to a
   tool definition so the option survives, but nothing is built for it. When it
   happens, arguments arrive from a model — untrusted input — and §6.1 (static
   host, no caller influence on scheme/host/port) stops being good practice and
   becomes the only defence. Re-review §6 in full at that point.

## 13. Rollout

| Step | Content | Done when |
|---|---|---|
| D0 ✅ | Format frozen, mirrored validators, scan integration, `network.declared` | Validator tests green both sides |
| D1 | Host proxy for credential-free endpoints + consent listing; **weather migrates** off its frontend `fetch` | `http-probe` all blocked, and both open-meteo entries are gone from the main-window CSP |
| D2 | Credential binding + per-package grants + revoke UI | Probe's ungranted-credential case blocked |
| D3 | `sdk/runtime` helper, `docs/runtime-packages.md`, format versioning policy | An outside author can ship a package without reading Rust |
| D4 | Format additions (a)–(d) from §11.1, then stocks migrates off `stocks/mod.rs` | Yahoo failover + UA work declaratively; `stocks/mod.rs` deleted |

### 13.1 What D0 shipped

- `src-tauri/src/runtime_extensions/api_declaration.rs` — format, validation,
  consent summaries, `is_safe_path_segment`.
- `core/app/runtime/apiDeclarationValidate.ts` (+ `.assert.ts`) — the mirror.
- Package scan reads `api.json`, cross-checks it against `network.declared`, and
  surfaces `apiEndpoints` on the scan row for the D1 consent dialog.
- `network.declared` added to both permission catalogues.

One rule moved from prose into code because a test caught it: a `charset` is a
character *class* and nothing more — `alnumDot` accepts `".."` by definition. Path
binding therefore needs `is_safe_path_segment` **in addition to** the declared
charset, and both are now tested on both sides so D1 cannot forget it.

No request is performed anywhere in D0. `api.json` is inert until D1.

### 13.2 What D1 shipped

| Piece | File | Note |
|---|---|---|
| Placeholder redesign | `api_declaration.rs` + TS mirror | `path` params were "appended to the url", which has no defined order for `/repos/{owner}/{repo}`. Found while writing the binder, fixed before it could ossify. |
| Argument binding | `binding.rs` | Pure and synchronous: type/charset/length/enum/required, const protection, path-segment safety plus percent-encoding, query/body encoding. |
| Grant store | `installs.rs` | Rust-owned `installs.json`, one-time import from `localStorage`. Also fixes: clearing the webview profile wiped every grant. |
| Address classification | `net_guard.rs` | Loopback, private, link-local (incl. the metadata address), CGNAT, ULA, IPv4-mapped v6. |
| Limits and cache | `limits.rs` | `minIntervalSeconds` per endpoint, 500/day per package, per-request cache; a cache hit costs no budget. |
| Executor | `http.rs` | No redirects, 10 s timeout, 1 MiB streamed cap, vetted address pinned for the connection, fallbacks on network error and 5xx only. |
| Bridge + SDK | `bridgeProtocol.ts`, `RuntimeExtensionFrame.vue`, `sdk/runtime/` | `kavibay.http(id, args)`; `extId` comes from frame identity, never the payload. |
| Consent listing | `RuntimeExtensionsPanel.vue` | Purpose, method, hosts and credential of every endpoint, before the package can be enabled. |
| Acceptance artefact | `examples/http-probe/` | Nine breakout attempts plus one declared control call. |
| First-party path | `first_party.rs` | Declarations compiled in with `include_str!`; `weather` migrated. |

Two decisions worth recording, both made while implementing:

- **A fresh HTTP client per call.** Pinning the vetted address (`.resolve(host, addr)`)
  is per-client in reqwest, so pooling was traded for knowing exactly which
  address is dialled. Declared endpoints are rate-limited anyway, and the
  alternative was the DNS-rebinding window §6.3 warns about.
- **The attempt is counted before the request goes out**, so an endpoint that
  fails cannot be retried without limit.

### 13.3 What D2 shipped

- **Per-package credential grants.** `InstallRecord.granted_credentials` holds
  credential *types*, granted at consent time and filtered against the
  declaration on disk — the frontend can list what it likes, the backend only
  keeps what the endpoints actually reference.
- **Host-side injection.** The executor resolves through
  `credentials::resolve_for_type` and applies the type's `Injection` to the
  request last, so a declared header cannot shadow it. The package receives the
  response, never the token.
- **One refresh-retry on 401.** Only the host can refresh, so it does — exactly
  once — then gives up with `credential_needs_reauth`. This is addition (d) from
  §11.1, and it also unblocks calendar's data calls.
- **Revocable where the user already looks.** Settings → Credentials lists the
  packages holding a grant with a Revoke button. Revoking is not disabling: the
  package keeps running and loses one capability.
- New codes: `credential_not_granted`, `credential_not_configured`,
  `credential_needs_reauth`, `credential_error`.

The credential is resolved *after* the rate-limit check, so a package cannot spin
the credential layer — and its token refreshes — faster than its own limit.

### 13.4 What D3 and D4 shipped

- **`docs/runtime-packages.md`** — the author guide: quick start, the endpoint and
  parameter reference, what the host guarantees so the author does not have to,
  the error table, credential use, the rules that fail a package, and how to run
  the probes.
- **Format versioning policy** (in that guide): unknown keys are an error;
  additive changes keep `schemaVersion: 1`; a breaking change bumps it and the
  previous version keeps working for at least one release; editing a shipped
  `api.json` requires re-consent, so declaration changes belong in a version bump.
- **stocks migrated** — `extensions/stocks/api.json` with the browser-like
  User-Agent, the `query1`→`query2` failover and `charset: alnumSymbol` for the
  symbol; `src-tauri/src/stocks/` deleted.
- **calendar was not migrated**, see the correction in §11.1.

The daily budget is a stored setting now: it lives in the same Rust-owned
`installs.json`, is clamped to 10–10000 on the way in (a budget of zero would
only look like a broken widget, and a typo should not switch the limit off), and
Settings → Extensions shows it together with what each package has used today —
a number without feedback is impossible to set sensibly.

**Nothing from the rollout is open.** What is left is the manual run: the probe
must report ALL BLOCKED, and weather and stocks must still load with no
`connect-src` entries. No test in this repo substitutes for that.

## 14. Success criteria

- A new data widget with one API call needs **zero** Rust and zero host changes.
- A user can name, before enabling, every host the package will contact and why.
- A package using a credential can be observed to never receive the secret
  (probe artefact).
- The format has not grown a transformation language.
