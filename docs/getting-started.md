# Getting started

Pick your platform and run it. Everything else is in
[architecture.md](architecture.md) and [AGENTS.md](../AGENTS.md).

**The window is invisible on purpose.** Kavibay starts hidden and lives in the
tray — tap `Ctrl` twice or double-click the tray icon. On the very first start
it opens by itself, asks whether to start at login, and then runs a short tour.

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
| Everything else | yes | yes |

Wayland gives no client the right to grab a global key, query the pointer, stay
above other windows, or hide from the window list — the compositor owns all four.
`alwaysOnTop` and `skipTaskbar` reach GTK as X11-only hints and simply do nothing.
Kavibay detects this and says so once at startup.

**Getting an X11 session:** on Ubuntu 24.04 and older, pick *Ubuntu on Xorg* from
the gear menu at the login screen. On 26.04+ GNOME no longer ships one — install
another desktop that does, e.g. `sudo apt install xfce4`, then pick *Xfce Session*.
The gear menu only appears once more than one session exists.

## Run on macOS

**Untested.** The code paths exist and were checked against the tao/tauri sources,
but nothing has ever been compiled or run on a Mac. Packaging is not set up.

Pinning, click-through and the global hotkey should work — macOS supports all
three, unlike Wayland. Quick actions, Now Playing, the colour picker and the
focus tracker are Windows-only and stay inert.

Credentials and `web-storage.json` are encrypted with a key kept in your login
keychain as "Kavibay Safe Storage". A debug build is ad-hoc signed, so every
rebuild has a new signature the keychain has not seen, and macOS asks once per
build whether `kavibay` may use that item. Allow it; *Always Allow* covers only
that one build. Deny it and that session runs without the key: credentials
cannot be read and `web-storage.json` is written unencrypted until the next start.

One decision is already baked in: the transparent window needs Apple's private
APIs, which **rules out App Store distribution**.

## When it does not work

| Symptom | Fix |
|---|---|
| `Port 1420 is already in use` | Kill the other dev server — Tauri needs that exact port |
| `cargo` not found | Fresh rustup install, stale `PATH`. New terminal |
| Link errors in the Rust build | Windows: MSVC build tools missing. Linux: the apt line above |
| App runs, nothing visible | Working as designed — tap `Ctrl` twice |
| The `Ctrl` double tap does nothing | It is Windows-only. Elsewhere use the tray, `Shift+Ctrl+Space` or `kavibay --toggle` |
| `Ctrl+Space` does not peek | Another app grabbed the hotkey, or you are on Wayland |
| A new widget folder does not show up | Folder name must equal `manifest.id`; restart the dev command |

## Next

- **How it all fits together:** [architecture.md](architecture.md)
- **Commands, conventions, repo map:** [AGENTS.md](../AGENTS.md)
