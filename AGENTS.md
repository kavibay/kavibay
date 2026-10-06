# AGENTS.md — Kavibay

Raycast-style desktop widget host / launcher. Tauri v2 (Rust backend) + Vue 3
`<script setup>` TypeScript + Vite. Version 0.1 targets Windows only; Linux and
macOS are outside its release scope. Existing source ports are experimental. Maintainer:
Alex (@aswetlow) — conversation in German is fine; code, comments, and docs are English.

This is a learning-driven project: a clean, explained foundation beats feature count.
Comment non-obvious design decisions briefly. No speculative abstraction layers, no
scaffold CLIs, no new test frameworks.

## Repo map — folders are LICENSE boundaries

| Path | What | License |
|------|------|---------|
| `core/app/` | Vue host: palette, settings, widget host, runtime sandbox | GPL-3.0-or-later |
| `core/embed/` | Custom-element package the landing (and later the store) loads with one script tag | GPL-3.0-or-later |
| `core/web/` | Browser entry for the real app: the Tauri backend answered in the page, for the landing's live demo | GPL-3.0-or-later |
| `src-tauri/` | Rust backend — part of core; stays at repo root for the Tauri CLI | GPL-3.0-or-later |
| `src-tauri/src/extensions/` | Rust backends belonging to one widget each. Shared by two? Then it is host code and stays a level up. | GPL-3.0-or-later |
| `sdk/extension/` | Extension-facing SDK implementations (`@sdk` alias) | MIT |
| `sdk/runtime/` | postMessage SDK for sandboxed packages; the host serves it as `@kavibay/runtime.js` | MIT |
| `extensions/` | First-party widgets, compiled into the app | MIT |
| `examples/` | Runtime package templates + probes (`runtime-extension-s`, `ipc-probe`) | MIT |
| `docs/` | Guides + `design/` (design rationale) | CC-BY-4.0 |
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
- `core/web/` wraps `core/app/` without changing it: it installs Tauri's IPC mock
  and imports `core/app/main.ts`. Nothing in `core/app/` may import `core/web/`.
  Every `invoke("…")` the app makes must be in exactly one table of
  `core/web/webCommands.ts` (ANSWERS, NO_OPS, NOT_ON_WEB) — a new Rust command
  fails `core/web/webCommands.assert.ts` until it is classified there.
- Moodist sounds: every file is listed in `extensions/moodist/soundInventory.ts`
  with its source — CC0 recordings from Freesound (cut and encoded by
  `buildSounds.mts`) or noise computed at runtime (`noise.ts`). Don't add upstream
  Moodist recordings back: their Pixabay/CC0 licensing is not recorded per file.

## Commands

```bash
pnpm run tauri dev                # run the app (Vite + cargo)
pnpm run verify                   # incremental typecheck + oxlint + all asserts, in parallel — what CI runs
pnpm run verify:rust              # cargo fmt --check + clippy -D warnings + cargo test --lib
pnpm run build                    # vue-tsc typecheck + vite build
pnpm run build:embed              # custom-element bundle the site loads (`core/embed/` → `../www.kavibay.com/embed/`)
pnpm run build:web                # the real app for the landing's iframe (`core/web/` → `../www.kavibay.com/app/`)
npx tsx <path>/<name>.assert.ts  # run one colocated pure-logic test
```

The data directory is `~/.kavibay` (`%USERPROFILE%\.kavibay` on Windows), and
`src-tauri/src/paths.rs` is the only place allowed to resolve it — asking Tauri
for `app_data_dir()` anywhere else silently opts that module out of the override
below. Regenerable files go in `~/.kavibay/cache/` via `paths::cache_dir`.

`KAVIBAY_DATA_DIR=<absolute path> pnpm run tauri dev` points the whole data
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
`src-tauri` is too `#[cfg(windows)]`-heavy for a Linux job to prove much.

## Architecture in 8 lines

- One transparent, always-on-top fullscreen window; `Ctrl` double-tap toggle (hold `Ctrl+Space` to peek) and gap
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
  credential panel: it renders the same schema-driven `CredentialAccounts` per
  provider row and adds only the model on/off switches.
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

## Extension SDK invariants

The extension contract lives in `sdk/extension/contract/sdk.ts`. The handoff it
was built from — the reference implementation, its port map, the phase plan and
the scope it set for v1 — is frozen in `docs/extension-sdk-reference/`.

Read `docs/extension-sdk-reference/FINDINGS.md` before changing the contract.
It documents seven contract errors that were found by running the suite. Each
one looks like a reasonable design choice on paper. If you redesign from the
type names alone you will reintroduce at least findings 4 and 5, and neither
is visible in code review.

These are not preferences. Each one is enforced by the assert suite
(`core/app/extension-host/*.assert.ts`, run by `npm run test:assert`). If a
change breaks one, the change is wrong.

1. **Trust is derived from the load source, never read from a manifest.**
   An extension cannot name itself into a tier. Reserved namespaces
   (`kavibay`, `core`, `official`, `system`) are refused for anything not
   bundled. See `deriveNamespace` / `deriveTrust` in `core/app/extension-host/registry.ts`.
