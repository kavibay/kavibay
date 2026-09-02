# Security policy

## Reporting a vulnerability

Please report privately via
[GitHub's private vulnerability reporting](https://github.com/aswetlow/kavibay/security/advisories/new)
rather than opening a public issue.

Kavibay is a hobby project maintained by one person — expect a first response within
a week, not within an hour. If a report turns out to be valid, the fix and an advisory
follow as fast as I can manage, and you get credit unless you'd rather not.

## What is in scope

Kavibay runs on the user's desktop with the user's privileges, holds API credentials,
and executes community-written extension code. The parts worth attacking:

- **Sandbox escape from a runtime package.** Runtime packages (`{appData}/extensions/`)
  render in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`. Any way
  for one to reach Tauri IPC, the main window's DOM, another package's storage, or the
  filesystem is a vulnerability.
- **Path traversal** out of a package directory (`safe_join` in
  `src-tauri/src/runtime_extensions/validate.rs`) — including via manifest fields.
- **Credential exposure.** Secrets are encrypted at rest (DPAPI on Windows) and must
  never reach the frontend, `localStorage`, logs, or a runtime package.
- **Permission bypass** — a package obtaining network access or storage it did not
  declare and the user did not approve.
- **CSP weakening** in the main window that would let injected content execute.

## What is not in scope

- Anything requiring the attacker to already run arbitrary code as the user.
- The absence of code signing. The binaries are unsigned because no free option exists
  that Windows trusts; this is documented, not accidental.
- First-party extensions (`extensions/`) using powerful commands. They are compiled into
  the app and trusted by design — that is what the review process is for.
- Denial of service by a widget the user installed and enabled themselves.

## Data at rest

Everything Kavibay keeps lives under `{appData}/` — on Windows
`%APPDATA%\com.aswetlow.kavibay`. The only access control on that directory is the
one Windows gives every user profile: another account without administrator rights
cannot read it, and **anything running as you can read all of it**.

Setting `KAVIBAY_DATA_DIR` to an absolute path moves that directory, so a
development build can run against a throwaway profile instead of the real one
(`src-tauri/src/paths.rs`). This is a development switch, **not** a portable
mode: the encryption below is bound to this user on this machine, so a data
directory carried to another machine is unreadable there no matter where it
sits. An instance started with the override does not join the single-instance
group, because it is a different profile rather than a second copy of the
running app.

Encrypted with the OS secret store (DPAPI on Windows, bound to the current user
profile — see `src-tauri/src/security/secrets.rs`), so a copy of the file is
useless on another machine or under another account:

- `credentials.db` — API tokens and OAuth refresh tokens.
- `web-storage.json` — the durable copy of everything the frontend stores:
  notes, todos, alarms, timers, widget settings, desk layout.

Stored unencrypted:

- `clipboard-widget/` — clipboard history, including whatever you last copied.
- `focus_tracker.db` — which application had focus, and when.
- `image-widget/`, `palette-app-icons/`, `wizard/`, `extensions*/`.
- The WebView's own `localStorage` copy under
  `%LOCALAPPDATA%\com.aswetlow.kavibay\EBWebView`. Widget code writes there first
  and `web-storage.json` mirrors it, so the encrypted file is a durable copy of
  data that also exists in the profile in the clear.

On platforms with no secret backend (every non-Windows build today, until the
Keychain port lands) `web-storage.json` is written in plaintext instead of not at
all, and the app logs `[web_storage] storing unprotected`. Credentials fail closed
in the same situation; this file does not, because it is the only copy of the
user's notes and refusing to write it would destroy them rather than expose them.

**What this does not protect against:** any program running under your account,
including a malicious runtime extension that escapes its sandbox. Encryption at
rest defends a stolen file or a stolen disk, not a compromised session. Kavibay is
not a password manager — do not keep secrets in widget content.

## Supported versions

The latest release only. This is a pre-1.0 project; there are no maintenance branches.
