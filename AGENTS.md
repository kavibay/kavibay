# AGENTS.md — Kavibay

Raycast-style desktop widget host / launcher. Tauri v2 (Rust backend) + Vue 3
`<script setup>` TypeScript + Vite. Windows-first (macOS port planned). Maintainer:
Alex (@aswetlow) — conversation in German is fine; code, comments, and docs are English.

This is a learning-driven project: a clean, explained foundation beats feature count.
Comment non-obvious design decisions briefly. No speculative abstraction layers, no
scaffold CLIs, no new test frameworks.

## Repo map — folders are LICENSE boundaries

| Path | What | License |
|------|------|---------|
| `core/app/` | Vue host: palette, settings, widget host, runtime sandbox | GPL-3.0-or-later |
| `core/embed/` | Custom-element package the landing (and later the store) loads with one script tag | GPL-3.0-or-later |
| `src-tauri/` | Rust backend — part of core; stays at repo root for the Tauri CLI | GPL-3.0-or-later |
| `src-tauri/src/extensions/` | Rust backends belonging to one widget each. Shared by two? Then it is host code and stays a level up. | GPL-3.0-or-later |
| `sdk/extension/` | Extension-facing SDK implementations (`@sdk` alias) | MIT |
| `sdk/runtime/` | postMessage SDK for sandboxed packages; the host serves it as `@kavibay/runtime.js` | MIT |
| `extensions/` | First-party widgets, compiled into the app | MIT |
| `examples/` | Runtime package templates + probes (`runtime-extension-s`, `ipc-probe`) | MIT |
| `docs/` | Guides + `superpowers/{specs,plans}` | CC-BY-4.0 |
| `scripts/` | Repo guards / tooling | GPL-3.0-or-later |

Licensing rules that constrain code changes:

- New/moved files adopt their directory's license. SPDX headers
  (`// SPDX-License-Identifier: MIT`) are required in `sdk/**` and `examples/**`.
- **`sdk/` must never import from `core/` or `extensions/`** — it must stay
  self-contained MIT. If sdk needs a helper, implement/move it *into* sdk (that is a
  license decision → flag it in the PR), never re-export core.
- `extensions/` import only: their own folder, `@sdk`, `vue`, `@tauri-apps/*`.
  No cross-extension imports, no deep `core/` imports.
- `core/embed/` may import `core/app/extension-host/`, `core/app/palette/fuzzy.ts`
  and `@sdk`. It must not import `core/app/extensions/*`, `@tauri-apps/*`, or
  the public site — consumers depend on the package, never the reverse. Guard:
  `scripts/embedImportGuard.assert.mjs`.
- Don't touch the moodist sound files or their licensing (Pixabay review is a
  tracked, separate task).

## Commands

```bash
npm run tauri dev                # run the app (Vite + cargo)
npm run verify                   # incremental typecheck + oxlint + all asserts, in parallel — what CI runs
npm run verify:rust              # cargo fmt --check + clippy -D warnings + cargo test --lib
npm run build                    # vue-tsc typecheck + vite build
npm run build:embed              # custom-element bundle the site loads (`core/embed/` → `../www.kavibay.com/embed/`)
npx tsx <path>/<name>.assert.ts  # run one colocated pure-logic test
```

The data directory is `~/.kavibay` (`%USERPROFILE%\.kavibay` on Windows), and
`src-tauri/src/paths.rs` is the only place allowed to resolve it — asking Tauri
for `app_data_dir()` anywhere else silently opts that module out of the override
below. Regenerable files go in `~/.kavibay/cache/` via `paths::cache_dir`.

`KAVIBAY_DATA_DIR=<absolute path> npm run tauri dev` points the whole data
directory somewhere else — settings, the localStorage mirror, credentials, the
widget caches — so a dev run cannot migrate or corrupt the real profile. The path
must be absolute; a relative one is refused rather than resolved. Such an instance
skips single instancing and may run beside a normal one.

Add `WEBVIEW2_USER_DATA_FOLDER=<absolute path>` (WebView2's own variable, not
ours) to isolate the run completely. Without it both instances share one WebView
profile and therefore one `localStorage`, so a dev run's writes reach the other
instance's mirror and land in the real files. With it, two instances are fully
independent — which is what makes it safe to test a migration while a normal
instance is running.

