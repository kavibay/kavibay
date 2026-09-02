# CI/CD & Contributor Pipeline — V1

Date: 2026-08-08
Scope: GitHub Actions for PR checks and releases, plus the contributor surface around
them. Supersedes and makes concrete P1.1–P1.4 of
[2026-07-23-architecture-security-hardening.md](2026-07-23-architecture-security-hardening.md)
(whose paths still say `src/extensions`, `src/sdk` — pre-restructure).

Goal of this phase: **many good extension contributions**. Every decision below is
weighed against "does this make writing a widget easier, or does it add a hurdle?"

> **Status 2026-08-08:** steps 1–7 of the order below are implemented — npm chosen,
> ESLint + guard scripts + `npm run verify` in place, all five workflows written, the
> contributor surface (CONTRIBUTING, SECURITY, PR/issue templates, CODEOWNERS,
> Dependabot, labeler) created. What remains is repo-settings work only: branch
> protection, labels, Discussions, and a `v0.1.0` dry-run release. Deviations from the
> plan as first written are marked **[changed]** below.

## Constraints (locked)

- Free tier only. GitHub Actions is free and minute-unlimited on standard runners for
  **public** repos — that is the whole budget. No Codecov, no external CI, no larger runners.
- Fast PR feedback. Target: **frontend checks < 2 min, full PR gate < 6 min warm**.
- No new test framework. The repo's `*.assert.ts` convention stays; CI aggregates it.
- No scaffold CLI (AGENTS.md). Scaffolding happens by **copying a template folder**
  and via the existing Widget Wizard.
- Contribution friction beats process purity: no CLA bot, no DCO sign-off, no changelog
  file to edit by hand, no required issue before a PR. (A zero-friction *relicensing
  grant* in CONTRIBUTING.md is the one exception — see "Keeping monetization possible".)

## Where we stand

| Piece | Status |
|-------|--------|
| `.github/` | **does not exist** — no workflows, templates, CODEOWNERS |
| Tests | 71 × `*.assert.ts/.mjs`, 53 Rust `#[cfg(test)]` modules (~105 lib tests) — all run by hand |
| Lint/format | **none** (no ESLint, no Prettier, no `rustfmt` check) |
| Typecheck | `npm run build` = `vue-tsc --noEmit && vite build` |
| Windows packaging | `package:win` (NSIS), `package:win:standalone` (`--no-bundle`) — manual |
| Linux | `scripts/dev-linux.sh` for dev; **no bundle target configured** |
| CONTRIBUTING / SECURITY | missing |

## Decisions to make before writing a single workflow

These three block everything else and are cheap to settle.

**1. One package manager.** The repo has *both* `package-lock.json` and `pnpm-lock.yaml`,
plus a `pnpm-workspace.yaml` whose content is a placeholder
(`allowBuilds: esbuild: set this to true or false`). CI needs exactly one, and a
contributor hitting the wrong one gets a mysterious install failure.
→ **Recommendation: npm.** `src-tauri/tauri.conf.json` calls `npm run build` /
`npm run dev` in `beforeBuildCommand`/`beforeDevCommand`, and AGENTS.md documents npm.
Delete `pnpm-lock.yaml` and `pnpm-workspace.yaml`. (Choosing pnpm instead is fine but
means editing `tauri.conf.json` and every doc — more churn for no gain today.)

**2. Version lives in three files.** `package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`. A release with drifted versions ships an installer whose
"about" lies. → `scripts/versionSync.assert.mjs` in the normal assert set (see below).
Bumping stays manual — three edits, one guard, no release-please machinery.

**3. Merge strategy = squash only, PR title is the changelog line.** Enables
auto-generated release notes with zero maintenance. Turn off merge commits and rebase
merges in repo settings so the history stays one-line-per-PR.

## V1 — what gets built

