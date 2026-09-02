# Windows Installer (local NSIS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure Kavibay so `npm run package:win` builds an unsigned, current-user NSIS setup `.exe` on Windows, with short README packaging notes.

**Architecture:** Use Tauri 2’s built-in bundler only. Narrow `bundle.targets` to `nsis`, set `bundle.windows.nsis.installMode` to `currentUser`, add an npm script, and document the local build path. No custom WiX, no signing, no CI.

**Tech Stack:** Tauri 2 CLI, NSIS (managed by Tauri on Windows), npm scripts, existing Vue/Rust app build pipeline.

**Spec:** `docs/superpowers/specs/2026-07-22-windows-installer-design.md`

## Global Constraints

- Windows host only for this pass (no cross-compile from macOS/Linux)
- Artifact: unsigned NSIS `*-setup.exe` under `src-tauri/target/release/bundle/nsis/`
- Install scope: `currentUser` (no admin elevation)
- Do not add code signing, MSI, GitHub Releases, or macOS targets in this plan
- Touch only packaging config, `package.json` script, and `README.md` packaging docs
- Do not commit unrelated dirty working-tree files
- Comment any new non-obvious config with a short purpose note where the repo already comments nearby

## File Structure

| File | Responsibility |
|------|----------------|
| `src-tauri/tauri.conf.json` | Bundle targets + NSIS `installMode` |
| `package.json` | `package:win` script |
| `README.md` | How to build the Windows installer + SmartScreen caveat |

---

### Task 1: Tauri NSIS bundle config + package script + README

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing Tauri 2 `bundle` block (`active`, `targets`, `icon`)
- Produces:
  - `bundle.targets`: `["nsis"]`
  - `bundle.windows.nsis.installMode`: `"currentUser"`
  - npm script `package:win` → `tauri build`
  - README section documenting build command, output path, unsigned warning

- [ ] **Step 1: Update `src-tauri/tauri.conf.json` bundle section**

Replace the current `bundle` object so it matches:

```json
"bundle": {
  "active": true,
  "targets": ["nsis"],
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ],
  "windows": {
    "nsis": {
      "installMode": "currentUser"
    }
  }
}
```

Keep `productName`, `version`, `identifier`, `build`, and `app` blocks unchanged.

- [ ] **Step 2: Add npm script in `package.json`**

In `scripts`, add:

```json
"package:win": "tauri build"
```

Keep existing `dev`, `build`, `preview`, and `tauri` scripts unchanged. Final `scripts` block should look like:

```json
"scripts": {
  "dev": "vite",
  "build": "vue-tsc --noEmit && vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "package:win": "tauri build"
}
```

- [ ] **Step 3: Add packaging section to `README.md`**

Append (do not remove the existing IDE setup section):

```markdown
## Packaging (Windows)

Build a current-user NSIS installer locally (unsigned):

```bash
npm run package:win
```

The setup executable is written to:

`src-tauri/target/release/bundle/nsis/`

Notes:

- Run this on a Windows machine with the normal Kavibay toolchain (Node, Rust, Tauri CLI).
- The installer uses Tauri’s NSIS bundle with `installMode: currentUser` (no admin elevation).
- The build is unsigned, so Windows SmartScreen may warn when opening the setup file.
- macOS packaging is not set up yet.
```

- [ ] **Step 4: Sanity-check config JSON**

Run:

```bash
node -e "const c=require('./src-tauri/tauri.conf.json'); if(!Array.isArray(c.bundle.targets)||c.bundle.targets.join()!=='nsis') process.exit(1); if(c.bundle.windows?.nsis?.installMode!=='currentUser') process.exit(2); console.log('bundle ok', c.bundle.targets, c.bundle.windows.nsis.installMode)"
node -e "const p=require('./package.json'); if(p.scripts['package:win']!=='tauri build') process.exit(1); console.log('script ok', p.scripts['package:win'])"
```

Expected:

```
bundle ok [ 'nsis' ] currentUser
script ok tauri build
```

- [ ] **Step 5: Build the installer (manual verification on Windows)**

Run:

```bash
npm run package:win
```

Expected:

- Exit code `0`
- A file matching `*-setup.exe` appears under `src-tauri/target/release/bundle/nsis/`

If NSIS tooling is missing, follow Tauri’s Windows installer docs and re-run until the setup `.exe` is produced.

Optional manual install check (same machine):

1. Run the setup `.exe` as a normal user — no UAC/admin prompt
2. Launch Kavibay
3. Uninstall from Settings → Apps

- [ ] **Step 6: Commit only packaging files**

```bash
git add src-tauri/tauri.conf.json package.json README.md
git commit -m "Add local Windows NSIS packaging."
```

Do not stage unrelated dirty files.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `bundle.targets` → `nsis` | Task 1 Step 1 |
| `installMode: currentUser` | Task 1 Step 1 |
| `npm run package:win` | Task 1 Step 2 |
| README packaging notes + SmartScreen | Task 1 Step 3 |
| Manual verify setup `.exe` / no admin | Task 1 Step 5 |
| No signing / CI / macOS / MSI | Global Constraints |

## Self-review notes

- No placeholders or TBD steps
- Exact JSON/scripts/README content included
- Single task is appropriate: config + script + docs are one deliverable (the installer)
- `installMode` default in Tauri is already `currentUser`; setting it explicitly matches the spec and keeps intent visible in-repo
