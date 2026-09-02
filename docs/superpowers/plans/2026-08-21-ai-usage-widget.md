# AI Usage Widget Implementation Plan

## Constraints

- Contract-format first-party extension; no host `typeId` switch.
- Fixed reviewed host capability; no arbitrary command bridge.
- Claude's OAuth token is used only in Rust for one fixed, read-only usage
  request; expired tokens may be refreshed through Claude's OAuth endpoint and
  rotated credentials are written back to Claude's own credential file. No
  credential-bearing fields cross the capability boundary and no model/
  inference request is made.
- Claude configuration is opt-in and never overwrites another status line.
- Windows-first Claude setup; Codex and cached Claude reads remain portable.
- Preserve the current migration work in overlapping host and Rust files.

## Files

| Area | Files | Change |
| --- | --- | --- |
| SDK | `sdk/extension/contract/sdk.ts` | Add the narrow `aiUsage` capability contract. |
| Host | `core/app/extension-host/{widgetCapabilityTransport,tauriWidgetCapabilityTransport,runtime}.ts` | Bind capability methods to fixed Tauri commands and inject them into widget context. |
| Rust | `src-tauri/src/extensions/ai_usage/mod.rs`, `src-tauri/src/extensions/mod.rs`, `src-tauri/src/lib.rs` | Read/normalize provider data, install opt-in Claude capture, register commands and ownership. |
| Extension | `extensions/ai-usage/**` | Contract definition, Vue view, pure display logic, and asserts. |
| Docs | this plan and the paired design spec | Record source, side effects, and security decisions. |

## Tasks and verification

1. Implement and unit-test the Rust parsers and Claude setup guards.
   Verify with `cargo test --lib extensions::ai_usage`.
2. Add the SDK/host capability seam and ensure the contract runtime only exposes
   it when declared.
3. Build the extension and cover percentage/reset formatting with a colocated
   `*.assert.ts` file.
4. Run `npm run verify` and `npm run verify:rust`.
5. Manually smoke-test palette add, resize, duplicate/dispose, refresh, and the
   Claude setup states in the Tauri app. Do not exercise setup against a real
   conflicting status line.

## Manual UI checklist

- Add “AI Usage” from the palette and confirm both provider sections render.
- Resize down to minimum and confirm labels and progress bars remain readable.
- Duplicate and remove an instance; confirm opening refreshes once and no
  background polling continues while hidden.
- Refresh and confirm Codex values update without exposing session content.
- With Claude unconfigured, confirm setup copy discloses the status-line change.
- After setup, confirm the live 5-hour/7-day windows and reset times appear; if
  the endpoint is unavailable, confirm the newest local cache is shown.
- With a foreign status line in a disposable config, confirm setup reports a
  conflict and leaves the file byte-for-byte unchanged.
