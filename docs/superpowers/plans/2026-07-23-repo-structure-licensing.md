# Repo Structure & Licensing Split — Plan

Date: 2026-07-23  
Status: **✅ done 2026-07-23** (mechanical PR on `chore/repo-structure-licensing`).  
Decisions locked with Alex: extension Rust backends stay in core (GPL); restructure
happens **now, before hardening phase P0.3**; contributions secured via **DCO**.

> Not legal advice. The model below follows established open-source practice
> (GPL FAQ on plugins/IPC, per-directory licensing as in Linux/LLVM). For final
> certainty on the GPL boundary, have a lawyer confirm once before 1.0.

## 1. Assessment — does the split make sense?

**Yes.** The proposed model is coherent and has one property that makes it unusually
clean for this codebase:

**The sandbox boundary is also the license boundary.** Runtime packages communicate
with the core exclusively via postMessage/IPC across an opaque-origin iframe — under
the GPL FAQ that is "communication at arm's length": they are separate programs, not
derivative works. Third-party runtime extensions may therefore use **any license,
including proprietary**, as long as everything they embed (the runtime SDK, copied
example code) is MIT. That is exactly what `sdk/` + `examples/` being MIT enables,
and it matches the sandbox-first community strategy.

Two corrections to the naive version of the split:

1. **The SDK must be self-contained, not a re-export facade.** If `sdk/` (MIT) merely
   re-exported implementations living in `core/` (GPL), the MIT label would be
   misleading — consumers would actually be linking GPL code. Therefore the
   implementations of the extension-facing surface (`types`, `createInstanceStore`,
   `instanceStorageKey`, `useWidgetData`, runtime bridge protocol types) **move into
   `sdk/`**, and core imports them from there.
   Allowed dependency directions (enforced by ESLint boundaries, P1.2):
   `core → sdk` ✔, `extensions → sdk` ✔, `sdk → core` ✘, `sdk → extensions` ✘.
   *This amends hardening P2.1, which described the barrel as "re-exports only" —
   it is the other way around.*
2. **First-party extensions compile into the GPL app.** The files under `extensions/`
   are MIT (anyone may copy them, e.g. to port a widget into a proprietary runtime
   package), but the **distributed application binary as a whole is GPLv3**. Their
   Rust backends (tado, calendar, github-actions, …) stay in core and are plainly
   GPL — the MIT promise covers what a community author can actually reuse:
   frontend reference code + the SDKs.