```
.github/
  workflows/
    ci.yml                  # PR + push to main
    release.yml             # tag v*
    preview-build.yml       # `build:installer` label, and every push to main
    pr-title.yml            # conventional-commit check
    labeler.yml             # auto-label by changed path
  ISSUE_TEMPLATE/
    bug.yml
    extension-idea.yml
    config.yml
  PULL_REQUEST_TEMPLATE.md
  CODEOWNERS
  dependabot.yml
  labeler.yml
  release.yml               # release-notes categories
CONTRIBUTING.md
SECURITY.md
eslint.config.js
scripts/
  runAsserts.mjs            # glob + run every *.assert.{ts,mjs}
  importBoundaries.assert.mjs
  versionSync.assert.mjs
  extensionManifests.assert.mjs
  spdxHeaders.assert.mjs
```

### 1. One verify entry point (do this first, before any YAML)

CI must run exactly what a contributor can run locally — otherwise a red X is a
scavenger hunt and people give up.

```jsonc
// package.json scripts
"lint":        "eslint .",
"typecheck":   "vue-tsc --noEmit",
"test:assert": "node scripts/runAsserts.mjs",
"verify":      "npm run typecheck && npm run lint && npm run test:assert",
"verify:rust": "cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo clippy ... && cargo test ... --lib"
```

**[changed] No Prettier in V1.** It would mean reformatting every file in the repo
before the first outside PR arrives, for a benefit ESLint's correctness rules already
cover. `cargo fmt --check` *is* in CI — the Rust side was three files away from clean,
so it cost one mechanical commit instead of a repo-wide one. Prettier stays available
as a later decision.

`scripts/runAsserts.mjs`: globs `**/*.assert.{ts,mjs}` (excluding `node_modules`,
`src-tauri/target`), spawns each through `tsx`, prints one line per file, collects
**all** failures instead of stopping at the first — a contributor should see every
broken assert in one run. ~71 files; run 4–8 in parallel, expect < 20 s total.

**ESLint scope for V1 — keep it small on purpose.** Flat config, `eslint-plugin-vue` +
`typescript-eslint` in *non-type-aware* mode (type-aware linting doubles the runtime and
duplicates what `vue-tsc` already catches). Correctness rules only; the repo came out
clean after ignoring Vite's `vite-env.d.ts` shim and switching off `no-useless-assignment`.

**[changed] The import boundaries moved out of ESLint into
`scripts/importBoundaries.assert.mjs`.** The rule is really an *allowlist* — "an
extension may import its own folder and packages" — and `no-restricted-imports` can only
express denylists of globs. Trying to write it that way produced patterns that both
over-matched (`../*/**` also matches `../../core/...`, so every violation was reported
twice) and silently failed to honour `!` negations for the known exceptions. As a guard
script the rule becomes one readable sentence: **a relative import may not leave its own
extension folder**, which covers "no core internals" and "no cross-extension imports" at
once, and the exceptions are a visible array.

**Finding: the boundary is already violated, 44 times.** 27 extensions import
`core/app/host/types` and 17 import `core/app/system/clickThrough`. That is not 44
mistakes — it says both belong in the MIT SDK, exactly as P2.1 predicted. Moving code
across the GPL→MIT line is a maintainer decision, so the guard ships with those four
modules pinned in an `ALLOWED_ESCAPES` list: today's line is frozen, nothing new can be
added, and the list only shrinks. `extensions/widget-wizard/` is exempt outright — it
renders the host's own runtime-package preview and needs `core/runtime` by design.

### 2. `ci.yml` — the PR gate

Two independent jobs so the fast one reports in ~90 s while Rust is still compiling.

```yaml
on:
  pull_request:
  push: { branches: [main] }
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true      # a force-push kills the stale run — free minutes, faster queue
permissions:
  contents: read                # least privilege; nothing here needs write
```

