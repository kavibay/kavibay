# Runtime Extensions (P0–P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> **Commits:** Only create git commits when the user explicitly asks (project rule). Skip commit steps unless requested.

**Goal:** Ship secure runtime extension loading for FE-only packages (Developer Extensions gate, AppData discovery, path-safe validation, sandboxed iframe UI, host-mediated storage) without sidecars yet.

**Architecture:** Built-in extensions stay on Vite glob + Vue. Runtime packages live under the app data `extensions/<id>/` tree, are ignored unless Developer Extensions is on, validate fail-closed, render inside a sandboxed iframe served via a host custom protocol, and talk only through a host bridge (storage + later commands). Sidecars are **out of this plan** (P2 follow-up).

**Tech Stack:** Vue 3 + TypeScript (frontend prefs/UI), Tauri 2 Rust (scan, path canonicalize, custom protocol, bridge commands), existing `npx tsx *.assert.ts` + `cargo test` patterns.

**Spec:** `docs/superpowers/specs/2026-07-22-runtime-extensions-design.md`

## Global Constraints

- Developer Extensions default **off** — AppData packages have zero effect when off
- Runtime packages are **untrusted**; never expose built-in Tauri command surface to the iframe
- Fail closed: unknown permissions, path escape, id≠folder → reject
- No Node/Python sidecars; no sidecar spawn in P0–P1
- No Integrations / credential access for runtime
- Storage keys: `kavibay:runtime:<extId>:<instanceId>`
- Built-in DX unchanged (`src/extensions/*` + `createInstanceStore`)
- Verify with `npx tsx …assert.ts`, `npx vue-tsc --noEmit`, and targeted `cargo test` / `cargo check -p kavibay_lib`

## Out of this plan (follow-up)

- **P2:** Sidecar spawn, stdio IPC, `backend.sidecar` consent  
- **P3:** Author template + pack tooling  
- **P4:** Marketplace + signing  

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/settings/developerPrefsLogic.ts` | Persist `developerExtensionsEnabled` |
| `src/settings/useDeveloperPrefs.ts` | Reactive prefs for Settings / loaders |
| `src/settings/BehaviorPanel.vue` | Developer Extensions toggle + warning |
| `src/core/runtime/permissions.ts` | Known permission catalog + check |
| `src/core/runtime/manifestValidate.ts` | Pure manifest/path validation (no FS) |
| `src/core/runtime/runtimeStorage.ts` | Host-side KV helpers for runtime keys |
| `src/core/runtime/runtimeTypes.ts` | Shared TS types for scan results / install records |
| `src/core/runtime/useRuntimeExtensions.ts` | FE registry: scan invoke, enabled set, merge for palette |
| `src/core/runtime/RuntimeExtensionFrame.vue` | Sandboxed iframe + postMessage bridge client wiring |
| `src/core/host/WidgetInstanceView.vue` | Branch: built-in component vs runtime iframe |
| `src/settings/RuntimeExtensionsPanel.vue` | List/enable/rescan/remove UI |
| `src/settings/SettingsModal.vue` | Nav entry when useful (or nest under Extensions) |
| `src/settings/ExtensionsPanel.vue` | Link/section for runtime when dev mode on |
| `src-tauri/src/runtime_extensions/mod.rs` | Root path, scan, validate on disk, serve protocol |
| `src-tauri/src/runtime_extensions/validate.rs` | Path join + canonicalize under package root |
| `src-tauri/src/runtime_extensions/protocol.rs` | `kavibay-ext` asset protocol |
| `src-tauri/src/lib.rs` | `mod runtime_extensions` + register commands/protocol |
| `docs/extensions.md` | Runtime power-user section |
| `docs/templates/runtime-extension-s/` | Minimal FE-only sample package (P1 end) |

---

### Task 1: Developer Extensions prefs (P0)

**Files:**
- Create: `src/settings/developerPrefsLogic.ts`
- Create: `src/settings/developerPrefsLogic.assert.ts`
- Create: `src/settings/useDeveloperPrefs.ts`

**Interfaces:**
- Produces:
  - `DEVELOPER_PREFS_KEY = "kavibay:developer-v1"`
  - `interface DeveloperPrefs { developerExtensionsEnabled: boolean }`
  - `DEFAULT_DEVELOPER_PREFS: DeveloperPrefs` with `developerExtensionsEnabled: false`
  - `normalizeDeveloperPrefs(raw: unknown): DeveloperPrefs`
  - `loadDeveloperPrefs(): DeveloperPrefs`
  - `saveDeveloperPrefs(state: DeveloperPrefs): void`
  - `useDeveloperPrefs()` → `{ developerExtensionsEnabled: Ref<boolean>, setDeveloperExtensionsEnabled(on: boolean): void }`

- [ ] **Step 1: Write failing assert**

```ts
/**
 * Run: npx tsx src/settings/developerPrefsLogic.assert.ts
 */
