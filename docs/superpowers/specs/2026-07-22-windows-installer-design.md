# Windows installer (local NSIS) — Design

**Date:** 2026-07-22  
**Status:** Approved for planning  
**App:** Kavibay (Tauri 2 + Vue)

## Goal

Produce a **local, unsigned Windows setup executable** (NSIS) that installs Kavibay for the **current user only** (no admin elevation).

## Decisions

| Topic | Choice |
|-------|--------|
| Distribution | Local build only (no CI / GitHub Releases yet) |
| Format | NSIS setup `.exe` (not MSI) |
| Install scope | Current user (`installMode: "currentUser"`) |
| Code signing | None for now |
| macOS | Out of scope now; same Tauri bundler later (`dmg` / `app`) |

**Why NSIS instead of MSI:** Tauri’s MSI/WiX path has no first-class per-user switch; NSIS supports `currentUser` natively. MSI can be revisited later if enterprise packaging is needed.

## Scope

### In scope

- Configure Tauri `bundle` for NSIS + current-user install
- Add `npm run package:win` convenience script
- Short packaging section in `README.md`: how to build, artifact path, unsigned/SmartScreen caveat
- Leave a clear path for future macOS packaging (no implementation)

### Out of scope

- Code signing / SmartScreen remediation
- GitHub Releases / CI
- Auto-updates
- macOS `.dmg` / `.app`
- MSI / custom WiX templates
- Custom installer UI beyond Tauri NSIS defaults

## Architecture

Build and package via Tauri’s built-in bundler. No separate installer project.

```
npm run package:win
  → tauri build
  → frontend (vite) + Rust release
  → NSIS bundle
  → src-tauri/target/release/bundle/nsis/*-setup.exe
```

### Config (`src-tauri/tauri.conf.json`)

- `bundle.active`: keep `true`
- `bundle.targets`: `["nsis"]` (Windows-focused; avoid building unused targets locally)
- `bundle.windows.nsis.installMode`: `"currentUser"`
- Keep existing `productName`, `identifier`, and `icon` entries
- No certificate / signing fields

### Scripts (`package.json`)

- Add `"package:win": "tauri build"`
- Leave existing `dev` / `build` / `tauri` scripts unchanged

### Prerequisites

- Existing Kavibay toolchain: Node, Rust, Tauri CLI
- Build on a Windows host (this pass does not cover cross-compiling Windows installers from macOS/Linux)
- NSIS tooling as required by Tauri CLI (downloaded/managed per Tauri docs; no WiX)

### Output

- Installer: `src-tauri/target/release/bundle/nsis/<name>-setup.exe`
- Unsigned → Windows SmartScreen may warn; acceptable for local/dev installs

## Workflow

1. Developer runs `npm run package:win` on Windows
2. Tauri builds frontend + Rust release binary and runs NSIS bundling
3. Developer runs the generated setup `.exe` as a normal user (no UAC for current-user mode)
4. Kavibay installs to a per-user location; Start Menu / Apps & Features uninstall entry should appear

## Error handling

- If NSIS tooling is missing or bundling fails, `tauri build` fails with a clear CLI error — fix by installing/restoring Tauri’s NSIS dependencies per official docs
- No custom retry/fallback packaging paths in this pass

## Verification (manual)

- [ ] `npm run package:win` exits 0 and produces a setup `.exe` under `bundle/nsis/`
- [ ] Running the setup does not require admin elevation
- [ ] Kavibay launches after install
- [ ] App can be uninstalled from Windows Settings → Apps

## Future: macOS

When needed: add macOS bundle targets (`dmg` and/or `app`), a `package:mac` script, and short macOS docs (signing/notarization likely required for distribution). No redesign of the Windows path.

## Future: MSI / signing / CI

Optional follow-ups, not part of this design:

- MSI via WiX (possibly custom template if per-user MSI is required)
- Code signing certificate + Tauri signing config
- GitHub Actions release workflow uploading installers on tag