| Job | Runner | Steps | Cold | Warm |
|-----|--------|-------|------|------|
| `frontend` | `ubuntu-latest` | `npm ci` → `typecheck` → `lint` → `format:check` → `test:assert` | ~2 min | ~90 s |
| `rust` | `windows-latest` | `cargo fmt --check` → `clippy -D warnings` → `cargo test --lib` | 12–18 min | 3–5 min |
| `linux-build` | `ubuntu-22.04` | apt deps → `cargo check` (**non-blocking at first**) | ~10 min | ~3 min |

Notes that decide whether this is pleasant or painful:

- **Rust runs on Windows, not Linux.** Large parts of `src-tauri/src` are behind
  `#[cfg(windows)]` (the entire `windows` crate surface, `winreg`, DPAPI in
  `security/secrets.rs`). A Linux-only Rust job would compile-check maybe half the code
  and pass while Windows is broken. Windows runners are slower but free here.
- **Caching**: `Swatinem/rust-cache@v2` with `save-if: ${{ github.ref == 'refs/heads/main' }}`.
  PRs restore the cache but don't write it — otherwise ten concurrent PRs thrash the
  repo's 10 GB cache quota and evict each other. `actions/setup-node` with `cache: npm`
  for the frontend.
- **Path filtering has a trap.** If you make `rust` a required check and skip it via
  `paths:`, a docs-only PR sits forever at "Expected — waiting for status". Use a job
  that always runs and decides internally (`dorny/paths-filter` → `if: steps.f.outputs.rust == 'true'`
  on the expensive steps), so the check always reports green.
- **Fork PRs get no secrets.** Nothing in `ci.yml` needs any — keep it that way, and
  never use `pull_request_target`.

**Branch protection on `main`:** require `frontend` + `rust`, require the branch to be
up to date, no force-push. `linux-build` stays optional until the Linux port is
officially supported.

### 3. `release.yml` — tag-driven, both platforms

Trigger: push of tag `v*`. Uses `tauri-apps/tauri-action`, which creates a **draft**
GitHub Release, builds the matrix, and uploads each bundle. Draft means you write two
sentences and press publish — nothing goes out by accident.

```yaml
strategy:
  matrix:
    include:
      - { os: windows-latest, bundles: "nsis" }
      - { os: ubuntu-22.04,   bundles: "appimage,deb" }
```

`src-tauri/tauri.conf.json` currently hardcodes `"targets": ["nsis"]`, which would make
the Linux job produce nothing. Change it to `"targets": "all"` and let the workflow pass
`--bundles <list>` per platform — the config then stops being Windows-specific and
`npm run package:win` still behaves as before.

**Artifacts per release:**

| Platform | Kind | Produced by | Notes |
|----------|------|-------------|-------|
| Windows | Installer `kavibay_x.y.z_x64-setup.exe` | NSIS bundle | `installMode: currentUser` — no admin prompt |
| Windows | Standalone `kavibay.exe` | falls out of the same build at `src-tauri/target/release/kavibay.exe` | **no second build needed** — just upload the file. Needs WebView2 present (shipped with Win 11) |
| Linux | Portable `kavibay_x.y.z_amd64.AppImage` | AppImage bundle | the Linux answer to "standalone": one file, `chmod +x`, run |
| Linux | Installer `kavibay_x.y.z_amd64.deb` | deb bundle | Ubuntu/Debian; declares its own deps |
| both | `SHA256SUMS.txt` | `sha256sum` step | see signing below |

Add `paths: [src-tauri/target/release/kavibay.exe]` as an extra upload step (or a
follow-up `gh release upload`) — `tauri-action` only knows about *bundles*, not the raw
binary.

### 4. Linux, in detail (the part with the sharp edges)

**Runner deps** — Tauri v2 needs these before `cargo build`:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

`libxdo-dev` is required by the global-shortcut plugin; `libayatana-appindicator3-dev`
by the tray icon. Both are already in your dependency tree, so a missing one fails late
and confusingly.

