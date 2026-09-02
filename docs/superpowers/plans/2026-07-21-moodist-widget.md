# Moodist Ambient Mixer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a compact **Moodist** extension that mixes looping ambient sounds (Nature / Rain / Noise) with per-sound volume, global play/pause/clear, and per-instance persistence.

**Architecture:** Data-driven `catalog.ts` + vendored local audio; pure persist helpers in `moodistLogic.ts`; per-instance reactive cache + `HTMLAudioElement` map in `useMoodistState.ts`; dense browse UI in `MoodistWidget.vue`. Host discovery via `import.meta.glob` — no registry edits.

**Tech Stack:** Vue 3 + TypeScript, Vite, Tauri 2 overlay; native `HTMLAudioElement` only (no Howler / Web Audio / new deps).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-moodist-widget-design.md`
- Tier M — client-only; no Rust; no Settings nav; no `settingsComponent`
- Extension id `moodist`, name **Moodist**, category `productivity`
- Storage key `kavibay:moodist-widget:{instanceId}`
- v1 categories only: **nature**, **rain**, **noise** (full Moodist set for those three)
- Assets vendored under `src/extensions/moodist/sounds/`; never fetch at runtime
- Ship `LICENSES.md` with Moodist MIT + Pixabay Content License + CC0 notes
- Layout: dense browse (category icons → Play/Clear → scrollable rows)
- `playing` is runtime-only — never persist; never autoplay on load/resume/duplicate
- Match Kavibay dark glass (rgba white overlays) — no purple/glow theme
- Clone lifecycle patterns from `pomodoro` / `clock`
- No Vitest — `npx tsx …assert.ts`, `npx vue-tsc --noEmit`, manual UI
- Thin plan: implement code in the repo, not by pasting whole files here
- Comment new exported methods/functions with a short purpose note

## File Structure

| File | Responsibility |
|------|----------------|
| `src/extensions/moodist/manifest.json` | Catalog entry |
| `src/extensions/moodist/index.ts` | Extension module + lifecycle |
| `src/extensions/moodist/catalog.ts` | Categories + sounds + bundled `src` URLs |
| `src/extensions/moodist/icons.ts` | Tiny inline-SVG (or unicode) map by icon id — no new icon package |
| `src/extensions/moodist/moodistLogic.ts` | Persist types, normalize, load, save, clear, duplicate seed |
| `src/extensions/moodist/moodistLogic.assert.ts` | Node assert script |
| `src/extensions/moodist/useMoodistState.ts` | Per-instance cache, debounce, audio lifecycle |
| `src/extensions/moodist/MoodistWidget.vue` | Dense browse UI |
| `src/extensions/moodist/sounds/nature/*.mp3` | Vendored nature loops |
| `src/extensions/moodist/sounds/rain/*.mp3` | Vendored rain loops |
| `src/extensions/moodist/sounds/noise/*.{wav,mp3}` | Vendored noise loops (upstream uses `.wav`) |
| `src/extensions/moodist/LICENSES.md` | Attribution |

---

### Task 1: Pure persist model

**Files:**
- Create: `src/extensions/moodist/moodistLogic.ts`
- Create: `src/extensions/moodist/moodistLogic.assert.ts`

**Interfaces:**
- Consumes: nothing (pure); may import `categories` from `catalog.ts` **only after Task 2 exists** — for Task 1, accept `defaultCategoryId: string` / known ids as parameters, or stub `DEFAULT_CATEGORY_ID = "nature"` and validate against a `knownSoundIds: ReadonlySet<string>` argument. Prefer: logic does not import catalog; callers pass valid ids. Normalize clamps volumes and drops unknown sound keys when given an allowlist.
- Produces:
  - `MoodistPersisted`: `{ version: 1; activeCategoryId: string; volumes: Record<string, number> }`
  - `storageKey(instanceId: string): string` → `kavibay:moodist-widget:{instanceId}`
  - `emptyState(defaultCategoryId: string): MoodistPersisted`
  - `clampVolume(value: unknown): number` — finite, clamp to `[0, 1]`
  - `normalizeState(raw: unknown, opts: { defaultCategoryId: string; categoryIds: ReadonlySet<string>; soundIds: ReadonlySet<string> }): MoodistPersisted` — repair version, fallback category, clamp volumes, drop unknown sound keys, drop volume `0` entries optional (either keep or strip — **strip zeros** to keep storage small)
  - `loadState` / `saveState` / `clearState` (localStorage; load uses normalize)
  - `isActive(volumes, soundId): boolean` → `(volumes[soundId] ?? 0) > 0`
  - `toggleSound(volumes, soundId, defaultVolume = 0.5): Record<string, number>` — if active → remove/set 0; else set `defaultVolume`
  - `setSoundVolume(volumes, soundId, volume): Record<string, number>` — volume `≤ 0` removes key; else sets clamped
  - `clearVolumes(): Record<string, number>` → `{}`
  - `stateForDuplicate(state: MoodistPersisted): MoodistPersisted` — deep copy volumes + category (playing not stored)

- [ ] **Step 1:** Implement `moodistLogic.ts` with purpose comments on exports
- [ ] **Step 2:** Assert: normalize repairs bad category / out-of-range volumes / unknown keys; toggle/setVolume/clear; load→save round-trip via mocked localStorage or in-memory if easier (prefer real localStorage in Node with stub: inject storage object — if current clock/pomodoro use `localStorage` directly, match that and assert with `globalThis.localStorage` polyfill or only test pure normalize/toggle without storage; **minimum:** normalize + toggle + setVolume + clear + stateForDuplicate)
- [ ] **Step 3:** Verify — `npx tsx src/extensions/moodist/moodistLogic.assert.ts` → exit 0
- [ ] **Step 4:** Commit `feat(moodist): add persist model helpers`

---

### Task 2: Catalog, icons, vendored sounds, licenses

**Files:**
- Create: `src/extensions/moodist/catalog.ts`
- Create: `src/extensions/moodist/icons.ts`
- Create: `src/extensions/moodist/LICENSES.md`
- Create: `src/extensions/moodist/sounds/nature/*.mp3` (12 files)
- Create: `src/extensions/moodist/sounds/rain/*.mp3` (8 files)
- Create: `src/extensions/moodist/sounds/noise/white-noise.wav`, `pink-noise.wav`, `brown-noise.wav`

**Interfaces:**
- Consumes: nothing
- Produces (`catalog.ts`):
  - Types: `MoodistSound = { id: string; label: string; icon: string; src: string }`, `MoodistCategory = { id: string; title: string; icon: string; sounds: MoodistSound[] }`
  - `categories: MoodistCategory[]` — order: nature, rain, noise
  - `allSoundIds(): ReadonlySet<string>`, `allCategoryIds(): ReadonlySet<string>`, `defaultCategoryId(): string` (first category)
  - `findCategory(id: string): MoodistCategory | undefined`, `soundsForCategory(id: string): MoodistSound[]`
  - Asset URLs via `new URL('./sounds/...', import.meta.url).href` (Vite-compatible)
- Sound inventory (ids must match filenames without extension except noise `.wav`):

  **nature:** `river`, `waves`, `campfire`, `wind`, `howling-wind`, `wind-in-trees`, `waterfall`, `walk-in-snow`, `walk-on-leaves`, `walk-on-gravel`, `droplets`, `jungle`

  **rain:** `light-rain`, `heavy-rain`, `thunder`, `rain-on-window`, `rain-on-car-roof`, `rain-on-umbrella`, `rain-on-tent`, `rain-on-leaves`

  **noise:** `white-noise`, `pink-noise`, `brown-noise` (`.wav`)

- Download from Moodist raw (example base):  
  `https://raw.githubusercontent.com/remvze/moodist/main/public/sounds/{category}/{file}`
- `icons.ts`: map icon string ids → small inline SVG component props or render helper used by the widget (category + sound). Keep ~15–20 keys; reuse generics where needed. No new npm dependency.
- `LICENSES.md` must include:
  - Moodist project MIT (link to upstream)
  - Sounds subject to **Pixabay Content License** and/or **CC0** (link both summaries as in upstream README)

- [ ] **Step 1:** Create sound directories; download all listed files (PowerShell `Invoke-WebRequest` or curl); verify file sizes &gt; 0
- [ ] **Step 2:** Implement `catalog.ts` + `icons.ts`
- [ ] **Step 3:** Write `LICENSES.md`
- [ ] **Step 4:** Verify — Node one-liner or assert that every catalog `src` path resolves to an existing file on disk (optional small `catalog.assert.ts` or extend Task 1 assert); count = 12+8+3 = 23 assets
- [ ] **Step 5:** Commit `feat(moodist): vendor curated sounds and catalog`

---

### Task 3: Reactive state + extension shell

**Files:**
- Create: `src/extensions/moodist/useMoodistState.ts`
- Create: `src/extensions/moodist/manifest.json`
- Create: `src/extensions/moodist/index.ts`
- Create: `src/extensions/moodist/MoodistWidget.vue` (minimal shell OK — title/placeholder)

**Interfaces:**
- Consumes: Task 1 logic + Task 2 catalog
- Produces (`useMoodistState`):
  - Cache: `Map<instanceId, Ref<MoodistRuntime>>` where runtime = persisted fields + `playing: boolean` (always false on load)
  - `useMoodistState(instanceId)` → `{ state, setCategory, toggleSound, setVolume, play, pause, togglePlay, clear, flush }`
  - Debounced save (~300ms) on volumes/category changes; never write `playing`
  - Audio map `Map<instanceId, Map<soundId, HTMLAudioElement>>`:
    - Lazy create when volume &gt; 0
    - `loop = true`; sync `volume` from state
    - `play()`: for each volume &gt; 0, ensure element, set volume, `element.play().catch(() => {})`; set `playing=true` only if at least one play started / mix non-empty — **if mix empty, leave `playing=false`**
    - `pause()`: pause all elements; `playing=false`
    - `clear()`: volumes `{}`, pause + remove elements (or pause and clear src)
    - `setVolume`: update element volume; if ≤0 tear down that element; if &gt;0 and `playing`, ensure playing
    - `toggleSound`: via logic helper; sync audio
  - `disposeMoodistState(instanceId)`: pause/tear down audio, drop cache, `clearState`
  - `seedMoodistStateFrom(fromId, toId)`: copy via `stateForDuplicate`; `playing=false`; no audio on target
  - `suspendMoodistState(instanceId)`: pause playback (`playing=false`); keep volumes
  - `resumeMoodistState`: no-op for autoplay (volumes remain; user must Play)
- Manifest: id `moodist`, keywords ambient/sound/focus/moodist/noise, `ui.allowDuplicate: true`, sensible `defaultOffset`, width-friendly (~280)
- `index.ts`: `component`, `onDuplicate`, `onSuspend`, `onResume` (optional no-op), `onDispose`

- [ ] **Step 1:** Implement composable with audio lifecycle + purpose comments
- [ ] **Step 2:** Scaffold manifest + index + stub widget that injects `widgetInstanceId` and mounts
- [ ] **Step 3:** Verify — `npx vue-tsc --noEmit` → exit 0; palette lists **Moodist**
- [ ] **Step 4:** Commit `feat(moodist): add state composable and extension shell`

---

### Task 4: Dense browse widget UI

**Files:**
- Modify: `src/extensions/moodist/MoodistWidget.vue`
- Modify: `src/extensions/moodist/useMoodistState.ts` only if UI needs small API tweaks

**Interfaces:**
- Consumes: composable + catalog + icons
- Produces UI per spec:
  - Category icon strip (3 icons); selected highlighted; click → `setCategory`
  - Play/Pause pill + Clear button
  - Small category title
  - Scrollable rows for `soundsForCategory(activeCategoryId)`: icon, label, range input `0–1` step `0.01`
  - Active row styling when `isActive`
  - Row click toggles sound (avoid double-firing with slider — slider `@click.stop` / `@pointerdown.stop`)
  - Slider `input` → `setVolume`; volume &gt; 0 activates
  - Click-through: pause regions like other interactive widgets (`setClickThroughPaused` / `scheduleRegionSync` if Pomodoro/Todo do)
  - Compact CSS matching Kavibay density (~280px content width)

- [ ] **Step 1:** Build chrome: category strip + play/clear + title
- [ ] **Step 2:** Build sound rows + volume sliders + active styles
- [ ] **Step 3:** Wire click-through pause if peers do; polish spacing
- [ ] **Step 4:** Verify — manual checklist below; `npx vue-tsc --noEmit`; re-run `moodistLogic.assert.ts`
- [ ] **Step 5:** Commit `feat(moodist): ship dense ambient mixer UI`

---

## Manual UI

- [ ] Palette add **Moodist**; appears under productivity
- [ ] Switch Nature / Rain / Noise; list updates; other-category layers keep playing
- [ ] Toggle 2+ sounds; adjust volumes; hear layered loops
- [ ] Pause stops all; Play resumes same mix; Clear empties mix and stops audio
- [ ] Restart app: volumes/category restored; not playing until Play
- [ ] Duplicate: copy mix; both independent; dispose clears storage + stops audio
- [ ] Empty mix + Play: stays not playing
- [ ] `LICENSES.md` present in extension folder

## Spec coverage (self-check)

| Spec requirement | Task |
|------------------|------|
| Extension id/name/category | 3 |
| Nature + Rain + Noise curated catalog | 2 |
| Vendored assets + license notes | 2 |
| Dense browse layout | 4 |
| Multi-layer + per-sound volume | 3, 4 |
| Play/Pause/Clear | 3, 4 |
| Persist volumes + category; no autoplay | 1, 3 |
| HTMLAudioElement lifecycle / dispose | 3 |
| Duplicate / suspend | 3 |
| Assert + vue-tsc | 1–4 |
| No favorites/presets/binaural/Web Audio | — out of scope |

## Placeholder / consistency check

- No full file dumps; signatures listed in Tasks 1–3
- Noise files are `.wav` (matches upstream); nature/rain `.mp3`
- Logic stays catalog-agnostic via allowlists; catalog owns sound inventory
- Empty mix does not flip `playing` to true