import {
  DEFAULT_DEVELOPER_PREFS,
  normalizeDeveloperPrefs,
} from "./developerPrefsLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  DEFAULT_DEVELOPER_PREFS.developerExtensionsEnabled === false,
  "default off",
);
assert(
  normalizeDeveloperPrefs(null).developerExtensionsEnabled === false,
  "null → off",
);
assert(
  normalizeDeveloperPrefs({ developerExtensionsEnabled: true })
    .developerExtensionsEnabled === true,
  "true preserved",
);
assert(
  normalizeDeveloperPrefs({ developerExtensionsEnabled: "yes" })
    .developerExtensionsEnabled === false,
  "non-boolean → off",
);

console.log("developerPrefsLogic.assert.ts: ok");
```

- [ ] **Step 2: Run assert — expect FAIL (module missing)**

Run: `npx tsx src/settings/developerPrefsLogic.assert.ts`  
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: Implement `developerPrefsLogic.ts` + `useDeveloperPrefs.ts`**

Mirror `extensionsPrefsLogic.ts` / `useExtensionsPrefs.ts` patterns: normalize, load/save `localStorage`, composable with `ref` + persist on set.

- [ ] **Step 4: Run assert — expect PASS**

Run: `npx tsx src/settings/developerPrefsLogic.assert.ts`  
Expected: `developerPrefsLogic.assert.ts: ok`

---

### Task 2: Settings toggle UI (P0)

**Files:**
- Modify: `src/settings/BehaviorPanel.vue`
- Modify: `docs/extensions.md` (short “Runtime packages” stub pointing at spec; full authoring in Task 8)

**Interfaces:**
- Consumes: `useDeveloperPrefs()`
- Produces: Settings checkbox “Developer Extensions” with warning copy from spec

- [ ] **Step 1: Add toggle to BehaviorPanel**

Under existing behavior controls, add:

```vue
<label class="behavior-check">
  <input
    type="checkbox"
    :checked="developerExtensionsEnabled"
    @change="onDeveloperExtensions"
  />
  <span>
    <span class="behavior-check-title">Developer Extensions</span>
    <span class="behavior-check-hint">
      Allow loading untrusted packages from the app data extensions folder.
      Packages with a native backend can run code as your user. Off by default.
    </span>
  </span>
</label>
```

Wire `onDeveloperExtensions` → `setDeveloperExtensionsEnabled(checked)`.

- [ ] **Step 2: Manual check**

Run app → Settings → Behavior → toggle on/off → reload → state persists; default for fresh profile is off.

- [ ] **Step 3: Stub docs**

In `docs/extensions.md`, add a short section:

```markdown
## Runtime packages (power users)