**Build on the oldest runner you can, not the newest.** An AppImage links against the
glibc of the machine that built it. Built on `ubuntu-latest` (24.04, glibc 2.39) it
refuses to start on Ubuntu 22.04 or Debian 12 — a large slice of your would-be users.
`ubuntu-22.04` (glibc 2.35) covers Ubuntu 22.04+, Debian 12+, Fedora 36+. When GitHub
retires that image, the options are moving up to 24.04 (and dropping older distros) or
building inside a container — decide then, and note the date in the release notes.

**Ship Linux as explicitly experimental in V1.** Your own recent commits record that
Wayland cannot keep pinned widgets on top and that the outside-click watcher goes through
X11 (`x11rb`, `XQueryPointer`). So the release notes and README need one honest line:
*Linux support is X11-only; on Wayland the always-on-top desk does not work.* Shipping it
anyway is right — it lets Linux contributors build and test — but an unqualified
"Linux supported" earns a stream of duplicate Wayland issues.

**Not in V1:** `.rpm` (add when someone asks — it's one more `--bundles` entry), Flatpak
/ Flathub (own manifest, external review process, weeks of latency), AUR.

### 5. Signing, or the honest lack of it

Neither platform gets code signing in V1, because no free option exists that Windows
actually trusts (Azure Trusted Signing and OV/EV certificates all cost money; sigstore is
not a Windows trust root). Consequences to handle rather than hide:

- Windows SmartScreen shows "unrecognized app" on first run. → One short README section
  with the exact click path ("More info → Run anyway") and the published SHA256, so
  users can verify what they downloaded. Reputation accumulates per-binary and resets on
  every release, so this stays true until you buy a certificate.
- The **Tauri updater is a separate thing** and its minisign key *is* free. Deliberately
  out of V1: it needs a key in repo secrets, a `latest.json` endpoint, and a rollback
  story. Slot it as V1.1 — it's the single biggest quality-of-life jump for users once
  releases are boring.

### 6. Contributor surface — the actual priority

**`CONTRIBUTING.md`** — one page, three paths, in this order (most people want the first):

1. **Write a runtime package** (no repo clone, no Rust, no build step). Copy
   `examples/runtime-extension-s/`, drop it in `{appData}/extensions/`, enable Developer
   Extensions, rescan. Link `docs/runtime-packages.md`. **This is the default path for
   community widgets** — it's sandboxed, so review is about usefulness, not about whether
   it can steal a token.
2. **Add a first-party extension** (`extensions/<id>/`, Vue, compiled in). Clone
   `extensions/calculator/`, folder name = `manifest.id`, run `npm run verify`. Link
   `docs/widget-tutorial.md`.
3. **Change the core** (`core/app/`, `src-tauri/`). Points at the security invariants in
   AGENTS.md and says plainly that CSP, sandbox, secrets and IPC changes need a design
   note in the PR.

Plus the things that remove doubt: exact toolchain versions and prerequisites per OS
(link `docs/getting-started.md`), the one-line `npm run verify`, **licensing** — a
contribution takes its directory's license (MIT for `extensions/`/`sdk/`/`examples/`,
GPL-3.0-or-later for `core/`/`src-tauri/`) plus a relicensing grant, and a **stated
review turnaround** ("extension PRs: first response within 3 days"). A promise you keep
is worth more than any badge.

**`PULL_REQUEST_TEMPLATE.md` — short, or it gets deleted unread.** Four lines:

```markdown
## What & why
<!-- one or two sentences; link the issue if there is one -->

## Type
- [ ] New extension  - [ ] Extension fix  - [ ] Core/Rust  - [ ] Docs

## Checks
- [ ] `npm run verify` green (`npm run verify:rust` too, if Rust changed)
- [ ] Manifest is honest: `commands`/`permissions` match what the code actually calls
- [ ] Screenshot or GIF (for anything visible)
```

The screenshot line is doing real work: for widget PRs it turns review from "clone,
build, run" into "look at the image, read 60 lines of diff".

