# Widget Generation Skill

**Date:** 2026-07-19  
**Status:** Approved

## Goal

Speed up and stabilize first-party widget/extension work by encoding Kavibay’s extension contract and a **tiered process** in a project skill. Stop paying a full design→1000-line-plan tax on simple client widgets.

## Decisions

| Topic | Choice |
|-------|--------|
| Artifact | Project skill (not a scaffold CLI, not per-widget mega-plans) |
| Location | `.cursor/skills/kavibay-widget/` |
| Auto-invoke | Yes — description triggers on add/create/build widget/extension |
| Process | Tier S / M / L before brainstorming or planning |
| Plans | Thin plans only: interfaces + tasks + verify; **no** pasted full file bodies |
| Boilerplate | Clone from named reference extensions; no code generator |
| Docs | Short design spec here; skill is the living procedure |

## Tiers

| Tier | When | Process |
|------|------|---------|
| **S — Simple** | Client-only; host patterns already exist; no new Rust module; no new Settings nav | Decision list → implement from a reference extension. Skip design doc and long plan |
| **M — Medium** | New settings/state/menu or non-trivial UI; still no new Rust module | Short design (decisions only) → thin plan → implement |
| **L — Large** | New Rust module, credentials store, streaming, OS APIs, settings architecture changes | Full design + thin plan (Superpowers path) |

Default bias: **S**, unless criteria clearly require M or L.

## Skill layout

```
.cursor/skills/kavibay-widget/
  SKILL.md       # workflow, tier gate, thin-plan rule, verification
  reference.md   # file checklist, manifest/lifecycle, patterns, references
```

`SKILL.md` stays short. Agents load `reference.md` when implementing.

## Thin plan shape (M / L)

Required sections:

1. Goal (1–2 sentences)
2. Global constraints (bullets)
3. File table (path → responsibility)
4. Tasks with: files touched, interfaces produced/consumed, verify steps
5. Manual UI checklist

Forbidden: embedding complete source for each file in the plan.

## Reference extensions

| Need | Clone from |
|------|------------|
| Minimal client | `calculator` |
| Settings + localStorage | `clock`, `weather` |
| Menu + rich per-instance state | `notes` |
| `backendCommand` + refresh | `system-info`, `now-playing` |
| Credentials / Rust / streaming | `tado`, `ask-llm` |

Canonical architecture: `docs/superpowers/specs/2026-07-18-extension-system-design.md`.

## Verification (always)

- Pure helpers: Node assert script or `npx tsx` when present
- Frontend: `npx vue-tsc --noEmit`
- Rust (if touched): `cargo check -p kavibay_lib` and targeted `cargo test -p kavibay_lib …`
- Manual: add from palette, duplicate/dispose if stateful, settings if any

No Vitest in this repo today — do not introduce a test runner unless asked.

## Out of scope

- Scaffold / codegen CLI
- Runtime third-party extensions
- Migrating or rewriting historical long plans
- Changing `loadExtensions` / host APIs

## Success criteria

- Simple widgets skip multi-hundred-line plans by default
- Agents consistently place files under `src/extensions/<id>/` with correct manifest + lifecycle
- Complex widgets still get a short design + thin plan, not a second copy of the codebase