2. **Permissions fail closed.** A missing or empty permission list means deny,
   never "unchecked". `permissions` is required whenever `requires.provider`
   is set. (Finding 5 — a widget declaring only queries could call every
   action on its provider.)
3. **Secrets never cross the wire.** `ProviderHostContext` is handed only to
   provider code running in the host. No token value ever appears in a
   `WidgetResponse`. Widgets get a capability handle, never a credential.
4. **The wire never carries a value the host can derive from caller identity.**
   `provider.*` requests carry no provider id; the host resolves it from the
   caller's registered instance. (Finding 7.)
5. **Query keys are built by one party.** `ProviderQuery.key()` returns the
   discriminating part only (`[a.roomId]`). The host prefixes provider id and
   query name. `invalidates` returns `{ query, key? }`, never a raw key.
   (Finding 4 — the bug that silently disabled all invalidation.)
6. **Everything crossing the widget boundary is async and JSON-serializable.**
   No functions, no reactive objects, no direct `invoke`. A `Ref` in a
   `WidgetRequest` is a bug. Verified by section [7] of `scenarios.assert.ts`, which runs a
   real widget over a `JSON.stringify` transport.
7. **Bundled widgets use the same API as external ones.** No
   `import { store } from "../../core"` because a widget ships in the binary.
   If a bundled widget needs something the SDK cannot express, extend the SDK.
8. **Anything requiring a credential is a Provider.** Never an http capability
   call with a key in widget configuration, however trivial the provider looks.

### Traps

- **Do not make `permissions` optional again.** It is tempting because most
  widgets need few of them. See finding 5.
- **Do not let provider authors write the full query key.** See finding 4.
  If invalidation "mysteriously doesn't fire", this is why.
- **Do not use `when.providerConnected` as a capability grant.** It is
  visibility only. Code commands declare `requires` and `permissions`
  separately. See finding 6.
- **Do not add capabilities speculatively.** Each one is reviewed host surface,
  added when a bundled widget needs it.
  Secure storage is provider-internal and never widget-facing; widget
  persistence is `ctx.data`.
- **Do not treat the http allowlist as a security boundary.** A widget allowed
  to reach `api.open-meteo.com` can encode anything it read into query
  parameters. PR review is the control for third-party code. State this in the
  contributor docs rather than implying protection that does not exist.
- **Google Calendar is post-launch.** Calendar scopes are sensitive; until
  Google verification passes, the project is capped at 100 users for its
  lifetime and the cap cannot be reset by a new client id. Either start
  verification early or let users supply their own client id.

## Authoritative docs

- Index: `docs/README.md`. Longer prose version of this file: `docs/architecture.md`;
  toolchain + troubleshooting: `docs/getting-started.md`.
- Widget/extension how-to: `docs/widget-tutorial.md` (walkthrough) and
  `docs/extensions.md` (reference); agent workflow + S/M/L tiers:
  `.cursor/skills/kavibay-widget/SKILL.md`; canonical contract:
  `sdk/extension/types.ts` and `sdk/extension/contract/sdk.ts`.
- Why the sandbox is built the way it is: `docs/design/runtime-extensions.md`
  (threat model) and `docs/design/declarative-http-api.md` (declared endpoints).
- `docs/runtime-packages.md` and `docs/DESIGN.md` are compiled into the Widget
  Wizard's system prompt (`src-tauri/src/wizard/prompt.rs`, `include_str!`) —
  editing them changes model behaviour, and moving them breaks the build.
- Roadmap, open work and plans are tracked outside the repo. Do not add plan
  files under `docs/`; `docs/superpowers/` is gitignored for skills that write
  plans there.

## Definition of done (any change)

`pnpm run verify` green · `pnpm run verify:rust` green when Rust was touched · manual UI
smoke for widget changes (palette add, duplicate/dispose if stateful, settings if
present). Report deviations honestly — a red check with an explanation beats a silent
skip.

Small changes are the exception: a contained edit (a few lines, one file, a
copy or style tweak, a doc change) needs no full `verify` run and no browser or
computer-use check. At most, run the one colocated `*.assert.ts` or typecheck
the touched file when the edit is logic. Run the full suite or drive the UI only
for larger changes, or when the maintainer asks.

Landing exception: when a task touches **only static files** under
`../www.kavibay.com/` (HTML, CSS, images, `script.js`) and not `core/embed/` or
`vite.embed.config.ts`, do **not** run `pnpm run verify`. Validate the relevant
static files and diff only unless the maintainer explicitly asks for broader
checks.

Anything that touches the embed package (`core/embed/`), the web entry
(`core/web/`), their Vite configs, or the bundles the landing loads **does** run typecheck — `pnpm run verify`. A broken import
there is a typecheck failure that the static-only exception would hide.

# What you need from me
- End every turn where you're blocked on me, or where the next step needs me, with a short "**What I need from you**" section. Numbered, one concrete action per item: exactly what to do, where (which site, app, file or person), and what to send back. e.g. "Add `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` under GitHub → kavibay/kavibay → Settings → Secrets → Actions, then tell me when they are in", not "I need the signing key".
- If there are several, put the quickest or most blocking one first, and say what you'll get on with in the meantime.
- If you don't need anything from me, say "Nothing needed from you right now" so I don't have to ask.
- Never bury a request for me in the middle of a long update.