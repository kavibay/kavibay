# Architecture & Security Hardening Plan

Date: 2026-07-23  
Scope: findings from the full-architecture review (Fable 5). Decisions locked with Alex:
**sandbox-first** for community widgets, **implement `network.client` for real**,
**macOS soon** (abstract secret storage now), **CI = PR checks + release builds**.

## Strategic direction

Community contributions run primarily as **sandboxed runtime packages**
(`{appData}/extensions/`). First-party extensions under `src/extensions/` keep full
IPC privileges and stay reserved for the core team. Consequences:

- The runtime package SDK/DX is the main investment (P2) — it is the community's path.
- CONTRIBUTING.md states this policy explicitly; first-party PRs are the exception and
  get the strict review checklist.
- Powerful commands (`launch_path`, `send_virtual_key`, clipboard, tokens) remain
  acceptable in the main webview because only first-party code runs there.

## P0 — Security fixes

### P0.1 Unify secret protection (HIGH) — ✅ done 2026-07-23

Today: GitHub PAT + Google credentials are DPAPI-wrapped; **tado refresh tokens and
Cloudflare API tokens sit in plaintext SQLite** (`tado/db.rs`, `cloudflare_ai/db.rs`).

- Extract the DPAPI wrapper (duplicated in `github_actions/secret_protect.rs` and
  `calendar/secret_protect.rs`) into one shared module `src-tauri/src/security/secrets.rs`.
- Design the interface for a per-OS backend now (`protect_bytes` / `unprotect_bytes`);
  the macOS port adds a Keychain backend (or swaps to the `keyring` crate) behind the
  same interface without touching call sites.
- Migrate `tado` and `cloudflare_ai` storage with **lazy migration**: on read, try
  `unprotect`; on failure treat the value as legacy plaintext and re-save protected.
  No user-visible re-auth.
- Verify: cargo tests for roundtrip + lazy-migration path; manual: existing tado /
  Cloudflare connections survive an app restart.
- Done: shared module `src-tauri/src/security/secrets.rs` (github/calendar duplicates
  deleted, imports repointed); tado (`access_token` + `refresh_token`) and Cloudflare
  (`api_token`) now protect-on-save with lazy migration in `load_*`. 105 lib tests green
  incl. `tokens_are_not_plaintext_at_rest` + `legacy_plaintext_row_migrates_on_load`.
  Real DBs migrate on next app restart once a widget/settings read loads the row.

### P0.2 Prove iframe ↔ IPC isolation (MEDIUM) — ✅ done 2026-07-23

The sandbox model assumes runtime frames can never reach Tauri IPC. That assumption is
load-bearing and untested (WebView2 can inject init scripts into subframes).

- Add a dev-only probe package (`docs/templates/ipc-probe/`): its entry script checks
  `window.__TAURI_INTERNALS__`, `window.ipc`, `window.chrome?.webview` and renders the
  result; document the expected all-blocked output in the runtime design spec.
- Add a CI guard that fails if `RuntimeExtensionFrame.vue` ever contains
  `allow-same-origin` (grep-based assert).
- If the probe shows any IPC reachability: stop-ship for runtime extensions until fixed.
- Done: probe package under `docs/templates/ipc-probe/` (no permissions; PASS = blocked
  for Tauri internals, `ipc`, `chrome.webview`, `parent`/`top` document access).
  CI guard `scripts/runtimeSandboxGuard.assert.mjs` requires static
  `sandbox="allow-scripts"` and rejects the same-origin token anywhere in
  `RuntimeExtensionFrame.vue` (comments reworded so the grep stays honest).
  Design spec + `docs/extensions.md` document expected ALL PASS output and install
  steps. Automated verify green (`vue-tsc`, guard script, 105 lib tests). Manual
  probe UI confirmation still needed once Developer Extensions enables the package.

### P0.3 Implement `network.client` with per-package CSP (MEDIUM)

Today the permission is granted but the static frame CSP (`connect-src 'none'`) makes it
a no-op.

- Manifest: `network: { allowedHosts: ["api.example.com", …] }` — https only, exact
  hosts (no wildcards), valid only together with the `network.client` permission.
  Reject otherwise at scan time (fail-closed, both FE and Rust validators).
- Move install/grant records from localStorage to a **Rust-owned store**
  (`{appData}/extensions/installs.json`, commands `runtime_extensions_installs_get/set`).
  Rust must know grants so the protocol handler can build the CSP; FE becomes a view.
  (Also fixes: clearing the webview profile silently wiped grants.)
