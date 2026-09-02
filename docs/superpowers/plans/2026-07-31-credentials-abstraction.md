# Credentials Abstraction Plan

Date: 2026-07-31
Status: **implemented 2026-08-01** (phases 0-5). Verification and deliberate
deferrals are recorded per phase and in section 7.

**Goal:** Replace four hand-rolled credential implementations (Google Calendar OAuth,
Tado device-flow OAuth, GitHub PAT, Cloudflare API token) with one credential layer:
declarative **credential types** in Rust, one encrypted **credential store**, one
**generic settings UI**, and extensions that only *declare* which credential type they
need — n8n's model, shrunk to what this app actually needs.

**Non-goal:** giving extensions access to secret values. Invariant 5 (AGENTS.md) stays:
plaintext never leaves Rust. "The extension defines what it needs" means it declares a
credential *type* and receives a *credential id*, never a token.

---

## 1. Where we are today

| Integration | Auth shape | Storage | Backend code | Settings UI |
|---|---|---|---|---|
| Google Calendar | OAuth2 auth-code + PKCE, loopback redirect, user-supplied client id/secret | `calendar.db`: `oauth_tokens` + `oauth_app_credentials` | `calendar/google/auth.rs` (1260 lines), `calendar/db.rs` (310) | `GoogleCalendarPanel.vue` (427) |
| Tado | OAuth2 device code, built-in public client id | `tado.db`: `auth` single row | `tado/auth.rs` (519), `tado/db.rs` (289) | `TadoPanel.vue` |
| GitHub Actions | PAT (one secret field) | `github_actions.db`: `credentials` single row | `github_actions/db.rs` (150) | `GithubActionsPanel.vue` |
| Cloudflare AI | Account ID (public) + API token (secret) | `cloudflare_ai.db`: `credentials` single row | `cloudflare_ai/db.rs` (189) | `CloudflareAiPanel.vue` |

Duplication that hurts today:

- **Four SQLite files, four schemas, four migrate functions** for the same concept.
- **Two OAuth implementations that diverge in quality.** `calendar/google/auth.rs` has
  carefully reasoned generation counters closing four concrete races
  (cancel/disconnect/supersede/refresh-in-flight). `tado/auth.rs` has none of that —
  the same races exist there, unsolved. That is the strongest argument for this work:
  the abstraction is how the good implementation reaches the other integrations.
- **Fifteen credential-related Tauri commands** (`calendar_auth_*`,
  `calendar_google_*_app_credentials`, `tado_auth_*`, `github_actions_*_token`,
  `cloudflare_ai_*_credentials`), each with a bespoke status payload shape.
- **~1400 lines of near-identical Vue** across four settings panels (save/clear fields,
  connect/cancel/disconnect, status polling, error + feedback lines).
- Adding a fifth integration today = new db module + new auth module + 3–4 commands +
  a new panel + a new `lib.rs` block.

## 2. Is it possible? Does it make sense?

**Possible: yes.** Nothing in the current design blocks it. All four integrations
already funnel secrets through `security/secrets.rs`, all four store to app-data
SQLite, all four are read exclusively by Rust API modules. The abstraction is a
refactor behind existing seams, not a rewrite.

**Sensible: yes, with a boundary.** AGENTS.md warns against speculative abstraction
layers. This one is not speculative: three genuinely different auth shapes across four
integrations, with a fifth (any new API) already predictable. The rule of three is met.

What makes it pay off:

