# Cursor prompts — architecture & security hardening (P0.2 → P2.3)

Companion to `2026-07-23-architecture-security-hardening.md` (the authoritative plan).
P0.1 (unified secret protection) is already done. Use the **master prompt** for a single
long-running session, or (recommended) feed the **per-phase prompts** one at a time,
each as its own branch/PR.

---

## Master prompt

```
Read docs/superpowers/plans/2026-07-23-architecture-security-hardening.md first — it is
the authoritative plan and encodes decisions already made with the maintainer:
sandbox-first for community widgets, network.client implemented for real, macOS soon
(secret backend already abstracted in src-tauri/src/security/secrets.rs), CI = PR checks
+ NSIS release. P0.1 is done; do NOT redo it.

Implement the remaining phases IN THIS ORDER, one phase per branch/PR, and stop for
review after each: P0.2 → P0.3+P0.4 (one arc) → P1.1+P1.2+P1.3 → P1.4 → P2.1 → P2.2 →
P2.3 → P0.5.

Hard guardrails (do not violate, even if a task seems easier without them):
- RuntimeExtensionFrame.vue keeps sandbox="allow-scripts" — never add
  allow-same-origin. P0.2 adds a CI guard asserting exactly this.
- All manifest/permission validation stays fail-closed and mirrored in BOTH
  src/core/runtime/manifestValidate.ts (FE) and
  src-tauri/src/runtime_extensions/mod.rs (Rust).
- P0.3 linchpin: runtime install/grant records MOVE from localStorage to a Rust-owned
  store ({appData}/extensions/installs.json) — the kavibay-ext protocol handler must
  know grants to emit a per-package CSP. FE (runtimeInstallLogic.ts /
  useRuntimeExtensions.ts) becomes a view over Tauri commands.
- network.allowedHosts: https only, exact hostnames (no wildcards, no IP literals,
  no ports); reject at scan time on both sides; CSP connect-src lists exactly the
  granted hosts, otherwise 'none'.
- Secrets always go through src-tauri/src/security/secrets.rs — never plaintext at
  rest, never into the frontend.
- Testing conventions stay as they are: pure TS logic → *.assert.ts (run via tsx);
  Rust → #[cfg(test)] modules. Do not introduce vitest or new frameworks.
- No new runtime dependencies without a one-line justification in the PR description.

Per phase: implement, run the verify steps listed in the plan for that phase, keep the
baseline green (npx vue-tsc --noEmit; cargo test --lib in src-tauri — currently 105
tests), then mark the phase "✅ done <date>" in the plan doc with a 3-5 line completion
note (same style as P0.1) before moving on.

Ask the maintainer before deviating from the plan; document any approved deviation in
the plan doc.
```

---

## Per-phase prompts (recommended)

### Phase P0.2 — prove iframe ↔ IPC isolation

```
Read docs/superpowers/plans/2026-07-23-architecture-security-hardening.md, section
P0.2, plus src/core/runtime/RuntimeExtensionFrame.vue and
docs/templates/runtime-extension-s/.

Task: make the sandbox isolation claim testable.
1. Create a probe package under docs/templates/ipc-probe/ (valid runtime package:
   manifest.json + ui entry). Its script checks window.__TAURI_INTERNALS__, window.ipc,
   window.chrome?.webview, parent/top access, and renders a PASS/FAIL list (PASS =
   blocked). No permissions requested.
2. Add a CI-runnable assert (script under scripts/ or a *.assert.ts) that fails if
   RuntimeExtensionFrame.vue contains "allow-same-origin" or drops the sandbox
   attribute.
3. Document the expected all-blocked probe output + threat model note in
   docs/superpowers/specs/2026-07-22-runtime-extensions-design.md.

Verify: npx vue-tsc --noEmit; run the new assert; install the probe package per
docs/extensions.md "Install a sample package" and confirm every check renders PASS.
If ANY check shows IPC reachability, stop and report — that is a stop-ship finding.
Then mark P0.2 done in the plan doc (style of P0.1).
```

### Phase P0.3 + P0.4 — real network.client + consent (one arc)