- Protocol handler: when serving the package HTML, emit
  `connect-src https://<host1> …` for granted packages, `'none'` otherwise.
- Verify: Rust tests for CSP assembly + validator rejections; probe package that fetches
  an allowed host (succeeds) and a non-listed host (CSP-blocked).

### P0.4 Permission consent on enable (LOW)

Enabling a package currently auto-grants everything grantable from its manifest.

- Enable flow shows a confirm step listing requested permissions and, for
  `network.client`, the exact hosts. Confirm → grant; cancel → stay disabled.

### P0.5 Small hardening (LOW, batchable)

- `fetch_url_icon`: reject hosts that are IP literals in loopback/private/link-local
  ranges (SSRF hygiene).
- Main-window CSP: drop `http:` from `img-src` (keep `https:` + local schemes) unless a
  widget demonstrably needs it.
- FE manifest validation: folder ≠ `manifest.id` becomes a hard error (Rust already
  rejects; FE only warns).

## P1 — Contributor foundation

### P1.1 CI (GitHub Actions)

- `ci.yml` (PR + push, windows-latest; macos-latest as non-required job until the port):
  `npm ci` → `vue-tsc --noEmit` → ESLint → all `*.assert.ts` → `cargo fmt --check` →
  `cargo clippy -- -D warnings` → `cargo test`.
- `release.yml` (tag push): NSIS build (`npm run package:win`), installer uploaded as
  GitHub Release artifact.

### P1.2 Lint + format + import boundaries

- ESLint flat config (`eslint-plugin-vue`, `typescript-eslint`) + Prettier defaults.
- Boundary rules (the SDK contract, machine-enforced):
  - `src/extensions/**` may import only: its own folder, the SDK barrel (P2.1), `vue`,
    `@tauri-apps/*`.
  - Cross-extension imports: forbidden.
  - Deep `src/core/**` imports from extensions: forbidden.
  - `src/core/**` must not import from `src/extensions/**` (except the glob loader).

### P1.3 Test aggregation

- `npm run test:assert` — runner script that globs `src/**/*.assert.ts` and executes
  each via `tsx`, failing on first error.
- `npm run verify` — typecheck + lint + assert + `cargo test`. CI and humans run the
  same entry point.

### P1.4 CONTRIBUTING.md

- Sandbox-first policy (community = runtime packages; first-party = core team).
- Tier table (S/M/L) from the skill, PR checklist: manifest honest (commands/permissions
  match reality), no secrets in FE storage, secrets via `security/secrets.rs`, no new
  main-CSP entries without review, `.assert.ts` for pure logic, `lib.rs` merge etiquette
  (one line per command, keep module groups sorted).
- Data-fetch rule: prefer a Rust command; FE direct fetch only for keyless public APIs
  and only with an explicit CSP review.

## P2 — SDK formalization

### P2.1 First-party SDK barrel

- `src/sdk/index.ts` + Vite/TS alias `@sdk`: exports exactly the stable surface —
  extension types, `createInstanceStore`, `instanceStorageKey`, `useWidgetData`
  (+ theme tokens when extracted). Extensions migrate mechanically; boundary rules
  (P1.2) then enforce that this is the only core import path.
- Document the surface + change policy (semver-ish discipline) in `docs/extensions.md`.

### P2.2 Runtime package SDK (the community path)

- `kavibay-ext-sdk` (single JS file + `.d.ts`, copied into packages): ready handshake,
  `storage.get/set`, typed error results — wraps the postMessage bridge so authors never
  hand-roll protocol messages.
- Update `docs/templates/runtime-extension-s/` to use it; write
  `docs/runtime-packages.md`: quick start, permission model incl. `network.allowedHosts`,
  sandbox limits (no IPC, no top-navigation), debugging tips.

### P2.3 Manifest honesty check

- Assert script (CI): grep each first-party extension for `invoke("…")` and require the
  called names ⊆ `manifest.commands`. Regex-based, documented limitation.

## P3 — Later / design-only

- Host-mediated command bridge for runtime packages (curated safe commands via
  postMessage): write the design when the first real need appears — with CSP-based
  networking most FE-only packages won't need it.
- Package distribution beyond folder drop (registry, signing, in-app install): one
  design doc, no implementation yet.
- Move layout/settings persistence from localStorage to a Rust-owned store (same
  robustness argument as grants; low urgency).

## Suggested order

P0.1 → P1.1/P1.2/P1.3 (unblocks safe merging) → P0.2 → P0.3+P0.4 (one feature arc) →
P1.4 → P2.1 → P2.2 → P2.3 → P0.5 → P3 as needed.