See [runtime extensions design](superpowers/specs/2026-07-22-runtime-extensions-design.md).
Requires **Settings → Behavior → Developer Extensions**. FE-only drop-in loading ships in P1; sidecars later.
```

---

### Task 3: Permission catalog + pure path/manifest validation (P1)

**Files:**
- Create: `src/core/runtime/permissions.ts`
- Create: `src/core/runtime/manifestValidate.ts`
- Create: `src/core/runtime/manifestValidate.assert.ts`
- Create: `src/core/runtime/runtimeTypes.ts`

**Interfaces:**
- Produces:
  - `export type RuntimePermission = "storage.instance" | "network.client"`  
    (note: `backend.sidecar` is **recognized but rejected in P1** with clear error — packages declaring it validate as “unsupported until P2” OR are loadable as FE-only if we strip backend; **decision: reject enable of packages that require `backend.sidecar` in P1**, still discoverable as `error: sidecar_not_supported`)
  - `KNOWN_RUNTIME_PERMISSIONS: ReadonlySet<string>`
  - `isKnownRuntimePermission(id: string): boolean`
  - `interface RuntimeManifest` — fields needed for runtime (id, name, version, ui.entry, ui.defaultOffset, commands, permissions, optional backend)
  - `type ValidateOk = { ok: true; manifest: RuntimeManifest }`
  - `type ValidateErr = { ok: false; error: string }`
  - `validateRuntimeManifest(folderName: string, raw: unknown): ValidateOk | ValidateErr`
  - `assertSafePackageRelativePath(rel: string): string | null` — returns error message or null if safe  
    Rules: non-empty, no backslash-normalized `..` segments, no absolute (`/`, `C:\`, UNC), no leading `..`

- [ ] **Step 1: Write failing assert** covering:
  - id must match folderName
  - reject `ui.entry` of `../evil.html`, `/etc/passwd`, `C:\\Windows\\x`
  - accept `ui/index.html`
  - unknown permission → error
  - missing `ui.entry` → error
  - `backend.sidecar` permission → `ok: false` with message containing `sidecar` (P1)

- [ ] **Step 2: Run assert — expect FAIL**

Run: `npx tsx src/core/runtime/manifestValidate.assert.ts`

- [ ] **Step 3: Implement permissions + validate**

Keep functions pure (no `localStorage`, no Tauri).

- [ ] **Step 4: Run assert — expect PASS**

---

### Task 4: Runtime storage helpers (P1)

**Files:**
- Create: `src/core/runtime/runtimeStorage.ts`
- Create: `src/core/runtime/runtimeStorage.assert.ts`

**Interfaces:**
- Produces:
  - `runtimeStorageKey(extId: string, instanceId: string): string` → `kavibay:runtime:${extId}:${instanceId}`
  - `loadRuntimeInstanceJson(extId, instanceId): unknown | null`
  - `saveRuntimeInstanceJson(extId, instanceId, value: unknown): void`
  - `clearRuntimeInstance(extId, instanceId): void`
  - `clearAllRuntimeStorageForExt(extId: string): void` — iterate `localStorage` keys with prefix `kavibay:runtime:${extId}:`

- [ ] **Step 1: Write assert** for key shape + clearAll only removes that ext’s keys (use a mock or real localStorage in tsx — if `localStorage` missing in node, use a tiny in-memory shim injected via optional `Storage` param defaulting to `globalThis.localStorage`, and pass a `Map`-backed mock in the assert).

Recommended signature for testability:

```ts
export function runtimeStorageKey(extId: string, instanceId: string): string;

export function clearAllRuntimeStorageForExt(
  extId: string,
  storage: Storage = globalThis.localStorage,
): void;
```

- [ ] **Step 2–4:** Red → implement → green (`npx tsx src/core/runtime/runtimeStorage.assert.ts`)

---

### Task 5: Rust scan + safe path join (P1)

**Files:**
- Create: `src-tauri/src/runtime_extensions/mod.rs`
- Create: `src-tauri/src/runtime_extensions/validate.rs`
- Modify: `src-tauri/src/lib.rs` — `mod runtime_extensions;` + register commands

**Interfaces:**
- Produces (Rust commands, serde JSON):
  - `runtime_extensions_root() -> Result<String, String>`  
    `{app_data_dir}/extensions` (create dir if missing)
  - `runtime_extensions_scan() -> Result<Vec<ScannedRuntimeExtension>, String>`  
    For each child dir: read `manifest.json`, run validation (port rules from Task 3 in Rust), check `ui.entry` exists on disk after `safe_join(package_root, entry)`.  
    `ScannedRuntimeExtension { id, name, version, description, path, ui_entry, permissions, commands, status: "ready" | "error", error: Option<String> }`
  - `fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String>` in `validate.rs` — unit-tested

- [ ] **Step 1: Write Rust unit tests** in `validate.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::safe_join;
    use std::path::PathBuf;

    #[test]
    fn rejects_parent_segment() {
        let root = PathBuf::from("/tmp/pkg");
        assert!(safe_join(&root, "../evil").is_err());
        assert!(safe_join(&root, "ui/../../evil").is_err());
    }

    #[test]
    fn accepts_nested_ui() {
        let root = PathBuf::from("/tmp/pkg");
        let p = safe_join(&root, "ui/index.html").unwrap();
        assert!(p.ends_with("ui/index.html"));
    }
}
```

- [ ] **Step 2: Run tests — expect FAIL/compile error**

Run: `cargo test -p kavibay_lib safe_join -- --nocapture`  
(Adjust package name if the crate is not `kavibay_lib` — use the name from `src-tauri/Cargo.toml`.)

- [ ] **Step 3: Implement `safe_join` + `scan` + `root`**

Duplicate the fail-closed manifest rules in Rust (do not trust the FE validator alone for disk). If `permissions` contains `backend.sidecar`, set `status: "error"`, `error: Some("sidecar_not_supported".into())` for P1.

- [ ] **Step 4: `cargo test` + `cargo check -p <crate>` PASS**

- [ ] **Step 5: Register commands** in `generate_handler![…]` and expose to frontend.

---

### Task 6: Custom protocol for package UI (P1)

**Files:**
- Create: `src-tauri/src/runtime_extensions/protocol.rs`
- Modify: `src-tauri/src/lib.rs` / app builder to register protocol
- Modify: CSP / Tauri capabilities as required so only this protocol loads extension UI

**Interfaces:**
- Produces: URL form `kavibay-ext://<extId>/<relative-path>` (exact scheme name: `kavibay-ext`)
- Resolver: map `extId` → scanned package root (from last scan cache or re-validate), `safe_join`, read file, return bytes + content-type
- Deny: missing ext, path escape, Developer flag is enforced on the **frontend before creating iframes**; protocol still must `safe_join` always