**PR titles as Conventional Commits**, enforced by
`amannn/action-semantic-pull-request` (free, ~5 s). With squash merges, the title becomes
the commit and the release-notes line: `feat(extensions): add pomodoro streak counter`.
The bot's failure message tells contributors exactly what to fix, and titles are editable
without a force-push — the least annoying rule you can enforce.

**`.github/release.yml`** groups the auto-generated notes by label:
`🧩 New extensions` (`extension`) · `✨ Features` (`feature`) · `🐛 Fixes` (`bug`) ·
`🔒 Security` (`security`) · `📚 Docs` (`docs`). Combined with `labeler.yml` (auto-label
by changed path: `extensions/**` → `extension`, `src-tauri/**` → `rust`, `docs/**` →
`docs`) the changelog writes itself and you can see what a PR touches from the list view.

**`CODEOWNERS`** — required review from you only where it matters, so everything else can
move fast:

```
/src-tauri/src/security/           @aswetlow
/src-tauri/src/runtime_extensions/ @aswetlow
/src-tauri/tauri.conf.json         @aswetlow
/sdk/                              @aswetlow
/core/app/runtime/            @aswetlow
```

**`SECURITY.md`** + GitHub's private vulnerability reporting (free, one checkbox). You
ship DPAPI-encrypted credentials and a sandbox escape surface; "open a public issue" is
the wrong answer and you need the alternative written down before someone needs it.

**Issue forms** (`.yml`, not Markdown — they produce parseable, complete reports):
`bug.yml` (OS + version + steps) and `extension-idea.yml` (what it does, data source,
does it need credentials). Then label a batch of the idea issues `good first issue` and
keep 5–10 stocked. An empty "good first issue" list is the most common reason a
drive-by contributor closes the tab.

### 7. Two things that specifically drive extension contributions

**A fast lane for extension-only PRs.** If a PR touches only
`extensions/<single-id>/**` (+ its README), the reviewer's job is: manifest honest,
screenshot plausible, no cross-imports (ESLint already proves that), assert file present
for pure logic. Write those four bullets in CONTRIBUTING as *the* extension checklist,
and say that core-review rules do not apply. Contributors read the checklist and
correctly conclude "this is a 20-minute contribution".

**Buildable artifacts on demand.** Reviewing a widget without running it is guesswork,
but building an installer on every PR would blow the time budget. Compromise: a
`build:installer` label triggers a one-off Windows build that attaches the `.exe` as a
workflow artifact (7-day retention). You add the label to the two PRs a week where it
matters. Same job, on push to `main`, gives testers a rolling build without a release.

### 8. Housekeeping worth turning on now

- **Dependabot** (`dependabot.yml`): `npm`, `cargo`, `github-actions`, weekly, **grouped**
  (one PR per ecosystem, not thirty). Ungrouped Dependabot is the fastest way to make
  your own repo feel like spam.
- **Pin action versions** to major tags (`@v4`) and keep `permissions:` minimal in every
  workflow. A public repo's workflows are an attack surface; `contents: read` everywhere
  except the release job (`contents: write`).
- **`THIRD-PARTY-NOTICES.md`** already exists — add a line to CONTRIBUTING that new
  runtime dependencies need an entry, since the repo mixes GPL and MIT boundaries.
- **Enable Discussions** with a pinned "Show your widget" thread. Costs nothing, and it's
  where the gallery submissions and half-baked ideas go instead of the issue tracker.

### 9. New assert guards (fit the existing convention, no new tooling)

