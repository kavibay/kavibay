# Getting started

**Version 0.1 targets Windows 10 and 11 only.** The Windows instructions below
cover the supported release. Linux and macOS are outside v0.1; their source-build
notes are retained for development of the experimental ports. Architecture and
contributor conventions are in [architecture.md](architecture.md) and
[AGENTS.md](../AGENTS.md).

**First start:** setup opens automatically. Choose whether to start at login
and, on a multi-display system, which screen to cover. Continue with the short
tour or choose **Skip the tour**. The v0.1 tour targets Windows and uses
`notepad` as its app-search example.

**Later starts:** Kavibay stays hidden in the tray. Tap `Ctrl` twice or
double-click the tray icon to open it.

## Run on Windows

### Prerequisites

- **Node 20+** and **Rust stable** ([rustup](https://rustup.rs/))
- **Visual Studio Build Tools** with *Desktop development with C++*
- **WebView2** — already on Windows 11; older Windows needs the Evergreen runtime

After installing rustup, open a *new* terminal or the build cannot find `cargo`.

### Development

```bash
npm install
```

```bash
npm run tauri dev
```

First start compiles the Rust backend and takes a few minutes. Later starts are
fast and the Vue side hot-reloads.

### Standalone

Prebuilt downloads: *not published yet.* Build one yourself:

```bash
npm run package:win:standalone
```

A single `kavibay.exe` in `src-tauri/target/release/`. No installer, no registry.

### Bundle (installer)

Prebuilt downloads: *not published yet.* Build one yourself:

```bash
npm run package:win
```

NSIS setup in `src-tauri/target/release/bundle/nsis/`. Installs for the current
user without admin rights, and is **unsigned** — SmartScreen warns on first run.

## Run on Linux

**Experimental and unsupported; outside v0.1.** These instructions are for
source development. The first-run tour still assumes Windows (`notepad`).

Linux cannot save integration credentials because secure secret storage is not
implemented. API keys and OAuth tokens are refused rather than stored in
plaintext. Widget data and layout use a different fallback: `web-storage.json`
is saved in plaintext. See [SECURITY.md](../SECURITY.md#data-at-rest).

### Prerequisites

- **Rust stable** ([rustup](https://rustup.rs/)) and **Node 20+** — the `node`
  from apt is usually too old for Vite 6, check with `node -v`
- System libraries (Debian/Ubuntu):

```bash
sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Note `4.1` — the `4.0` package is for Tauri v1 and will not build this.

Then `npm install` and `npm run tauri dev`, same as Windows. In a VM without GPU
passthrough use `npm run dev:linux` instead; it silences a failing driver probe
(but makes nothing faster).

### Limitations

Check which session you are in — it decides what works:

```bash
echo $XDG_SESSION_TYPE
```

| | X11 | Wayland |
|---|---|---|
| Pinned widgets stay on top | yes | **no** |
| `Shift+Ctrl+Space` | yes | no — bind `kavibay --toggle` yourself in the desktop's keyboard settings |
| Click-through in the gaps | yes | no |
| Hidden from dock / taskbar | yes | no |
| Store integration credentials | **no** | **no** |

Wayland gives no client the right to grab a global key, query the pointer, stay
above other windows, or hide from the window list — the compositor owns all four.
`alwaysOnTop` and `skipTaskbar` reach GTK as X11-only hints and simply do nothing.
Kavibay detects this and says so once at startup.

**Getting an X11 session:** on Ubuntu 24.04 and older, pick *Ubuntu on Xorg* from
the gear menu at the login screen. On 26.04+ GNOME no longer ships one — install
another desktop that does, e.g. `sudo apt install xfce4`, then pick *Xfce Session*.
The gear menu only appears once more than one session exists.

## Run on macOS

**Experimental and unsupported; outside v0.1.** The source port is retained for
development. Packaging and a platform-specific first-run tour are outside this
release; the current tour still uses the Windows `notepad` example.

After changing the runtime package protocol or its CSP, run
`npm run verify:webkit` on macOS. It opens an ephemeral WebKit instance and checks
button clicks, storage across an iframe reload, gesture forwarding, rendered
iframe sizes after live zoom changes, local assets and sandbox restrictions.
It does not read or change your Kavibay profile. This catches
WebKit-specific failures that the TypeScript and Rust suites cannot reproduce.

On a Mac the double tap is on the Control key (⌃), not Command. It needs no
permission. Kavibay watches modifier keys through an `NSEvent` global monitor,
which macOS serves without Input Monitoring or Accessibility access, so there is
nothing to grant.

Pinning, click-through and the global hotkey should work — macOS supports all
three, unlike Wayland. Quick actions work too. The first `Ctrl+Shift+Q`
(Control, not Command) asks for Accessibility access, which they need to read
the selection and paste the answer. Now Playing shows Apple Music only: since
macOS 15.4 the system-wide now-playing API no longer answers other apps, so
Kavibay scripts Music instead and asks for Automation access when you click
Connect in the widget. The colour picker and the focus tracker are Windows-only
and stay inert, and Kill Port answers with an error.

Credentials and `web-storage.json` are encrypted with a key kept in your login
keychain as "Kavibay Safe Storage". A debug build is ad-hoc signed, so every
rebuild has a new signature the keychain has not seen, and macOS asks once per
build whether `kavibay` may use that item. Allow it; *Always Allow* covers only
that one build. Deny it and that session runs without the key. Settings →
Credentials shows the refusal, and **Try again** asks once more. Widget content
is saved unencrypted to `web-storage.pending.json` next to the untouched
`web-storage.json`, and the first start or save with the key folds it back in.

One decision is already baked in: the transparent window needs Apple's private
APIs, which **rules out App Store distribution**.

## When it does not work

| Symptom | Fix |
|---|---|
| `Port 1420 is already in use` | Kill the other dev server — Tauri needs that exact port |
| `cargo` not found | Fresh rustup install, stale `PATH`. New terminal |
| Link errors in the Rust build | Windows: MSVC build tools missing. Linux: the apt line above |
| App runs, nothing visible | Working as designed — tap `Ctrl` twice |
| The `Ctrl` double tap does nothing | It does not exist on Linux. Use the tray, `Shift+Ctrl+Space` or `kavibay --toggle` |
| `Ctrl+Space` does not peek | Another app grabbed the hotkey, or you are on Wayland |
| A new widget folder does not show up | Folder name must equal `manifest.id`; restart the dev command |

## Next

- **How it all fits together:** [architecture.md](architecture.md)
- **Commands, conventions, repo map:** [AGENTS.md](../AGENTS.md)