Testing convention: pure TS logic gets a colocated `*.assert.ts` (plain node asserts,
run via `tsx`); Rust uses `#[cfg(test)]` modules. **No vitest / jest.**
`scripts/runAsserts.mjs` aggregates every assert file; the repo guards are
`scripts/*.assert.mjs` and run in the same pass (iframe sandbox, import boundaries,
extension manifests, extension actions, SPDX headers, version sync).

CI (`.github/workflows/ci.yml`) runs `verify` on Ubuntu and the Rust half on Windows —
`src-tauri` is too `#[cfg(windows)]`-heavy for a Linux job to prove much. Plan and
rationale: `docs/superpowers/plans/2026-08-08-ci-cd-open-source.md`.

## Architecture in 8 lines

- One transparent, always-on-top fullscreen window; `Ctrl+Space` toggle and gap
  click-through (cursor polling + `set_ignore_cursor_events`) live in Rust
  (`src-tauri/src/lib.rs`).
- Two extension tiers:
  1. **First-party** (`extensions/<id>/`), all in the contract format.
     They are auto-discovered via Vite glob — never register manually — and
     the folder name MUST equal the id/name in the manifest.
     - **Contract** (`"format": "contract"`):
       `manifest.json` + `extension.ts`. Widgets add `view.ts` + `widgets/`;
       a provider-only extension adds `provider.ts` and omits `view.ts`.
       `extension.ts` and `view.ts` (when present) are read by their
       **default export**; a named-only export typechecks, lints, passes the
       assert suite and then fails at module load in the browser. Definitions
       are framework-free, so `tsx` can load them — which is what the guards
       below rely on. Local palette actions are **declared in `manifest.json`,
       implemented in the definition**, paired by id; a mismatch in either
       direction is a hard error. Discovery:
       `core/app/extension-host/bundledExtensions.ts`. Reference:
       `docs/extension-host.md`. Do not learn the contract from
       `docs/extension-sdk-reference/` — it is frozen at the Phase 1 handoff and
       the live contract is `sdk/extension/contract/sdk.ts`.
  2. **Runtime packages** (community, sandboxed): user-installed folders under
     `{appData}/extensions/` (not the repo dir!), served via the `kavibay-ext`
     protocol into sandboxed iframes; storage/commands only via the postMessage
     bridge (`core/app/runtime/bridgeProtocol.ts`).
- The host stays generic: per-extension behavior only via manifest `ui` flags and
  lifecycle hooks (`onCreate/onDuplicate/onSuspend/onResume/onDispose`) — **never
  add `typeId` switches to host code**.
- Data fetching goes through the widget's context: `ctx.providers[id]` queries
  for an account's data (host-cached per connection; see `tado`), `ctx.http`
  for a keyless API whose hosts are declared (see `stocks`).
- Credentials: declarative types in `src-tauri/src/credentials/registry.rs`, one
  encrypted store, one generic Settings → Credentials panel. Extensions declare
  `credentials: [{ type, required }]` in their manifest and resolve nothing
  themselves (`docs/extensions.md` → Credentials). Settings → AI is *not* a second
  credential panel: it renders the same schema-driven `CredentialEditor` per
  provider tab and adds only the model on/off switches.
- Connections: a credential *type* is an auth schema, a *connection* is one saved
  account using it, and a platform may have several (Linear issues one API key
  per workspace). Which connection a consumer uses is host-owned state keyed by
  `(owner, typeId)` in `credentials/bindings.rs` — `widget:<instanceId>` for a
  widget, `host:default` for the palette, quick AI and the Wizard. Nothing
  resolves by type alone, and a deleted connection never falls back to another
  account. The picker is one component (`ConnectionSelect.vue`), rendered by the
  host in widget settings and on the connect prompt; no widget builds its own.
- LLM models: one editable catalog (`src-tauri/src/llm/models.json`), loaded and
  validated by `llm/catalog.rs`, plus the user's on/off choices (`llm/prefs.rs`,
  `{appData}/llm-models.json`). The prefs live in Rust
  because `extensions/` widgets read the catalog and may not import host settings
  modules — a `localStorage` switch would apply to Settings and nothing else.
- Rust commands register in `src-tauri/src/lib.rs` `invoke_handler` — one line per
  command, keep module groups sorted (merge etiquette).
