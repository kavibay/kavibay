<!-- Keep it short. A one-line "what" plus a screenshot is a complete PR for most widgets. -->

## What & why

<!-- One or two sentences. Link the issue if there is one. -->

## Type

- [ ] New extension
- [ ] Extension fix / improvement
- [ ] Core or Rust change
- [ ] Docs

## Checks

- [ ] `npm run verify` is green (plus `npm run verify:rust` if you touched `src-tauri/`)
- [ ] The manifest is honest — declared `commands` / `permissions` match what the code actually calls
- [ ] Screenshot or GIF below, for anything visible

<!--
Core/Rust changes only: if this touches CSP, the iframe sandbox, secrets, or the
runtime bridge, say in one paragraph why it is safe. See the security invariants in
AGENTS.md.
-->