- [ ] **Step 1: Register protocol** following Tauri 2 custom protocol patterns already used in-repo if any; otherwise use `register_asynchronous_uri_scheme_protocol` / equivalent for the project’s Tauri version.

- [ ] **Step 2: Manual/integration check**

Place a fixture folder under app data `extensions/sample-runtime/` with `manifest.json` + `ui/index.html` (“hello”). With scan working, opening `kavibay-ext://sample-runtime/ui/index.html` in a test iframe shows content. Path `kavibay-ext://sample-runtime/../other` must fail.

- [ ] **Step 3: CSP**

Iframe default: deny broad network (`connect-src 'none'` unless grant — grant wiring can be stubbed in P1 as always-deny network from UI).

---

### Task 7: FE registry + palette/host integration (P1)

**Files:**
- Create: `src/core/runtime/useRuntimeExtensions.ts`
- Create: `src/core/runtime/runtimeInstallLogic.ts` — enabled ids + install records in `localStorage` (`kavibay:runtime-installs-v1`)
- Create: `src/core/runtime/runtimeInstallLogic.assert.ts`
- Modify: `src/palette/CommandPalette.vue` — include enabled runtime ext in add/search when dev mode on
- Modify: `src/core/host/WidgetHost.vue` — resolve `typeId` via built-in `getExtension` **or** runtime registry
- Modify: `src/core/host/WidgetInstanceView.vue` — render runtime frame when `def.origin === "runtime"`

**Interfaces:**
- Extend registered shape (runtime-only adapter, do not break built-in `RegisteredExtension`):

```ts
export type ExtensionOrigin = "builtin" | "runtime";

/** Adapter used by host/palette for both tiers. */
export interface HostExtensionRef {
  id: string;
  title: string;
  description: string;
  origin: ExtensionOrigin;
  /** Built-in: Vue component. Runtime: absent. */
  component?: Component;
  /** Runtime: path under kavibay-ext:// */
  runtimeEntryUrl?: string; // e.g. kavibay-ext://my-widget/ui/index.html
  allowDuplicate: boolean;
  position: { x: number; y: number };
  // chrome flags with safe defaults for runtime
  flush: boolean;
  compact: boolean;
  defaultHideTitle: boolean;
  grabCursor: boolean;
  fullDrag: boolean;
  resizable: boolean;
  playground: boolean;
  hugHeight: boolean;
  permissions: string[];
  commands: string[];
}
```

Prefer a thin adapter layer in `useRuntimeExtensions` rather than bloating `RegisteredExtension` if that keeps built-in types clean — but host must have **one** lookup: `resolveExtension(typeId): HostExtensionRef | undefined`.

- Install record:

```ts
interface RuntimeInstallRecord {
  id: string;
  enabled: boolean;
  grantedPermissions: string[];
}
```

Enable is allowed only if scan `status === "ready"` and Developer Extensions on. Enabling a package that needs only `storage.instance` grants that permission into the record.

- [ ] **Step 1: Assert install normalize/enable rules** (cannot enable when developer flag false — pass flag into pure function)

```ts
export function canEnableRuntimeExt(opts: {
  developerExtensionsEnabled: boolean;
  scanStatus: "ready" | "error";
}): boolean;
```

- [ ] **Step 2: Implement registry composable** — `rescan()`, `list()`, `setEnabled(id, on)`, maps to `HostExtensionRef`
- [ ] **Step 3: Wire host/palette lookup**
- [ ] **Step 4: `npx vue-tsc --noEmit` PASS**

---

### Task 8: Sandboxed iframe + storage bridge (P1)

**Files:**
- Create: `src/core/runtime/RuntimeExtensionFrame.vue`
- Create: `src/core/runtime/bridgeProtocol.ts` — message types
- Modify: `src-tauri/src/runtime_extensions/mod.rs` — optional Tauri commands `runtime_storage_get|set|clear` that re-check ext enabled + permission (defense in depth). FE may implement storage in the host Vue bridge without Rust if simpler — **prefer host Vue bridge first** (parent window handles `postMessage`, uses `runtimeStorage.ts`), so iframe never sees `localStorage` of the host.

**Interfaces:**
- `bridgeProtocol.ts`:

```ts
export type ExtToHost =
  | { type: "kavibay.ext.ready"; extId: string }
  | {
      type: "kavibay.ext.storage.get";
      requestId: string;
      extId: string;
      instanceId: string;
    }
  | {
      type: "kavibay.ext.storage.set";
      requestId: string;
      extId: string;
      instanceId: string;
      value: unknown;
    };

export type HostToExt =
  | { type: "kavibay.ext.storage.result"; requestId: string; ok: true; value: unknown }
  | { type: "kavibay.ext.storage.result"; requestId: string; ok: false; error: string };
```

- Frame component props: `extId: string`, `instanceId: string`, `entryUrl: string`, `grantedPermissions: string[]`
- On message: **ignore payload `extId`**; use prop `extId` from parent. Deny storage if `storage.instance` not granted.
- Iframe attributes: `sandbox="allow-scripts"` (no `allow-same-origin` if custom protocol provides unique origin; if protocol forces same-origin issues, document the chosen isolation tradeoff in a code comment and keep storage host-mediated).

- [ ] **Step 1: Implement `RuntimeExtensionFrame.vue` + protocol types**
- [ ] **Step 2: WidgetInstanceView uses it when `origin === "runtime"`**
- [ ] **Step 3: Fixture package** `docs/templates/runtime-extension-s/` with `manifest.json` + `ui/index.html` that posts storage set/get round-trip and displays result
- [ ] **Step 4: Manual UI checklist**
  - [ ] Developer Extensions off → fixture ignored
  - [ ] On → Rescan → appears in Runtime list
  - [ ] Enable → appears in palette → add instance → iframe renders
  - [ ] Storage round-trip works
  - [ ] Disable → instance hidden/removed per existing disabled-ext behavior
  - [ ] `vue-tsc` clean

---

### Task 9: Runtime Extensions settings panel (P1)

**Files:**
- Create: `src/settings/RuntimeExtensionsPanel.vue`
- Modify: `src/settings/ExtensionsPanel.vue` — when developer mode on, show nested runtime section or link
- Modify: `src/settings/SettingsModal.vue` only if a separate nav item is cleaner; otherwise embed under Extensions

**Interfaces:**
- Consumes: `useDeveloperPrefs`, `useRuntimeExtensions`
- UI: table/list of scanned packages (name, version, path, status, error), Enable checkbox, Rescan button, Open folder (invoke reveal `runtime_extensions_root`), Remove = `setEnabled(false)` + optional delete via new command `runtime_extension_remove(id)` that deletes package dir only after confirm

- [ ] **Step 1: Build panel matching ExtensionsPanel visual language**
- [ ] **Step 2: Manual checklist** — error row for package with `backend.sidecar`; ready row for FE-only template
- [ ] **Step 3: Update `docs/extensions.md`** with power-user steps (copy template → app data `extensions/<id>/` → enable Developer Extensions → Rescan → Enable → palette)

---

### Task 10: Verification gate (P1 exit)

- [ ] **Step 1: Run all new asserts**

```bash
npx tsx src/settings/developerPrefsLogic.assert.ts
npx tsx src/core/runtime/manifestValidate.assert.ts
npx tsx src/core/runtime/runtimeStorage.assert.ts
npx tsx src/core/runtime/runtimeInstallLogic.assert.ts
```

Expected: each prints `ok`

- [ ] **Step 2: Typecheck + Rust**

```bash
npx vue-tsc --noEmit
cargo test -p kavibay_lib runtime_extensions
cargo check -p kavibay_lib
```

(Use actual crate name from `src-tauri/Cargo.toml`.)

- [ ] **Step 3: Manual security smoke**
  - [ ] Dev mode off → zero runtime effect
  - [ ] Path-traversal `ui.entry` → status error, no iframe
  - [ ] Iframe cannot `invoke` built-in commands (attempt in fixture → fail/no-op)
  - [ ] Storage prefix isolation between two fixture ext ids

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| Developer Extensions default off | 1–2 |
| AppData extensions root | 5 |
| Manifest/path validation fail-closed | 3, 5 |
| FE iframe sandbox + CSP | 6, 8 |
| Bridge storage host-mediated | 4, 8 |
| No built-in invoke from runtime | 8 |
| Settings list / enable / rescan | 9 |
| Docs for power users | 2, 9 |
| Sidecar | **Deferred P2** (explicit reject in P1) |
| Marketplace / signing | **Deferred P4** |

## Placeholder scan

None intentional. Crate name verified at Task 5 from `src-tauri/Cargo.toml`. Protocol registration API verified against installed Tauri 2 docs/patterns in-repo at Task 6.