- **One extension's Rust lives in one directory, and they all have the same
  shape** — mirroring `extensions/<name>/` in the root. Every
  `src-tauri/src/extensions/<name>/mod.rs` opens with the same entry point:
  `pub const EXTENSION: ExtensionRust` naming the root folder it belongs to and
  declaring its providers and capability hosts (empty lists are the statement
  "this one reaches no host"). `extensions::ALL` lists them; tests fail if a
  directory is missing from it, names a folder that does not exist, or claims a
  folder twice. Two extensions never share a file, and `extension_providers` is
  the machinery — it names no extension at all. Declarations are compiled in
  rather than read from a manifest because the webview must not be able to widen
  its own allowlist; that is the reason for Rust, not a reason for one shared
  table.

## Security invariants — never violate, even when a task looks easier without

1. `RuntimeExtensionFrame.vue` keeps `sandbox="allow-scripts"`. Never add
   `allow-same-origin`. Guard: `scripts/runtimeSandboxGuard.assert.mjs`.
2. Runtime bridge: trust only host-side frame identity; payload
   `extId`/`instanceId` are ignored by design.
3. Every path derived from a package/manifest goes through `safe_join`
   (`src-tauri/src/runtime_extensions/validate.rs`). Fail closed.
4. Manifest/permission validation is mirrored in FE
   (`core/app/runtime/manifestValidate.ts`) and Rust
   (`src-tauri/src/runtime_extensions/`) — change both or neither.
5. Secrets only via `src-tauri/src/security/secrets.rs` (DPAPI on Windows, an
   AES key in the login Keychain on macOS). Never plaintext at rest, never in localStorage, never returned to the
   frontend. Integration credentials go through `src-tauri/src/credentials/`
   (type registry + one encrypted store + `resolve_for_owner` / `resolve_for_connection`)
   — no per-integration credential tables, commands, or settings panels. A runtime
   package never receives a secret either: its declared requests are authenticated
   in Rust, and only against the exact connection the user granted it. A grant is
   per connection, not per type — allowing the work workspace does not allow a
   personal one added afterwards.
6. Main-window CSP (`src-tauri/tauri.conf.json`): no new entries without maintainer
   review. Prefer a Rust command for network data; FE direct fetch only for keyless
   public APIs.
7. Powerful commands (`launch_path`, `send_virtual_key`, clipboard) are acceptable
   only because the main webview runs first-party code exclusively. Never expose
   them to runtime packages.

## Authoritative docs

- Index: `docs/README.md`. Longer prose version of this file: `docs/architecture.md`;
  toolchain + troubleshooting: `docs/getting-started.md`.
- Widget/extension how-to: `docs/widget-tutorial.md` (walkthrough) and
  `docs/extensions.md` (reference); agent workflow + S/M/L tiers:
  `.cursor/skills/kavibay-widget/SKILL.md`; canonical contract:
  `docs/superpowers/specs/2026-07-18-extension-system-design.md`.
- `docs/runtime-packages.md` and `docs/DESIGN.md` are compiled into the Widget
  Wizard's system prompt (`src-tauri/src/wizard/prompt.rs`, `include_str!`) —
  editing them changes model behaviour, and moving them breaks the build.
- Active roadmap: `docs/superpowers/plans/2026-07-23-architecture-security-hardening.md`
  (P0–P2 ✅ or superseded; open: `http:` in the main CSP's `img-src`, and P3) and
  `docs/superpowers/plans/2026-07-23-repo-structure-licensing.md` (restructure ✅).
  After finishing a phase: run its verify steps, then mark it done in the plan doc
  with a short completion note.
- Landing demo, widget-store preconditions and the browser runtime:
  `docs/superpowers/plans/2026-08-28-landing-demo-and-web-runtime.md` (L0–L1
  done 2026-08-28; L2 not started).
  Read its §3 before estimating anything about bundle size or what runs without
  Tauri — those numbers are measured, and three of them contradict what the code
  suggests.

## Definition of done (any change)

`npm run verify` green · `npm run verify:rust` green when Rust was touched · manual UI
smoke for widget changes (palette add, duplicate/dispose if stateful, settings if
present). Report deviations honestly — a red check with an explanation beats a silent
skip.

Landing exception: when a task touches **only static files** under
`../www.kavibay.com/` (HTML, CSS, images, `script.js`) and not `core/embed/` or
`vite.embed.config.ts`, do **not** run `npm run verify`. Validate the relevant
static files and diff only unless the maintainer explicitly asks for broader
checks.

Anything that touches the embed package (`core/embed/`), its Vite config, or the
bundle landing loads **does** run typecheck — `npm run verify`. A broken import
there is a typecheck failure that the static-only exception would hide.
