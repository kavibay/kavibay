# AI Usage Widget Design

## Goal

Add one first-party `ai-usage` widget that shows the consumed rolling usage
windows reported by Codex and Claude Code. The widget must not return
credentials, make model/inference requests, or overwrite an existing Claude
Code status-line customization.

## Data sources

### Codex

The Rust backend scans the newest JSONL session files below `CODEX_HOME` (or
`~/.codex`) and extracts the latest `payload.rate_limits` event. Codex already
writes these events for its own UI, including primary and secondary windows,
used percentage, reset time, and plan type. The widget keeps the normalized
consumed percentage so the view can show exactly what has been used.

This is deliberately read-only and local. Session text and authentication data
are never deserialized into the response.

### Claude Code

Claude Code exposes subscription rate limits through the same OAuth-backed usage
request used by its plan-usage UI. After the user enables Claude support, the
backend makes a fixed, read-only request to Claude's usage endpoint. If the
access token is expired, Rust refreshes it through Claude's OAuth token endpoint
and updates Claude's own credentials file, including a rotated refresh token.
If that request is unavailable, the widget falls back to the newest local
cache. The explicit setup action also:

1. installs a small PowerShell status-line script under the Claude config
   directory;
2. adds that script to `settings.json` only when no status line exists, or when
   the existing status line is already the Kavibay script;
3. stores only `captured_at` and `rate_limits` in a separate local cache; and
4. prints a compact Claude Code status line while capturing the data.

The live response is normalized immediately; neither the token nor provider
response headers are returned to the extension. The endpoint is not a general
model API: errors, rate limits, or endpoint changes fall back to the newest
local cache.

An unrelated existing status line is reported as a conflict and is never
replaced. If the live request is unavailable, fallback rate-limit fields appear
after Claude Code supplies them, normally after the next assistant response.
This integration is Windows-first because
the installed command is PowerShell. Generated Windows commands use
forward-slash paths because Claude Code may route status-line commands through
Git Bash, where backslashes are escape characters; a previously generated
Kavibay command with backslashes is recognized as a safe one-time migration.

## Contract and security boundary

The MIT SDK gains a narrow `aiUsage` capability with `snapshot()` and
`enableClaudeCapture()` methods. The GPL host maps these fixed methods to fixed
Tauri commands. No command name or filesystem path comes from the extension.

The Rust response is a normalized, secret-free snapshot:

- provider status and optional plan;
- zero or more usage windows (`id`, `label`, `usedPercent`, `resetsAt`);
- the last observation time; and
- a short diagnostic suitable for the UI.

The extension refreshes when its widget is opened (and on the initial mount),
then applies a shared one-minute cooldown across all instances. Overlapping
requests are deduplicated, and a manual refresh uses the same cooldown. There
is no background polling while the widget is hidden.

## UI

The compact widget has one section per provider. Available windows show the
consumed percentage, a usage bar, and the reset time. Provider
states explain missing Codex data, unconfigured Claude capture, a conflicting
Claude status line, or captured data that has not arrived yet. Claude setup is
always user-initiated and the button text makes the status-line side effect
clear.

## Failure behavior

- Missing or malformed session/cache files are skipped; the newest valid event
  wins.
- Invalid Claude `settings.json` fails closed and is not rewritten.
- A pre-existing foreign Claude status line fails closed and is not rewritten.
- Setup or read errors remain provider-local so Codex data can still render.
- Live Claude usage errors or rate limits fall back to the newest local
  `.claude.json` or Kavibay status-line snapshot.
- Percentages are clamped to 0–100 in the view logic.