```
Read docs/superpowers/plans/2026-07-23-architecture-security-hardening.md, sections
P0.3 and P0.4, plus src/core/runtime/ (runtimeInstallLogic.ts, useRuntimeExtensions.ts,
runtimeTypes.ts, manifestValidate.ts), src-tauri/src/runtime_extensions/ (mod.rs,
protocol.rs), and src/settings/RuntimeExtensionsPanel.vue.

Build in this order:
1. Rust-owned grant store: {appData}/extensions/installs.json with commands
   runtime_extensions_installs_get / runtime_extensions_set_enabled (register in
   lib.rs). One-time migration: import existing localStorage records
   (kavibay:runtime-installs-v1) on first run, then treat Rust as the single source
   of truth; FE composables become a view (keep their public API stable so
   Settings/host code changes stay minimal).
2. Manifest: optional network: { allowedHosts: string[] } — valid only together with
   permission "network.client". Validation fail-closed in BOTH FE and Rust: https-only
   hosts, exact hostnames, no wildcards/IP literals/ports/schemes/paths.
3. protocol.rs: build the frame CSP per request — connect-src https://<host> ... for
   packages whose grant record includes network.client, else 'none'. Keep every other
   directive as today. Unit-test the CSP assembly.
4. Consent (P0.4): enabling a package in RuntimeExtensionsPanel shows a confirm step
   listing requested permissions and exact hosts; confirm → grant via the new Rust
   command; cancel → stays disabled. No silent auto-grant anywhere.
5. Extend docs/templates/ with a network probe package: fetch to an allowed host
   (expect success when granted) and to a non-listed host (expect CSP block).

Guardrails: RuntimeExtensionFrame keeps sandbox="allow-scripts"; validation mirrored
FE+Rust; no localStorage writes for grants after migration.

Verify: cargo test --lib (CSP assembly + validator tests green, baseline 105+ stays
green); npx vue-tsc --noEmit; existing *.assert.ts for runtimeInstallLogic updated and
passing; manual: probe package shows allowed-host success + blocked-host failure, and
a package without network.client still has connect-src 'none'. Mark P0.3 + P0.4 done
in the plan doc.
```

### Phase P1.1–P1.3 — CI, lint + boundaries, test aggregation

```
Read docs/superpowers/plans/2026-07-23-architecture-security-hardening.md, sections
P1.1–P1.3.

1. Scripts first (P1.3): scripts/run-asserts.ts globs src/**/*.assert.ts and runs each
   via tsx, non-zero exit on first failure. package.json: "test:assert" runs it;
   "verify" = vue-tsc --noEmit + eslint . + test:assert + (cd src-tauri && cargo test
   --lib). tsx becomes a devDependency.
2. ESLint flat config + Prettier (P1.2): eslint-plugin-vue + typescript-eslint,
   Prettier defaults, no style bikeshedding. Boundary rules via no-restricted-imports
   (or eslint-plugin-import zones): src/extensions/** may import ONLY from its own
   folder, the @sdk alias (stub the alias now if P2.1 is not done — pointing at
   src/core/extensions/ exports), vue, and @tauri-apps/*; cross-extension imports and
   deep src/core/** imports are errors; src/core/** must not import from
   src/extensions/** except the import.meta.glob in loadExtensions.ts. Fix or
   explicitly inline-disable (with a reason) any existing violations — list them in
   the PR description.
3. CI (P1.1): .github/workflows/ci.yml on push/PR: windows-latest required job running
   npm ci + npm run verify + cargo fmt --check + cargo clippy -- -D warnings
   (src-tauri); macos-latest as continue-on-error job (port pending).
   .github/workflows/release.yml on tag v*: npm run package:win, upload the NSIS
   installer from src-tauri/target/release/bundle/nsis/ to a GitHub Release.
   Cache cargo + npm. If clippy -D warnings is too noisy on the existing codebase,
   fix trivial lints, allow specific lints crate-level with a TODO comment, and note
   it in the PR — do not ship a red or skipped clippy job.

Verify: npm run verify green locally; push a draft PR and confirm the Windows job is
green end-to-end. Mark P1.1–P1.3 done in the plan doc.
```

### Phase P1.4 — CONTRIBUTING.md

