# Runtime Extensions (Secure Drop-in Packages)

**Date:** 2026-07-22  
**Status:** Approved  
**Extends:** the first-party extension system ([extensions.md](../extensions.md)), which was build-time only.

## Goal

Support:

1. **Repo developers** — keep first-party widgets in `extensions/` + shared Rust (unchanged trust).
2. **Power users** — install FE + optional BE packages under AppData and enable them without rebuilding Kavibay.
3. **Later: marketplace** — same package format + stronger trust (signing).

Security is a hard requirement: runtime packages are **untrusted** and never share privileges with built-in extensions.

## Non-goals (v1)

- Marketplace UI, update channels, or publisher accounts (path 3 later)
- Hot-loading Rust into the Kavibay binary / dynamic native plugins inside-process
- Node/Python/script sidecars (only packaged native binaries per OS)
- Runtime access to host Integrations credentials (Cloudflare, Google, Tado, GitHub)
- Runtime calls to built-in Tauri commands (layout DB, credential APIs, other widgets)
- TCP/UDP IPC for sidecars (stdio only)
- Auto-enabling packages on copy/discover

## Trust model

| Tier | Source | Trust |
|------|--------|--------|
| **Built-in** | Compiled `extensions/*` + Rust in Kavibay | Trusted with the app |
| **Runtime** | `%APPDATA%/Kavibay/extensions/<id>/` (platform-equivalent) | Untrusted |

Rules:

- Runtime UI never receives full `@tauri-apps/api` / host `invoke`.
- Runtime code talks only through a host-mediated bridge.
- Sidecars are separate processes; they do not inherit Kavibay secrets.
- A sidecar **is** arbitrary code as the user — mitigated by opt-in gates and isolation from Kavibay, not by pretending the OS sandbox makes it safe.

## Threat model

| Threat | Mitigation |
|--------|------------|
| Malicious zip / “cool widget” | Developer Extensions off by default; per-ext enable; sidecar consent |
| UI calling host Tauri commands | No Tauri API in iframe; bridge allowlists `manifest.commands` only |
| Cross-extension data theft | Storage namespaced `kavibay:runtime:<extId>:…`; frame identity binds `extId` |
| Path traversal in manifest | Reject `..`, absolute paths; resolve must stay in package root |
| Id spoofing | `manifest.id` must equal folder name; bridge trusts host frame map, not payload |
| Accidental load for normal users | Developer Extensions toggle + warnings |
| Zombie / abusive sidecars | Lazy spawn, kill on disable/quit, timeouts, max message size |
| Supply chain (later) | Signing + “signed only” default for marketplace |

## Package format

```
<extensionsRoot>/<id>/
  manifest.json
  ui/
    index.html
    assets/…
  backend/                 # optional
    <native binary>
  LICENSE                  # optional
  README.md                # optional
```

### Manifest (runtime additions)

Existing catalog fields remain (`id`, `name`, `description`, `version`, `author`, `keywords`, `categories`, `ui`, `commands`, `permissions`).

Runtime-specific:

```json
{
  "id": "my-widget",
  "name": "My Widget",
  "version": "1.0.0",
  "ui": {
    "entry": "ui/index.html",
    "defaultOffset": { "x": 0, "y": 0 },
    "allowDuplicate": true
  },
  "backend": {
    "type": "sidecar",
    "windows": "backend/kavibay-backend.exe",
    "macos": "backend/kavibay-backend",
    "linux": "backend/kavibay-backend"
  },
  "commands": ["get_status", "refresh"],
  "permissions": ["storage.instance", "backend.sidecar"]
}
```

- `ui.entry` required for runtime packages (path relative to package root).
- `backend` optional; if present, `type` must be `"sidecar"` and the current OS key must be set.
- `commands`: allowlisted bridge → sidecar method names.
- Built-in extensions continue to use today’s module export (`index.ts`); they do **not** use AppData loading.

## Permission catalog (v1)

| Permission | Meaning | Consent |
|------------|---------|---------|
| `storage.instance` | Host-mediated per-instance KV for this ext only | Listed on enable |
| `backend.sidecar` | Run packaged native backend | Hard modal |
| `network.client` | Document that the package may use the network (OS-level for sidecar) | Hard when sidecar present |