| Script | Fails when |
|--------|-----------|
| `importBoundaries.assert.mjs` | a relative import leaves `extensions/<id>/` or `sdk/` (minus the pinned exceptions) |
| `versionSync.assert.mjs` | `package.json` / `Cargo.toml` / `tauri.conf.json` versions differ |
| `extensionManifests.assert.mjs` | folder name ≠ `manifest.id`, missing `index.ts`, missing `ui.defaultSize`/`defaultOffset`, missing icon file, duplicate id |
| `spdxHeaders.assert.mjs` | a file under `sdk/**` or `examples/**` lacks its SPDX header |
| `manifestHonesty.assert.mjs` (P2.3, V1.1) | an extension calls `invoke("x")` with `x` ∉ `manifest.commands` |

They live in `scripts/` with the `.assert.mjs` suffix, so `runAsserts.mjs` picks them up
with everything else — no separate CI step, and `npm run verify` covers them locally.

`extensionManifests` is the one that pays for itself immediately: it turns the single
most common newcomer mistake (folder ≠ id → "my widget doesn't show up") into a CI error
with a sentence telling them what to rename.

## Keeping monetization possible without closing the source

Added 2026-08-08 after the constraint was stated: open source matters now, a later
paid tier or commercial license must stay possible. Not legal advice — but the failure
mode here is mechanical and worth writing down.

**The trap:** GPL code + outside contributions + no rights grant = relicensing becomes
impossible. Today Alex holds every copyright in `core/` and `src-tauri/`, so he can
dual-license (GPL for everyone, commercial for companies) or build a proprietary tier
whenever he likes. The moment an outside contributor's patch lands there under GPL
alone, that person owns their patch and licensed it to the project under GPL *only*.
The combined work can then never be offered under other terms without their written
permission. At thirty contributors this is no longer practical. **It is cheap to
prevent and effectively impossible to undo.**

**What does not need fixing:**

- `extensions/`, `sdk/`, `examples/` are **MIT**, and MIT already permits proprietary
  derivatives — by anyone, including the maintainer. Contributions there are free of
  the problem entirely. Keeping `extensions/` MIT is a strategic asset, not an
  oversight: a future commercial build can bundle community widgets.
- **Runtime packages live in their contributors' own repos** and never enter this one.
  That is where the contribution strategy points most people anyway, so the majority
  of community work creates no copyright entanglement at all.

So the exposure is narrow: **outside GPL contributions to `core/` and `src-tauri/`** —
which are the rare, reviewed ones.

**Chosen instrument: a relicensing grant in CONTRIBUTING.md, not a CLA bot.** The
clause gives the maintainer a perpetual, irrevocable, sublicensable license to the
contribution, including under proprietary terms. Zero friction — no signing ceremony,
no bot comment, nothing to click — which is what the current phase needs. It is legally
thinner than a signed CLA, and that is the accepted trade.

**Upgrade trigger:** the first outside PR to `core/`/`src-tauri/` that is substantial,
or the moment monetization stops being hypothetical. Then add
[cla-assistant](https://cla-assistant.io) (free for open source, one click per
contributor, recorded per PR).

**Open, as of 2026-08-08: relicensing everything MIT.** Being weighed with input from
Jan Oberhauser (n8n). The licenses above stay as they are until that lands — the grant
clause is the interim protection, and it costs nothing if the answer turns out to be MIT.

Checked so we know it is possible: **no dependency forces GPL.** npm is 158× MIT / 13×
Apache-2.0 / rest ISC-BSD; the 561 crates are MIT/Apache/Zlib/Unicode/ISC/BSD plus 5×
MPL-2.0 (file-level copyleft, fine alongside MIT). No GPL, AGPL or SSPL anywhere.

If the answer is MIT, the argument is: the CLA question disappears entirely (MIT already
grants everything needed for a proprietary tier), and MIT→GPL stays possible later while
GPL→MIT never is — so the *current* mixed setup is the one closing doors. What is
genuinely given up is selling GPL exceptions (a model for embeddable components, not
desktop apps) and copyleft as a deterrent against a closed fork (a deterrent a solo
maintainer cannot afford to enforce anyway). Execution would be: collapse the LICENSE
map, simplify `spdxHeaders.assert.mjs` to "MIT everywhere", drop the grant clause from
CONTRIBUTING, keep the trademark reservation — which matters *more* under MIT, since the
name becomes the only leverage against a rebranded fork. Independent of all this: the
Pixabay-licensed moodist sounds still need their redistribution review, because MIT
actively invites redistribution and a code license does not relicense assets.