```
Read docs/superpowers/plans/2026-07-23-architecture-security-hardening.md section P1.4,
docs/extensions.md, and .cursor/skills/kavibay-widget/SKILL.md.

Write CONTRIBUTING.md (English, concise): sandbox-first policy (community widgets ship
as runtime packages under {appData}/extensions — link the runtime docs; first-party
src/extensions/ is maintainer-curated, PRs there are the exception); tier table S/M/L
from the skill; PR checklist (manifest commands/permissions honest, no secrets in FE
storage, secrets via src-tauri/src/security/secrets.rs, no new main-window CSP entries
without review, *.assert.ts for pure logic, npm run verify green); lib.rs
invoke_handler etiquette (one line per command, keep module groups sorted); data-fetch
rule (prefer Rust command; FE direct fetch only for keyless public APIs with CSP
review). Link it from README.md. Do not duplicate docs/extensions.md content — link it.
Mark P1.4 done in the plan doc.
```

### Phase P2.1 — @sdk barrel for first-party extensions

```
Read docs/superpowers/plans/2026-07-23-architecture-security-hardening.md section P2.1.

1. Create src/sdk/index.ts exporting exactly the stable first-party surface: the types
   from src/core/extensions/types.ts, createInstanceStore, instanceStorageKey,
   useWidgetData (re-exports only, no new abstractions). Add the @sdk alias to
   vite.config.ts + tsconfig paths.
2. Mechanically migrate all src/extensions/**/ imports of core modules to @sdk. No
   behavior changes.
3. Tighten the P1.2 ESLint boundary so @sdk is the ONLY allowed core import path for
   extensions (remove the temporary stub allowance).
4. Document the SDK surface + change policy (what is stable, how breaking changes are
   announced) in docs/extensions.md.

Verify: npm run verify green; git grep "core/extensions" src/extensions/ returns
nothing. Mark P2.1 done in the plan doc.
```

### Phase P2.2 — runtime package SDK (community path)

```
Read docs/superpowers/plans/2026-07-23-architecture-security-hardening.md section P2.2,
src/core/runtime/bridgeProtocol.ts, and docs/templates/runtime-extension-s/.

1. Create the author-side SDK as a single dependency-free ES module +
   TypeScript declarations (e.g. sdk/runtime/kavibay-ext-sdk.js + .d.ts, copied into
   packages — no npm publish yet): ready handshake, storage.get/set returning typed
   results ({ ok, value } / { ok, error }), request-id correlation, permission-denied
   surfaced as a normal error. It must speak exactly the existing bridgeProtocol.ts
   messages — do not change the protocol in this phase.
2. Update docs/templates/runtime-extension-s/ (and the probe packages) to use it.
3. Write docs/runtime-packages.md: quick start from the template, manifest reference
   incl. network.allowedHosts, permission model + consent flow, sandbox limits (no
   IPC, no top navigation, no popups), storage semantics, debugging tips (Rescan,
   error rows). Link from README.md and CONTRIBUTING.md.

Verify: npx vue-tsc --noEmit; template package installs and works per the new doc
(storage roundtrip via the SDK). Mark P2.2 done in the plan doc.
```

### Phase P2.3 + P0.5 — manifest honesty + small hardening

```
Read docs/superpowers/plans/2026-07-23-architecture-security-hardening.md sections
P2.3 and P0.5.

1. P2.3: scripts/check-manifest-commands.ts — for each src/extensions/<id>/, collect
   invoke("...") string literals and fail if any called command is missing from that
   extension's manifest.json "commands". Regex-based; document the limitation
   (dynamic invoke calls) in the script header. Wire into npm run verify + CI.
   Fix any manifests it flags.
2. P0.5a: in fetch_url_icon (src-tauri/src/app_launcher.rs), reject hosts that are IP
   literals in loopback/private/link-local ranges before fetching; unit-test the
   rejection helper.
3. P0.5b: in tauri.conf.json CSP, drop http: from img-src (keep https: + local
   schemes) unless a widget demonstrably needs it — check the image/app-launcher/
   weather widgets and note the finding in the PR.
4. P0.5c: in src/core/extensions/loadExtensions.ts, turn the folder ≠ manifest.id
   console.warn into a thrown error (matching Rust behavior).

Verify: npm run verify green; cargo test --lib green; manual smoke: app launcher icons
still load, image widget still renders. Mark P2.3 + P0.5 done in the plan doc.
```