- One OAuth engine, written once with the calendar module's race handling, inherited by
  every OAuth integration (fixes Tado's races as a side effect).
- One storage + encryption path — invariant 5 becomes structurally enforced instead of
  re-argued per integration.
- One settings UI, so a new integration ships without new Vue.
- A new integration becomes: one type definition (~40 lines of Rust data) + the API
  module that actually does the work.

Where it would *not* pay off, and is therefore explicitly out of scope:

- **API request logic stays bespoke.** Calendar/Tado/GitHub/Cloudflare request builders,
  parsers, and caches stay exactly where they are. Only credential acquisition is shared.
- **No n8n feature copying**: no credential sharing/permissions, no "Details" tab, no
  per-node dynamic field resolution, no external secret vaults.
- **No multi-tenant workflow model.** Kavibay has one user, one machine.

The honest cost: this touches every integration's auth path, including the most
race-sensitive file in the repo. It is a multi-session refactor with no new user-facing
feature at the end (except the nicer credentials UI). If the goal for the next weeks is
features, this is a deliberate detour — worth doing before integration #5, not after #10.

## 3. Target architecture

### 3.1 Credential type (declarative, Rust-owned)

```rust
// src-tauri/src/credentials/types.rs (sketch — not final API)
pub struct CredentialTypeDef {
    pub id: &'static str,                 // "googleCalendarOAuth2", "githubPat", …
    pub display_name: &'static str,       // "Google Calendar OAuth2 API"
    pub docs_url: Option<&'static str>,   // "Need help? Read our docs" link
    pub fields: &'static [FieldDef],      // user-entered inputs
    pub auth: AuthKind,
    pub inject: Injection,                // how the secret reaches an HTTP request
    pub test: Option<TestRequest>,        // optional "Test connection"
}

pub struct FieldDef {
    pub key: &'static str,                // "clientId", "accountId", "token"
    pub label: &'static str,
    pub kind: FieldKind,                  // Text | Password | Select { options }
    pub required: bool,
    pub placeholder: Option<&'static str>,
    pub help: Option<&'static str>,
}

pub enum AuthKind {
    /// Fields alone are the credential (GitHub PAT, Cloudflare token).
    Static,
    /// Browser consent + loopback redirect + PKCE (Google).
    OAuth2AuthCode {
        auth_url: &'static str,
        token_url: &'static str,
        scopes: &'static str,
        /// Where client id/secret come from: user fields or a built-in constant.
        client: ClientSource,
        /// Endpoint + JSON pointer used to label the account ("connected as …").
        identity: Option<IdentityProbe>,
    },
    /// RFC 8628 device flow (Tado).
    OAuth2DeviceCode { device_url, token_url, scopes, client, identity },
}

pub enum Injection {          // n8n's `authenticate` block, trimmed
    BearerToken,                                   // Authorization: Bearer <token>
    Header { name: &'static str, value: &'static str }, // "{{token}}" templating
    None,
}
```

Types are a static registry (`credentials/registry.rs`), one entry per integration.
Schemas (labels/field kinds/urls — **never values**) serialize to the frontend so the
generic UI can render the form. This is precisely what the n8n screenshot shows: a
schema-driven form plus a type-specific connect affordance.

### 3.2 Storage — one store, one blob

New `credentials.db` under app data:

```sql
CREATE TABLE credentials (
  id           TEXT PRIMARY KEY,   -- uuid
  type_id      TEXT NOT NULL,      -- FK into the static registry
  name         TEXT NOT NULL,      -- "Google (private)"
  account_label TEXT,              -- non-secret display value ("alex@…", home name)
  state        TEXT NOT NULL,      -- 'unconfigured' | 'connected' | 'needs_reauth'
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE credential_secrets (
  credential_id TEXT PRIMARY KEY REFERENCES credentials(id) ON DELETE CASCADE,
  data_protected TEXT NOT NULL     -- DPAPI blob of a JSON object
);
```

`data_protected` holds **one JSON object per credential**: user fields plus OAuth token
state (`accessToken`, `refreshToken`, `expiresAt`). One blob keeps the schema stable when
a type gains a field, and gives exactly one encrypt/decrypt call site. Non-secret display
data stays in the plaintext row so list/status views never decrypt.

Schema supports N credentials per type from day one; the V1 UI can present "one per
type" and still store a credential id everywhere, so multi-account arrives later without
a migration.

### 3.3 Generic auth engine

- `credentials/oauth/auth_code.rs` — port of `calendar/google/auth.rs`, generalized over
  `OAuth2AuthCode`. **Port the generation-counter logic and its unit tests verbatim**;
  they encode four real race fixes and must not be re-derived.
- `credentials/oauth/device_code.rs` — port of `tado/auth.rs`, wired to the same
  generation discipline (this is where Tado gains the missing race handling).
- `credentials/resolve.rs` — the single entry point for API modules:

```rust
/// Returns a ready-to-use secret bundle, refreshing OAuth tokens when needed.
pub async fn resolve(app: &AppHandle, credential_id: &str) -> Result<ResolvedCredential, String>;
```

`ResolvedCredential` exposes `bearer()` / `field("accountId")` / `apply(&mut RequestBuilder)`
(via `Injection`) — backend only, never serialized.

### 3.4 Generic commands (replace 15 with 7)

| Command | Returns |
|---|---|
| `credential_types_list` | schema list (no values) |
| `credentials_list` | id, typeId, name, state, accountLabel, configured fields' *presence* |
| `credentials_save` | upsert `{ id?, typeId, name, fields }` |
| `credentials_delete` | — |
| `credentials_oauth_start` / `_cancel` | starts/cancels consent for one credential id |
| `credentials_status` | one credential's state (poll target while pending) |
| `credentials_test` | runs `TestRequest`, returns ok/error message |

Every existing per-integration credential command is deleted at the end of the arc.
Integration data commands (`calendar_list_events`, `tado_snapshot`, …) stay, but take
the credential id they should use instead of assuming a singleton.

### 3.5 Extension-facing contract

Manifest gains a declaration — the "extension defines what it needs" part:

```json
"credentials": [{ "type": "googleCalendarOAuth2", "required": true }]
```

Effects, all host-side:

1. Palette/gallery can mark a widget "needs setup" when no credential of that type is
   connected, and deep-link to the credential editor.
2. The widget instance stores a bound `credentialId` (same mechanism as other instance
   state); the extension passes it to its Rust command.
3. Validation mirrored FE + Rust (invariant 4): unknown type id → manifest error.

The extension never sees a secret. For **runtime (sandboxed) packages** this stays
disallowed in V1 — the current roadmap already states "no credential access for
runtime". The `Injection` descriptor exists so a future host-mediated authenticated
fetch (roadmap P3) can reuse the same type definitions.

### 3.6 Generic UI

- `core/app/settings/credentials/CredentialsPanel.vue` — list (n8n-style): name, type,
  status, last updated; add/edit/delete.
- `CredentialEditor.vue` — renders `fields` from the schema, plus the type's connect
  affordance: Static → save/clear; AuthCode → Connect / Cancel / Disconnect + status;
  DeviceCode → the code + verification URL panel. Optional "Test" button.
- The four bespoke panels are deleted; Settings → Integrations keeps per-integration
  entries only where an integration has *non-credential* settings.

---

## 4. Phased plan

Each phase is independently shippable and leaves the app fully working. Order is chosen
so the risky OAuth port happens *after* the store and UI have been proven by boring
integrations.

### Phase 0 — Registry skeleton (done)
- [x] `credentials/{mod,types,registry}.rs` with the type model + type defs for all four
      integrations. No storage, no call-site changes yet.
- [x] `credential_types_list` command + `cargo test` for registry invariants (unique
      ids, unique field keys, OAuth endpoints declared, and injection/test templates
      that may only reference declared fields).
- [~] No separate design spec: this document carries the design, and a second one
      would only duplicate `types.rs`, whose doc comments are the contract.

### Phase 1 — Store + generic UI, migrate GitHub PAT (done)
- [x] `credentials/db.rs`: schema above, one DPAPI blob, tests incl. "secrets are
      not plaintext at rest".
- [x] `credentials_list/save/delete/status/test` + `credentials_configured` commands.
- [x] `CredentialsPanel.vue` + `CredentialEditor.vue` + `credentialsLogic.assert.ts`.
- [x] Lazy migration (`credentials/import.rs`): reads `github_actions.db` once,
      records the import, leaves the old file untouched.
- [x] `github_actions/commands.rs` resolves via `credentials::resolve_for_type` and
      keeps the widget's stable `no_token` error code.
- [x] Deleted `github_actions/db.rs`, the three token commands, `GithubActionsPanel.vue`.

### Phase 2 — Cloudflare (multi-field, mixed secret/non-secret) (done)
- [x] Type def with `accountId` (Text, non-secret) + `apiToken` (Password).
- [x] Lazy migration from `cloudflare_ai.db`; `api.rs` attaches the token through the
      type's declared injection instead of its own `bearer_auth`.
- [x] Deleted `cloudflare_ai/db.rs`, the three credential commands and
      `CloudflareAiPanel.vue`; the ask-llm widget gates on `credentials_configured`.

### Phase 3 — OAuth auth-code engine, migrate Google Calendar (done)
- [x] Ported `calendar/google/auth.rs` to `credentials/oauth/{mod,auth_code}.rs`,
      generic over the type def. Every generation-counter regression test moved with
      it: a per-credential `Arc<Mutex<Inner>>` keeps the helper signatures, so the
      test bodies port essentially verbatim. PKCE vectors moved too.
- [x] Two-stage credential: client id/secret are fields, tokens live in the same
      protected blob. Changing a client field drops tokens issued for the old client.
- [x] Lazy migration from `calendar.db` without re-consent — and a security upgrade
      on the way: the legacy `oauth_tokens` rows were **plaintext**, the imported
      blob is DPAPI-protected.
- [x] `calendar/google/mod.rs` resolves through the layer; a 401 triggers
      `oauth::force_refresh` exactly once, as before.
- [x] Deleted `calendar/google/auth.rs`, `calendar/db.rs`, seven calendar auth
      commands and `GoogleCalendarPanel.vue`. `needsReauth` is persisted state now
      instead of in-memory, so it survives a restart.

### Phase 4 — Device-code engine, migrate Tado (done)
- [x] `credentials/oauth/device_code.rs` on the shared generation discipline. This is
      where tado *gains* the four race fixes it never had, and where a failed refresh
      marks `needsReauth` instead of silently deleting the account.
- [x] Editor and widget panel show the user code and open the pre-filled URL; a
      background failure surfaces through `CredentialSummary.error`.
- [x] Lazy migration from the `tado.db` `auth` row including `homeId`/`homeName` as
      credential metadata (a fresh login captures the same via the identity probe).
      `api_quota` stays in `tado.db`.
- [x] Deleted `tado/auth.rs`, four auth commands and the auth half of `TadoPanel.vue`
      (which keeps "Add all rooms"). Cache invalidation moved from an explicit
      disconnect call to a home-id check, which also covers account switches.

### Phase 5 — Extension contract + cleanup (done, with deferrals)
- [x] Manifest `credentials[]` + `sdk/extension/types.ts`; all four integration
      extensions declare their type. Sandboxed packages are **rejected** for
      declaring credentials, mirrored FE and Rust (invariant 4), tested on both sides.
- [x] Docs: `docs/extensions.md` Credentials section; AGENTS.md invariant 5 and the
      architecture bullet.
- [ ] **Deferred: palette/gallery "needs setup" badge.** Each affected widget already
      renders its own setup state from `credentials_configured` /
      `credentials_type_status`; the badge is new UI surface, not part of this layer.
- [ ] **Deferred: per-instance `credentialId` binding.** Store and commands already
      take an id, so this is UI-only work. Building it before a second account exists
      is the speculative layer AGENTS.md warns about.
- [ ] **Deferred by design: deleting the legacy dbs.** They are read once and never
      written again; removing the files belongs one release after this ships.

Rough size: Phase 0–2 one session each, Phase 3 two (the port + careful verification),
Phase 4 one, Phase 5 one.

## 5. Migration rules (non-negotiable)

- **No user re-authentication.** Every migration is lazy on first read, mirroring the
  P0.1 pattern already used for plaintext→DPAPI.
- Old dbs are read, never written, after migration; deletion is a separate later step.
- A failed migration must fail closed (error surfaced in the editor), never silently
  create an empty credential that looks configured.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Losing the calendar race fixes in the port | Move the tests first, port under them; the generation counters are the contract |
| Generic type model too weak for the next API (e.g. HMAC-signed requests, refresh-less tokens) | `AuthKind` is an enum, not a plugin system — adding a variant is cheap and reviewable |
| Big-bang refactor stalls half-done | Phases are per-integration and each ends with the old path deleted |
| Over-generic UI feels worse than the bespoke panels | Editor keeps per-`AuthKind` sections; if a type ever needs bespoke UI, the type def can name a custom component |
| Users with existing connections break on upgrade | Lazy migration + explicit manual smoke test per phase before the old code is deleted |

## 7. What shipped, measured against section 1

| Before | After |
|---|---|
| 4 SQLite files, 4 schemas | 1 `credentials.db` (`tado.db` keeps only its API-call quota) |
| 2 divergent OAuth implementations | 1 engine, 2 flows, one set of race fixes |
| 15 credential commands | 10 generic ones (7 manage, 3 widget-facing reads) |
| ~1400 lines across 4 settings panels | `CredentialsPanel` + `CredentialEditor`, ~500 lines incl. CSS |
| Google tokens plaintext at rest | every credential inside one DPAPI-protected blob |
| New integration = db + auth + commands + panel | new integration = one registry entry |

Verified: `cargo test --lib` 147 passed (baseline 105), `npm run build` green,
`credentialsLogic.assert.ts` and `manifestValidate.assert.ts` green, sandbox guard green.

**Not verified: a manual smoke test with the real accounts.** The lazy imports are
covered by unit tests against replica schemas, but nobody has yet confirmed on the
live machine that GitHub, Cloudflare, Google and tado each come back connected on
first start without a new login. That is the remaining acceptance step.

## 8. Open decisions (recommendation first)

1. **Multiple credentials per type?** → Store supports N now, UI ships single-per-type,
   per-instance binding in Phase 5. Cheap now, expensive to retrofit.
2. **One `credentials.db` vs tables in existing dbs?** → One db. Single encryption path,
   single backup/migration story.
3. **Declarative `Injection`/`TestRequest` now?** → Yes as data, used by Static types
   (Phases 1–2). Do not force the calendar/tado API modules through it.
4. **Runtime packages get credentials?** → No in V1; design stays compatible with a
   future host-mediated fetch (roadmap P3).
5. **Do this before or after the pending hardening items (P0.3–P0.5)?** → Recommendation:
   after P0.3/P0.4 (they are security fixes with users already exposed), before the next
   new integration.