**What was rejected:**

- **A source-available license (BSL / FSL / Elastic) for the core.** It preserves
  monetization directly, but it is not OSI open source, and it measurably reduces
  contributions — which is the entire goal of this phase. It also still needs a rights
  grant from contributors, so it does not even remove the CLA question.
- **DCO instead of a CLA.** A DCO only certifies that a contributor had the right to
  submit their code. It grants no relicensing rights, so it does not address this at all.
- **Relicensing the whole repo MIT.** Solves it, but hands the core to anyone who wants
  to ship a competing product — the opposite of preserving leverage.

## Repo settings — the part no file can do

Everything above is committed code. These are clicks in the GitHub UI, and the workflows
misbehave without them:

1. **Create the labels** the labeler and release notes reference — `extension`,
   `feature`, `bug`, `security`, `docs`, `rust`, `sdk`, `ci`, `idea`,
   `build:installer`, `skip-changelog`, `good first issue`.
   `actions/labeler` **errors on a label that does not exist**, so this comes before the
   first PR. One-liner:
   ```bash
   for l in extension feature bug security docs rust sdk ci idea build:installer skip-changelog; do gh label create "$l" --force; done
   ```
2. **Branch protection on `main`:** require `Frontend (typecheck · lint · asserts)` and
   `Rust (fmt · clippy · test)`, require the branch to be up to date, no force-push.
   Leave `Linux build check` optional.
3. **Merge button:** allow squash only; disable merge commits and rebase merging, so the
   PR title really is the changelog line.
4. **Enable Discussions**, pin a "Show your widget" thread.
5. **Enable private vulnerability reporting** (Settings → Security) — `SECURITY.md` and
   the issue-template contact link both point at it.
6. **Actions permissions:** default `GITHUB_TOKEN` to read-only; the workflows request
   what they need per job.

## Order of work

| # | Step | Effort | Unblocks |
|---|------|--------|----------|
| 1 | Settle lockfile; delete pnpm files | 15 min | everything |
| 2 | ESLint + Prettier config, formatting-only commit | 2–3 h | `ci.yml` |
| 3 | `runAsserts.mjs` + `verify` scripts + the new assert guards | 2 h | `ci.yml` |
| 4 | `ci.yml` + branch protection | 2 h | safe merging of PRs |
| 5 | `tauri.conf.json` targets `"all"` + `release.yml` + tag `v0.1.0` as a dry run | 3 h | first public release |
| 6 | CONTRIBUTING · PR template · SECURITY · issue forms · CODEOWNERS · labels | 3–4 h | contributions |
| 7 | Dependabot, `release.yml` notes config, labeler, Discussions | 1 h | — |

Steps 1–4 are the "stop breaking main" half; 5–7 are the "invite people in" half. Do
them in that order, but don't announce the project anywhere until 6 is done — a first
contributor who lands on a repo with no CONTRIBUTING usually doesn't come back.

## Deliberately not in V1

- Tauri updater + minisign key (V1.1 — biggest user-facing win once releases are routine)
- macOS release job (the port is in progress; add a `macos-latest` matrix entry the day
  a `.dmg` actually runs)
- Code signing / notarization (costs money)
- Flathub, winget, `.rpm`, AUR (distribution channels come after there's demand)
- Coverage reporting, E2E/WebDriver tests, visual regression (weeks of work, near-zero
  contribution benefit at this stage)
- `release-please`/semantic-release, a hand-edited CHANGELOG.md (auto-generated notes
  from squashed PR titles cover it)
- Stale-bot (it demoralizes exactly the drive-by contributors you're trying to attract)
