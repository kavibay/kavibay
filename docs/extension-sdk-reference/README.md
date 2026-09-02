# Kavibay Extension SDK — reference implementation

Verified reference for the extension contract. Not the app.

**Frozen at the Phase 1 handoff.** This folder is the state the repo ported
*from*, which is the only thing that makes "ported unchanged from
`docs/extension-sdk-reference/...`" — written at the top of a dozen files under
`core/app/extension-host/` — a claim anyone can check. The living contract is
`sdk/extension/contract/sdk.ts` and it has grown since: result schemas, local
widget actions, shared data. Change that file, never this one.

Editing here is worse than useless, because the folder is named like a
reference and reads like one: a widget author who finds the old shape here has
no reason to doubt it. That already happened once — a migration added a
`WidgetActionDefinition[]` to this file, describing an action shape the app had
stopped accepting.

```bash
npm install
npx tsc --noEmit          # strict, clean
npx tsx src/test/scenarios.ts   # 37 assertions
```

- `CLAUDE.md` — implementation handoff. Read first.
- `FINDINGS.md` — seven contract errors found by running this suite.
- `src/sdk.ts` — the contract. Zero framework dependency.
- `src/sdk-vue.ts` — the only file that imports Vue.
- `src/host/` — reference host runtime.
- `src/extensions/` — Todo and Google Calendar are the falsification cases;
  Tado is the control; Weather covers the capability-only path.
- `src/test/scenarios.ts` — the regression suite. Keep it green.
