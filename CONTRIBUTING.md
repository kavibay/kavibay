# Contributing to Kavibay

The most useful thing you can contribute is **a widget**. This page is ordered by how
much of the project you have to care about — start at the top and stop as soon as your
idea fits.

Questions and half-formed ideas belong in
[Discussions](https://github.com/kavibay/kavibay/discussions). You do not need an issue
before opening a PR.

---

## Path 1 — a runtime package (no clone, no Rust, no build step)

This is the normal path for community widgets. A runtime package is a folder with an
HTML file in it. It renders in a sandboxed iframe, so it can't reach the rest of the
app — which is exactly why it needs no review of your code's trustworthiness.

```
my-widget/
  manifest.json
  ui/
    index.html
    app.js
```

1. Copy [`examples/runtime-extension-s/`](examples/runtime-extension-s) as a starting point.
2. Drop the folder into `{appData}/extensions/` — on Windows typically
   `%APPDATA%\com.aswetlow.kavibay\extensions\`; the exact path is under
   **Settings → Extensions → Runtime packages → Folder**. The folder name must equal
   `manifest.id`.
3. In Kavibay: **Settings → Behavior → Developer Extensions** on, then
   **Settings → Extensions → Runtime packages → Rescan**, and enable it.

Read [`docs/runtime-packages.md`](docs/runtime-packages.md) for the manifest,
`storage.get/set`, declared HTTP, and what the sandbox forbids (no inline `<script>`,
no inline `onclick` — both bite everyone once). [`docs/DESIGN.md`](docs/DESIGN.md) has
the colours and spacing that make a widget look like it belongs.

**Don't want to write it yourself?** The built-in Widget Wizard generates runtime
packages from a description — see [`docs/widget-wizard.md`](docs/widget-wizard.md).

Sharing it: post it in Discussions. Runtime packages live in their own repos; there is
no registry yet.

---

## Path 2 — a first-party extension (Vue, compiled into the app)

First-party extensions get full app privileges: Rust commands, the credential store,
the palette. They're reviewed more carefully, and they're the right choice when a
sandboxed package genuinely can't do the job.

```bash
git clone https://github.com/kavibay/kavibay
cd kavibay
pnpm install
pnpm run tauri dev
```

Toolchain prerequisites per OS: [`docs/getting-started.md`](docs/getting-started.md).

Then:

1. Copy [`extensions/calculator/`](extensions/calculator) — the smallest complete
   example — to `extensions/<your-id>/`.
2. **The folder name must equal `manifest.id`.** Get this wrong and the widget silently
   never appears. (CI catches it; the app doesn't.)
3. `manifest.json` needs `ui.defaultSize` and `ui.defaultOffset`. No registration
   anywhere — the host globs `extensions/*/index.ts` at build time.
4. Pure logic goes in a `<name>Logic.ts` with a colocated `<name>Logic.assert.ts`
   next to it.

[`docs/widget-tutorial.md`](docs/widget-tutorial.md) walks through tiers S (static),
M (per-instance settings) and L (data from Rust).
[`docs/extensions.md`](docs/extensions.md) is the reference.

**The rules that CI enforces**, so they don't come up in review:

- An extension may import its own folder, `@sdk`, `vue`, `@tauri-apps/*` and npm
  packages. Not host code, not another extension. Missing something from the SDK? Say
  so in the PR — moving code into `sdk/` is a licensing decision, not a refactor.
- `sdk/` is MIT and self-contained; it never imports `core/` or `extensions/`.
- Files under `sdk/` and `examples/` carry an SPDX header.

---

## Path 3 — core and Rust

`core/app/` (the host) and `src-tauri/` (the Rust backend) are GPL-3.0 and hold the
security model. Read the **Security invariants** section of
[`AGENTS.md`](AGENTS.md) before you start — it lists the seven things that must not
change quietly (iframe sandbox flags, `safe_join`, secret storage, the main-window CSP,
the runtime bridge's trust model).

If your change touches any of those, describe in the PR why it stays safe. That's not
bureaucracy: those are the parts where a mistake reaches every user's machine.

Rust commands register one line at a time in `src-tauri/src/lib.rs`'s `invoke_handler`,
module groups kept sorted — it keeps merges from conflicting on every PR.

---

## Before you open the PR

```bash
pnpm run verify        # typecheck + lint + all 75 assert files, ~1 min
pnpm run verify:rust   # only if you touched src-tauri/
```

CI runs exactly these. If they're green locally, they're green there.

Individual pieces, when you want a faster loop:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test:assert
npx tsx extensions/<id>/<name>Logic.assert.ts
```

## The PR itself

- **Title as a conventional commit** — `feat(extensions): add moon phase widget`,
  `fix(timer): keep countdown running while suspended`. PRs are squash-merged, so the
  title becomes the commit and the release-notes line. A bot checks the format and tells
  you what to fix; editing the title needs no force-push.
- **Add a screenshot or GIF** for anything visible. It turns review from "clone, build,
  run" into "look at the picture" — which is the difference between a review today and
  a review next week.
- **Keep it to one thing.** A widget plus an unrelated host tweak becomes two reviews
  glued together.
- Want the reviewer to be able to run it? Ask for the `build:installer` label and CI
  attaches a Windows installer to the PR.

**Extension PRs are reviewed against four things only:** the manifest is honest
(declared commands and permissions match the code), the screenshot matches the
description, no imports leave the extension folder, and pure logic has an assert file.
Core review rules do not apply to them.

**Turnaround:** first response on extension PRs within 3 days. If it's been longer,
ping the PR — you're not being ignored, I've lost it.

## Licensing

There is **no CLA to sign and no DCO sign-off**. Two things to know instead.

**1. Your contribution takes the license of the directory it lands in.**

| Directory | License |
|-----------|---------|
| `extensions/`, `sdk/`, `examples/` | MIT |
| `core/app/`, `src-tauri/`, `scripts/` | GPL-3.0-or-later |
| `docs/` | CC-BY-4.0 |

**2. You also grant the maintainer the right to relicense it** — a perpetual,
worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify,
distribute and sublicense your contribution, including under a commercial or
proprietary license.

Why that clause exists, plainly: Kavibay is open source and staying open source. But it
is a one-person project that may one day need to pay for itself — a paid tier, a
commercial license for companies. A single GPL-licensed contribution to `core/` without
this grant would close that door permanently, not because anyone objects later, but
because reopening it would need written permission from every past contributor. Asking
once, up front, is the alternative to asking thirty people in three years.

For `extensions/`, `sdk/` and `examples/` this changes nothing in practice — MIT already
permits all of the above. It only has teeth in the GPL directories. If you'd rather not
grant it, say so in the PR and we'll find a way that works.

New third-party runtime dependencies need an entry in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) — the mixed licensing above only
works if it stays accurate.

The name "Kavibay" and its branding are not covered by any of these licenses
(see [`LICENSE`](LICENSE)).

## Reporting security problems

Not as an issue — see [`SECURITY.md`](SECURITY.md).