**Timing matters:** the repo currently has **no LICENSE at all** (= "all rights
reserved" by default). Every commit so far is Alex's own, so relicensing is still
frictionless. After the first external PR it would require contributor consent —
do this split **before** opening the gates.

## 2. Target structure

```
/
├── LICENSE                    # human-readable map: which dir = which license (SPDX)
├── CONTRIBUTING.md            # P1.4 + DCO + per-directory license rule
├── package.json, vite.config.ts, tsconfig.json, index.html   # root build config → GPL (core build)
├── core/                      # GPL-3.0 — the application frontend
│   ├── LICENSE                # full GPLv3 text
│   └── app/                   # ← src/ minus extensions/ (App.vue, main.ts, core/, palette/, settings/, system/)
├── src-tauri/                 # GPL-3.0 — Rust backend (stays at repo root; LICENSE map: part of core)
├── sdk/                       # MIT — everything extension authors link/copy
│   ├── LICENSE
│   ├── extension/             # first-party TS SDK (implementations live HERE, core imports from it)
│   └── runtime/               # kavibay-ext-sdk.js + .d.ts for sandboxed packages (P2.2 lands here)
├── extensions/                # MIT — ← src/extensions/ (first-party FE reference implementations)
│   └── LICENSE
├── examples/                  # MIT — ← docs/templates/ (runtime-extension-s, ipc-probe, network probes)
│   └── LICENSE
└── docs/                      # CC-BY-4.0 — guides, specs, plans
    └── LICENSE
```

Root-level build/config files and `scripts/` default to the core license (stated in
root LICENSE). `.superpowers/` agent work logs get an explicit "internal artifacts,
no license grant" line in the root LICENSE (or are pruned — optional cleanup).

## 3. Toolchain feasibility (Rust + Vue + Vite + Tauri)

- **Vite/Vue: fully flexible.** Vite root stays the repo root (`index.html` stays
  put). `src/` is convention, not requirement. Changes: tsconfig `paths` +
  `include`, the `@sdk` alias → `sdk/extension/`, and `loadExtensions.ts` switches
  its globs to Vite-root-relative form (`/extensions/*/manifest.json`,
  `/extensions/*/index.ts`) — `import.meta.glob` supports that natively.
- **Tauri: the one genuine risk.** The v2 CLI locates the app by the `src-tauri`
  directory convention. **Task 0 is a spike** with this fallback ladder:
  1. `core/src-tauri/` with npm scripts invoking the CLI from `core/`
     (adjust `frontendDist`/`devUrl` relative paths accordingly);
  2. if the CLI fights back: keep `src-tauri/` at the repo root and declare it part
     of core in the LICENSE map ("core = core/ + src-tauri/") — the license story
     survives even if the folder cannot move.
  Decide after a 30-minute spike; do not force option 1 at any cost.

  **Spike outcome (2026-07-23):** Option 2 — keep `src-tauri/` at the repo root.
  `git mv` to `core/src-tauri/` failed with Permission denied (likely file locks
  under `src-tauri/target` on Windows). LICENSE map treats core as `core/` +
  `src-tauri/`. Do not revisit unless packaging needs change.

- **Rust:** single crate, unchanged (backends stay in core — locked decision).
  `Cargo.toml` gains `license = "GPL-3.0-or-later"`.
- **npm:** single root package.json remains. When `sdk/runtime` is published to npm
  later (post-P2.2), introduce npm workspaces **then**, not now.

## 4. License mechanics

1. **Root `LICENSE`**: table mapping directories → SPDX ids
   (`core/`, root configs, `scripts/` → `GPL-3.0-or-later`; `sdk/`, `extensions/`,
   `examples/` → `MIT`; `docs/` → `CC-BY-4.0`), plus: binary distributions are
   GPLv3; "Kavibay" name/branding not covered by the code licenses (optional
   trademark note); internal work-log dirs excluded.
   *Open sub-decision (low stakes): `GPL-3.0-only` vs `-or-later` — plan assumes
   `-or-later` (FSF recommendation); flip if you want version pinning.*
2. **Per-directory `LICENSE` files** with the full license texts.
3. **SPDX headers** (`// SPDX-License-Identifier: MIT`) mandatory in `sdk/**` and
   `examples/**` — these files are *meant* to be copied out of the repo, the header
   travels with them. Recommended-not-required elsewhere. CI assert later (P1
   addition).
4. **Metadata**: package.json `"license": "SEE LICENSE IN LICENSE"`,
   Cargo.toml `license = "GPL-3.0-or-later"`, README licensing section.
5. **DCO**: CONTRIBUTING gains the Developer Certificate of Origin + required
   `Signed-off-by` trailer; CI gains a DCO check action (P1.1 addition). Rule:
   contributions land under the license of the directory they touch
   (inbound = outbound), stated explicitly.
6. **Dependency license audit** (CI, P1.1 addition): `cargo deny check licenses`
   (allowlist: MIT, Apache-2.0, BSD-*, ISC, Zlib, MPL-2.0, Unicode) +
   `license-checker` for npm. Current deps (Tauri, Vue, tiptap, rusqlite,
   windows-rs, reqwest, …) are all MIT/Apache — GPL-compatible; the audit keeps it
   that way.
7. **Asset inventory** (own task, before the repo is advertised):
   - ⚠️ **moodist sounds**: vendored partly under the **Pixabay Content License**,
     which restricts redistribution of content "as-is" — review each sound; keep
     only CC0 ones or document a defensible position. This is the one real
     licensing risk found in the audit.
   - emoji-picker data + inline icon sets: confirm sources and record them in a
     root-level `THIRD-PARTY-NOTICES.md` (grows over time).
   - docs: code snippets inside CC-BY docs are additionally MIT (note in
     `docs/LICENSE` preamble) so readers can paste them freely.

## 5. Migration steps (one mechanical PR)

0. **Spike**: Tauri CLI with `core/src-tauri/` (fallback ladder above). Outcome
   fixes the final tree. — ✅ Option 2 (`src-tauri/` at root); see §3.
1. Add all LICENSE files + root LICENSE map + THIRD-PARTY-NOTICES.md skeleton +
   metadata fields (this alone is already a huge win — do it even if the moves
   were postponed). — ✅ commit `docs: add per-directory licensing…`
2. `git mv` (history-preserving), in this order:
   - `src/core/extensions/{types,createInstanceStore,instanceStorageKey}.ts`,
     `src/core/host/useWidgetData.ts` → `sdk/extension/` (runtime bridge types
     deferred to P2.2 per Cursor prompt).
   - `src/extensions/` → `extensions/`
   - remaining `src/` → `core/app/`
   - `docs/templates/` → `examples/`
   - `src-tauri/` → per spike outcome (stays at root).
   — ✅ commit `chore: relocate app, extensions, sdk, and examples trees`
3. Config updates: vite aliases (`@sdk`), tsconfig paths/includes, root-relative
   `import.meta.glob` in `loadExtensions.ts`, tauri.conf
   `frontendDist`/`beforeDevCommand`, package.json scripts, `.cursor` skill file
   references, docs path references. — ✅ fix-up commit (SPDX + imports + configs)
4. Regenerate `2026-07-23-hardening-cursor-prompts.md` with the new paths
   (P0.3 onward), including the P2.1 amendment (barrel shrinks to alias +
   boundary tightening, since implementations now live in `sdk/`).
   — ⏸ deferred to maintainer (explicitly out of scope for this PR).
5. Verify: `npm run build` green, `cargo test --lib` green (baseline 105+),
   `npm run tauri dev` smoke (hotkey, widgets, one runtime package via the new
   `examples/` path), `git log --follow` shows history through the moves.
   — ✅ `npm run build` + 105 lib tests; `git log --follow` on `core/app/App.vue`
   and `sdk/extension/createInstanceStore.ts` shows pre-move history. Manual
   `tauri dev` smoke left for maintainer review before merge.

## 6. Amendments to the hardening plan (2026-07-23)

- **P2.1**: implementations already in `sdk/extension/` after the move → task
  shrinks to: alias verification, extension import migration, ESLint boundary
  tightening (incl. `sdk` must not import `core`/`extensions`).
- **P1.1**: add DCO check + `cargo deny` + npm `license-checker` jobs.
- **P1.2**: boundary rule paths change to root-level `extensions/**`, `core/**`,
  `sdk/**` — folder level now equals license level, which makes the rules simpler
  and legally meaningful.
- **P1.4**: CONTRIBUTING adds DCO + per-directory license rule.
- **P2.2**: runtime SDK lands in `sdk/runtime/`, templates in `examples/`.
- Path references in P0.3+ prompts: regenerated in step 5.4.

## 7. Cursor prompt for the migration PR

```
Read docs/superpowers/plans/2026-07-23-repo-structure-licensing.md first — it is the
authoritative plan for this PR and encodes decisions already made with the maintainer
(extension Rust backends stay GPL in core; DCO comes later with CONTRIBUTING in P1.4).
Hardening phases P0.1/P0.2 are done; P0.3+ is PAUSED until this restructure lands —
do not implement any hardening features here.

This PR is MECHANICAL: moves, license files, config/import fixes. No refactors, no
logic changes, no identifier renames. Use `git mv` for every move and keep moves and
content edits in SEPARATE commits so rename detection and `git log --follow` work.

Stage 0 — Tauri spike (timebox ~30 min):
Try relocating src-tauri/ to core/src-tauri/ with npm scripts invoking the tauri CLI
so it finds the app dir (adjust frontendDist/devUrl relative paths). If the v2 CLI
fights the relocation, FALL BACK: keep src-tauri/ at the repo root and record in the
root LICENSE map that core = core/ + src-tauri/. Document the chosen outcome in plan
§3. Do not burn hours on option 1.

Stage 1 — licensing files (own commit, valuable even alone):
- Root LICENSE: directory→license map per plan §4 (core/ + root configs + scripts/ →
  GPL-3.0-or-later; sdk/, extensions/, examples/ → MIT; docs/ → CC-BY-4.0), binary
  distributions are GPLv3, "Kavibay" branding note, .superpowers/ = internal work
  logs with no license grant.
- Full license texts: core/LICENSE (GPLv3), sdk/LICENSE + extensions/LICENSE +
  examples/LICENSE (MIT, copyright Alex Swetlow), docs/LICENSE (CC-BY-4.0 + note
  that code snippets in docs are additionally MIT).
- THIRD-PARTY-NOTICES.md skeleton at root (move the content pointers from
  src/extensions/moodist/LICENSES.md into it, but leave the moodist files
  themselves untouched — the Pixabay sound review is a separate task).
- package.json: "license": "SEE LICENSE IN LICENSE". Cargo.toml:
  license = "GPL-3.0-or-later". README: short licensing section linking LICENSE.

Stage 2 — moves (git mv), then a separate fix-up commit:
a) Create sdk/extension/ and move (with SPDX-License-Identifier: MIT headers):
   src/core/extensions/types.ts, createInstanceStore.ts + createInstanceStore.assert.ts,
   instanceStorageKey.ts, and src/core/host/useWidgetData.ts. Core imports repoint to
   sdk. (Runtime bridge types stay put — they move with P2.2.)
b) src/extensions/ → extensions/
c) remaining src/ → core/app/ (index.html now references /core/app/main.ts)
d) docs/templates/ → examples/ (runtime-extension-s, ipc-probe, …)
e) src-tauri/ per Stage 0 outcome.
Fix-up commit: vite config (@sdk alias → sdk/extension, any root/fs settings),
tsconfig paths + include, loadExtensions.ts globs become Vite-root-relative
("/extensions/*/manifest.json", "/extensions/*/index.ts"), tauri.conf
frontendDist/beforeDevCommand, package.json scripts, .gitignore paths,
.cursor/skills/kavibay-widget/* path references, docs/extensions.md +
runtime docs (install path now examples/…).

Guardrails:
- sdk/** must not import from core/** or extensions/** afterwards — verify with a
  grep and fix by moving the offending type/helper INTO sdk, never by re-exporting
  core from sdk.
- Folder name must still equal manifest.id for every extension (glob discovery).
- Do not touch: moodist sound files, CONTRIBUTING.md,
  docs/superpowers/plans/2026-07-23-hardening-cursor-prompts.md (the maintainer
  regenerates that with new paths).

Verify (all must pass before marking done):
- npm run build green; cargo test --lib green (baseline 105+ tests).
- npm run tauri dev smoke: Ctrl+Space opens the cockpit, built-in widgets render,
  adding a widget from the palette works, runtime-extension-s installs from
  examples/ following the updated docs.
- git log --follow core/app/main.ts (or equivalent moved file) shows pre-move history.
- grep confirms: no imports from src/ remain; sdk/ imports nothing from core/.
Then mark plan §5 steps as done in the plan doc with a short completion note.
```