Fail closed: unknown permission string → reject load.

**Explicitly not granted in v1:** host credential store, Integrations, shell, other extensions’ storage, built-in Tauri commands, listening sockets for IPC.

## Install location & discovery

| Platform | Root |
|----------|------|
| Windows | `%APPDATA%/Kavibay/extensions/` |
| macOS | `~/Library/Application Support/Kavibay/extensions/` |
| Linux | `$XDG_CONFIG_HOME/Kavibay/extensions/` or `~/.config/Kavibay/extensions/` |

Discovery runs on startup and on user **Rescan**, only if **Developer Extensions** is on. Otherwise the root is ignored.

## Validation (before any UI/backend runs)

1. Developer Extensions enabled.
2. `manifest.json` schema-valid; required fields present.
3. `manifest.id ===` folder name.
4. All declared paths relative; no `..`; canonical path stays under package root.
5. `ui.entry` exists.
6. If `backend` present: binary for current OS exists and is a file.
7. Every permission ∈ known catalog.
8. Persist install record: `id`, `version`, `path`, `grantedPermissions`, `sidecarConsentedAt`, `backendPathHash` (or equivalent).

Invalid packages appear as error rows; never spawned.

## Settings UX

**Developer Extensions** (default **off**):

- Clear warning that runtime packages are untrusted and sidecars run as the user.
- Link to author docs.

**Runtime extensions list** (visible when Developer Extensions on):

- Name, version, path, status (`disabled` / `enabled` / `error`), permission badges.
- Enable / Disable / Rescan / Remove.
- Built-in enable/disable remains separate (no native-code modal).

**First enable with `backend.sidecar`:**

- Modal: id, name, version, permissions, native-code warning.
- Confirm required. Re-prompt if `version` or backend path/hash changes.

## UI sandbox

Runtime content is **not** mounted as a host Vue SFC.

- Load `ui.entry` in a sandboxed iframe (or dedicated WebView) with restrictive CSP.
- Default CSP denies network from the UI; `connect-src` (and similar) only widened if `network.client` was granted at enable time.
- Unique origin per extension (opaque / custom protocol); no access to host DOM or host storage.
- Host card chrome (title, drag, menus shell) stays outside; iframe is content only.
- Injected API only, e.g. `kavibay.extension.request({ command, args })` and storage helpers if permitted.
- Bridge implemented in host/Rust:
  - Bind caller → `extId` via frame identity map (ignore spoofed ids in payload).
  - Allow `command` only if listed in that extension’s `manifest.commands`.
  - Require extension enabled + permissions granted.
  - Never proxy to built-in Tauri command surface.

Built-in widgets: unchanged compiled Vue path.

### Threat model: iframe must not reach Tauri IPC

Assumption (load-bearing): a runtime frame with `sandbox="allow-scripts"` (no
`allow-same-origin`) cannot call Tauri IPC or read the host DOM, even if WebView2
injects init scripts into subframes. Packages share the custom-protocol URL origin
(`kavibay-ext.localhost`); isolation is the opaque unique origin from the sandbox
flag, not a per-package protocol origin.

**CI guard:** `scripts/runtimeSandboxGuard.assert.mjs` fails if
`RuntimeExtensionFrame.vue` contains `allow-same-origin` or drops
`sandbox="allow-scripts"`.

**Manual probe:** install `examples/ipc-probe/` (see
[extensions.md](../extensions.md)). Expected output — every row **PASS**
(blocked):

| Check | Expected |
|-------|----------|
| `window.__TAURI_INTERNALS__` | absent |
| `window.ipc` | absent |
| `window.chrome.webview` | absent (or access throws) |
| `parent.document` | SecurityError |
| `top.document` | SecurityError |

Any **FAIL** is stop-ship for runtime extensions until isolation is restored.

## Sidecar IPC

Spawn only when all are true:

- Developer Extensions on
- Extension enabled
- `backend.sidecar` granted + user consented
- Backend path validated

Process policy:

- `cwd` = package root
- Stripped environment (no Kavibay tokens / Integration secrets)
- Not elevated
- Lazy start on first bridge request that needs backend (preferred)
- One process per extension; kill on disable, unload, or app quit

Protocol:

- stdin/stdout, length-prefixed JSON (or newline JSON with strict max size)
- Request: `{ id, command, args }` — `command` must be allowlisted
- Response: `{ id, ok, result | error }`
- Limits: max message bytes, request timeout
- No TCP listen by default
- Sidecar cannot call into Kavibay (v1 request/response only)

Logging: spawn/fail/kill; do not log secret-looking args.

## Storage

- Runtime keys: `kavibay:runtime:<extId>:<instanceId>` (host-mediated).
- Only if `storage.instance` granted.
- Clear runtime storage for an ext on Remove (and on Dispose per instance as today).
- Sidecar does not read host `localStorage` or credentials DB.

## Lifecycle

1. Discover → validate  
2. Enable → consent if needed → appear in palette (`typeId` = `manifest.id`)  
3. Create instance → iframe mount; sidecar lazy  
4. Disable / last dispose / quit → kill sidecar, tear down bridge  
5. Replace files with new version → if version or backend hash changed, force disable + re-consent  
6. Remove → kill, clear runtime storage + install record; delete package files if user confirms  

Unknown/disabled runtime ids in saved layout: skip + warn (same as missing built-in).

## Path 1 vs Path 2

| | Built-in (1) | Runtime (2) |
|--|--------------|-------------|
| FE | Vue in `extensions/` | Prebuilt `ui/` in sandbox |
| BE | Rust in Kavibay binary | Packaged sidecar binary |
| Load | Vite glob at build | AppData scan at runtime |
| Trust | App | Untrusted + gates |

- Do not double-load repo extensions as runtime packages.
- Authoring a drop-in widget: build UI + optional sidecar → pack into AppData shape → enable under Developer Extensions.
- Optional later tooling: template + `pack` command (Phase P3).

## Path 3 (later)

- Marketplace installs the same zip/folder into `extensionsRoot`.
- Add signatures (publisher or Kavibay keys).
- Default “allow only signed extensions” for non-developer installs; Developer Extensions may still allow unsigned local packages.
- No change to bridge/sidecar security model.

## Rollout phases

| Phase | Deliverable | Security gate |
|-------|-------------|---------------|
| **P0** | This spec + docs; Developer Extensions toggle (noop loader) | Toggle default off |
| **P1** | Discover, validate, FE-only iframe + bridge + `storage.instance` | No sidecar yet; isolation first |
| **P2** | Sidecar spawn + IPC + `backend.sidecar` consent | No P2 without P1 sandbox |
| **P3** | Author template + pack tooling | Same validation on pack output |
| **P4** | Marketplace + signing | Signed-only default for store path |

## Testing (security)

- Reject path traversal, absolute paths, id mismatch, unknown permissions, missing UI/backend files.
- Bridge denies commands not in manifest; denies when disabled / wrong frame.
- No sidecar spawn when Developer Extensions off, disabled, or without consent.
- Sidecar killed on disable; no zombies after quit.
- Storage: ext A cannot read ext B via bridge.
- Built-in credential/layout invokes unreachable from runtime bridge.

## Relationship to first-party helpers

Recent helpers (`createInstanceStore`, `instanceStorageKey`) remain for **built-in** Vue extensions. Runtime packages use host-mediated storage APIs with the `kavibay:runtime:…` prefix and do not import host Vue composables inside the iframe.

## Open questions (resolved for v1)

| Question | Decision |
|----------|----------|
| Node/Python sidecars? | No — native binaries only |
| iframe vs separate WebView? | Sandboxed iframe (or equivalent WebView) with opaque origin; implementation may pick either if isolation properties match |
| Auto-run on copy? | No — explicit Enable |
| Shared Integrations? | No in v1 |

## Success criteria

- With Developer Extensions **off**, AppData packages have zero effect.
- Power user can install a FE-only package and use it after enable.
- Power user can install a FE+sidecar package only after native-code consent; bridge cannot reach host secrets.
- Built-in extension DX and security posture unchanged.
- Package format is reusable for a future marketplace without redesigning IPC.
