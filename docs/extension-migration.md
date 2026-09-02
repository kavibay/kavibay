# Extension migration map

Status: 2026-08-20. This document measures the 31 folders under `extensions/`:
26 are on the Contract host and 5 still use the legacy `index.ts` loader. All
references below use path:line. Tado is already implemented at
`extensions/tado/extension.ts` and replaces the old catalog entry.

> **Update 2026-08-19 — clean-break storage policy.** Contract extensions do
> not read, normalize, copy, or delete pre-contract widget storage. New config
> and `ctx.data` cells are authoritative; existing old `kavibay:` keys are
> intentionally ignored. Completed Contract rows describe canonical storage;
> older migration wording is historical assessment only.

> **Update 2026-08-19 — System Info and Now Playing ported.** Both widgets now
> use the Contract layout and effect-scope polling. System Info uses schema
> configuration plus the reviewed `ctx.systemInfo` snapshot capability; Now
> Playing uses `ctx.nowPlaying` for its snapshot and fixed transport actions.
> The old generic `backendCommand` path is no longer used by either widget.

> **Update 2026-08-19 — Alarm and Moodist ported.** Alarm stores its rows in
> `ctx.data`, keeps its scheduler in the widget effect scope, and uses the
> reviewed fixed `ctx.alarm` notification capability for sound and reveal.
> Moodist stores its category/volume mix in `ctx.data`; audio remains local to
> the first-party widget and is torn down with the effect scope. Neither reads
> the old per-instance `kavibay:` keys.

> **Update 2026-08-20 — Snake and Snippets ported.** Snake stores its board
> size in instance `ctx.data`, keeps the high score in extension-scoped
> `sharedData`, and uses the reviewed HTTPS-only `ctx.openExternal` surface for
> its win easter egg. Snippets keeps its shared library in extension-scoped
> `sharedData`, exposes its dynamic placeholder chips through the Contract
> palette adapter, and writes expansions through the reviewed `ctx.clipboard`
> capability. Both old localStorage paths and legacy `index.ts` loaders are
> gone for these widgets.

> **Update 2026-08-20 — Focus Tracker ported.** Focus Tracker now uses the
> Contract layout and effect-scope polling through the reviewed fixed
> `ctx.focusTracker` capability. The status/summary reads and habit/ignore rule
> writes stay behind the host adapter; its custom settings panel is a Contract
> view setting, and the old direct `invoke` loader is gone.

> **Update 2026-08-20 — Clipboard, Color Picker, Image, and Launcher Buttons
> ported.** Clipboard history, native color picking, image import/clear, and
> desktop launching now cross the host through fixed reviewed capabilities
> (`ctx.clipboard`, `ctx.colorPicker`, `ctx.image`, and `ctx.launcher`). Image
> and Launcher Buttons use canonical `ctx.data`; the old localStorage keys,
> direct `invoke` calls, and legacy loaders are gone.

> **Update 2026-08-17 — where a migrated widget lives, and prerequisite 3.**
>
> Migrated widgets are folders under `extensions/<id>/`, not files inside the
> host. Two reasons, and the second was the one nobody had noticed: folders are
> licence boundaries, so a widget parked under `core/app/` is GPL while every
> other first-party widget is MIT. The move corrects a filing, it does not
> relicense host code.
>
> Phase 0 prerequisite 3 (catalog parity) is **done**, and differently than
> written here. Icons, keywords, categories, default offset/size and the UI
> flags now come from each extension's own `manifest.json`, read by
> `core/app/extension-host/bundledExtensions.ts`. The three host-side maps
> this document assumed would grow with every port — catalog metadata,
> `REPLACES`, and `widgetViews` — are derived rather than hand-written, so a
> port no longer adds a line to any of them. Prerequisites 1 (static select
> options) and 4 (no lifecycle hook needed) were already done; prerequisite 2
> (config clone/evict) is done via `copyInstanceConfig` /
> `disposeInstanceConfig`. Gap **P** in the table below is therefore closed;
> the rest of the measurement stands.

> **Update 2026-08-18 — Stopwatch ported.** Stopwatch now uses the bundled
> contract layout under `extensions/stopwatch/`. `onScopeDispose` pauses and
> snapshots its elapsed time and laps for a same-session remount; a session
> marker rejects stale state after an app restart. The contract adapter evicts
> `ctx.data` generically after Vue unmounts, so removing an instance cannot
> leave the handoff record behind.

> **Update 2026-08-18 — Calculator ported; Phase 1 complete.** Calculator now
> stores its bounded history and uncommitted expression in canonical `ctx.data`.
> Duplicate instances still start empty and disposal evicts canonical data
> through the generic host seam.

> **Update 2026-08-18 — Redacted ported.** Redacted now uses declarative
> `color` and `borderRadius` configuration, while `flush`, `fullDrag`,
> `defaultHideTitle`, and catalog sizing remain manifest metadata. The old
> per-instance settings key is not read; configuration is canonical Contract
> config. The view retains the opaque parent-card surface so custom radii do not
> expose the card corners while screensharing.

> **Update 2026-08-18 — Pomodoro ported; Phase 2 timer acceptance is done.**
> Pomodoro stores phase, completed sessions, remaining time, and its deadline in
> `ctx.data`, so a hidden/remounted card resumes an active session. The old
> storage is not read; configuration and state are canonical Contract stores. A
> generic widget-local Contract action now adapts to the existing palette action
> surface; Pomodoro uses it for start/stop/restart and optional focus minutes.

> **Update 2026-08-18 — Todo ported; nested content acceptance is done.** Todo
> now stores its flat parent/order tree in canonical `ctx.data`, opts into
> generic data cloning for duplicates, and exposes its Clear Completed menu,
> inline summary, and `todo-add` palette action through the Contract host.

> **Update 2026-08-19 — Notes ported; rich-text content acceptance is done.**
> Notes now stores its Markdown document and toolbar preference in `ctx.data`,
> keeps TipTap behind an async view boundary, and exposes its menu, local
> `new-note` action, duplicate cloning, and generic palette body search through
> the Contract host. Palette body previews and snippets now use an
> extension-provided search-text callback instead of a Notes-specific host switch.

> **Update 2026-08-19 — Time Tracker ported; ledger acceptance is done.** The
> project/task/session ledger now lives in `ctx.data`, while week and month
> boundaries use schema-driven contract configuration. Duplicate cloning keeps
> closed sessions but drops an active session through the generic data transform
> hook. Project and task names feed the generic palette search.

> **Update 2026-08-19 — Timer and Emoji Picker ported; Phase 3 row/state
> acceptance is done.** Timer now stores its normalized countdown snapshot in
> `ctx.data`, keeps the local action and state-dependent palette-row buttons,
> and resets runtime status when duplicated. Emoji Picker uses the new generic
> extension-scoped `sharedData` store for recents, so multiple picker instances
> still share the list without an extension-specific host switch; its search
> action and row action remain contract-owned.

> **Update 2026-08-19 — Weather ported; first public HTTP extension.** Weather
> now uses the contract host's declared `ctx.http` capability for Open-Meteo
> geocoding and forecasts. Location is schema configuration and the carousel
> index is canonical `ctx.data`; no pre-contract weather store is read. The local action is paired from
> the manifest declaration to its definition handler and updates configuration
> through the host seam.

> **Update 2026-08-20 — Google Calendar ported.** Calendar now uses the
> credential-backed Contract provider for paginated calendar/event queries and
> event creation. The widget selects one or more calendars through schema-driven
> settings, keeps month navigation and quick add in its effect scope, and uses
> the reviewed external-link capability for meeting links. The old Tauri data
> commands, custom auth/settings panels, and per-instance calendar preference
> storage are removed; old Calendar storage is intentionally ignored.

The counts were produced by checking every index.ts against every
ExtensionModule field, then checking the dependent widget and persistence code.
The reference fixtures are excluded from the migration set.

## Executive answer

Clock is the right first real port, but it is not a zero-change port. Its timer
fits the contract's effect-scope teardown, and it has no provider, Rust backend,
palette action, menu, inline row, or text action. The first contract addition it
needs is static options for ConfigField type select: the current form only loads
options from a provider query, while Clock has four local option lists
(extensions/clock/ClockSettings.vue:12-30;
core/app/extension-host/ui/ConfigForm.vue:41-52). It also needs host-side
configuration migration and generic duplicate/evict handling.

The fixture must stay untouched. fixtures/clock.ts is loaded by the cockpit at
startup (core/app/extension-host/cockpit.ts:13-16,49-55) and its exact
shape is pinned by the contract assertions (docs/extension-host.md:75-80). A
real Clock definition has the same definition id, kavibay.clock/clock, so
shipping it means removing the fixture from cockpit runtime registration and
replacing its view mapping, while leaving the fixture for the assert suite.
Loading both is a definition-id collision.

Recommended order, after the small host prerequisites:

1. Clock — local static configuration and legacy config migration.
2. Stopwatch — timer teardown and visibility semantics without data loss.
3. Calculator — a small ctx.data migration with no provider or backend.
4. Redacted — schema-driven settings and presentation flags.
5. Pomodoro — durable timer state and a local palette action.
6. Todo — first real user-content migration; also menu, inline detail, and
   palette-action proof.
7. Notes, then Time Tracker — larger content migrations.
8. Timer and Emoji Picker — row actions, shared state, and action arguments.
9. Weather, then Stocks — public HTTP/provider adaptation.
10. System Info, then Now Playing — backend polling, simple snapshot first.
11. Calendar, then GitHub Actions — credentials, providers, polling, and writes.
12. Alarm, Moodist, Snake, and Snippets — distinct host capability cases (done).
13. Focus Tracker, Clipboard, Color Picker, Image, and Launcher Buttons — OS
    and filesystem integrations (done).
14. Single Purpose LLM — credentials, streaming, cancellation, and text actions.

Confetti, Kill Port, Widget Gallery, and Widget Wizard now use the Contract host.
The Wizard keeps its package-generation and control-plane work behind the
reviewed `ctx.wizard` capability; its preview and permission chrome are
host-provided components, so the extension itself has no direct `core` or Tauri
imports.

## 1. Gap table

“Expressed” means the contract has the needed meaning. “Reaches cockpit” means
toRegistered() actually places it in RegisteredExtension. “Unblocks” is the
number of extensions that use the field. The rank is by that count.

| Rank | Old capability | Count | Expressed? | Reaches cockpit? | Missing / result |
|---:|---|---:|---|---|---|
| — | component | 28 | Partly. WidgetDefinition.component is a headless setup(ctx), not a Vue SFC (sdk/extension/contract/sdk.ts:180-207). | Yes, indirectly: widgetViews owns the Vue view and toRegistered wraps CockpitWidget (core/app/extension-host/widgetViews.ts:8-26; core/app/extension-host/cockpit.ts:251-263). | Every SFC must be re-authored as a headless model plus a view. |
| 1 | iconComponent | 28 | No equivalent in the contract manifest/widget types (sdk/extension/contract/sdk.ts:39-51,180-198). | No; toRegistered hard-codes iconComponent undefined (core/app/extension-host/cockpit.ts:274-299). | Add icon metadata and mapping, or accept 28 entries without their old icons. |
| 2 | onCreate/onDuplicate/onSuspend/onResume/onDispose | 21 use at least one | No old hook family. The contract owns teardown through onScopeDispose; widgets get no mount/unmount hook (docs/extension-host.md:41-47). | No; toRegistered returns none of them (core/app/extension-host/cockpit.ts:274-308). | Add host-owned config/data clone, eviction, and visibility semantics; do not add five extension-specific hooks. |
| 3 | actions and actionHandlers | 12 | Contract provider commands remain separate; bundled definitions now have local widget actions and standalone action contributions (sdk/extension/contract/sdk.ts; core/app/extension-host/cockpit.ts). | Both forms reach the existing palette; provider commands remain separate. | Closed for local and standalone first-party actions; text actions remain a separate boundary. |
| 4 | settingsComponent | 11 | Partly. configuration plus the runtime form express simple schema fields, not an arbitrary Vue panel or static select options (sdk/extension/contract/sdk.ts:209-216; core/app/extension-host/ui/ConfigForm.vue:5-14). | Only the generic form is used; toRegistered creates it when configuration exists (core/app/extension-host/cockpit.ts:265-272,306-308). | Add ConfigField.options first for Clock. |
| 5 | menuComponent | 6 | Bundled `view.ts` entries may contribute a Vue menu alongside the framework-free definition. | Yes; the adapter carries it into `RegisteredExtension.menuComponent`. | Closed for bundled menus; runtime packages remain intentionally menu-free. |
| 6 | backendCommand and refreshInterval | 2 each | No arbitrary Tauri command or generic backend poll. The contract now exposes reviewed, fixed host capabilities for bundled OS widgets (sdk/extension/contract/sdk.ts). | `Host.buildWidgetContext()` binds only the compiled capability declaration; runtime packages cannot request it. | Closed for System Info, Now Playing, Alarm, Snake, and Snippets; future host surfaces need their own reviewed capability rather than a generic command string. |
| 7 | inlineView and instanceActions | 2 use each | Contract widgets may contribute a synchronous JSON inline summary; row instance actions remain unmodelled. | Inline summaries reach the palette; instance actions stay a later gap. | Inline view closed; add a separate row-action surface when required. |
| 8 | textActions family | 1 extension | No equivalent. | No; the cockpit maps contract commands, not selection actions (core/app/extension-host/cockpit.ts:311-365; core/app/extensions/textActions.ts:34-110). | Keep Single Purpose LLM in the old host until a text-action boundary exists. |
| 9 | dynamicActionParams | 1 | Contract widget definitions may rebuild local action chips from the values already typed in the palette (sdk/extension/contract/sdk.ts). | The cockpit forwards the definition callback to the existing palette argument mode. | Closed for Snippets; the callback remains intentionally extension-owned. |

The measured individual counts are: component 28, iconComponent 28,
settingsComponent 11, menuComponent 6, actions 12, dynamicActionParams 1,
the text-action family 1, inlineView 2, instanceActions 2, backendCommand 2,
refreshInterval 2, onCreate 2, onDuplicate 19, onSuspend 6, onResume 3, and
onDispose 21. The field definitions are sdk/extension/types.ts:277-325; the
old loader copies them into the catalog at
core/app/extensions/loadExtensions.ts:254-271.

### Contract prerequisites before Clock

1. Add static options to ConfigField, for example an options array of value and
   label. ClockSettings.vue defines local options for locale, hour format, date
   style, and curated timezones (extensions/clock/ClockSettings.vue:12-30),
   while ConfigForm only loads a select when field.source is provider-backed
   (core/app/extension-host/ui/ConfigForm.vue:41-58).
2. Add a generic config migration/clone/evict seam. The cockpit currently loads
   config from kavibay:widget-config:<instance> and keeps a reactive map
   (core/app/extension-host/cockpit.ts:152-224), but has no generic config
   eviction. InstanceDataStore.evict exists for the separate data namespace
   (core/app/extension-host/data-store.ts:33-42,97-103).
3. Decide catalog parity before shipping: icons, keywords/categories, default
   offset/size, and UI flags exist in the old manifest
   (sdk/extension/types.ts:193-263) but are absent or hard-coded in toRegistered
   (core/app/extension-host/cockpit.ts:274-299).
4. No contract lifecycle hook is needed for Clock. The fixture demonstrates
   timer setup in setup and cleanup via onScopeDispose
   (core/app/extension-host/fixtures/clock.ts:13-16,33-40).

## 2. Per-extension table

Gap codes: P = catalog icon/presentation metadata; L = host-owned lifecycle,
clone/evict, and visibility semantics; C = schema settings/static options;
A = old local palette actions; M = menu or palette-row detail/actions;
B = provider, OS, filesystem, or other host capability; R = backend snapshot
polling; T = text actions; S = streaming/cancellation. D means data migration
into a contract key space. H means host orchestration.

| Extension | Host surface actually used | State and loss if migration is omitted | Rust/backend | Contract gap | Verdict |
|---|---|---|---|---|---|
| alarm | Contract component, icon, local action, duplicate, and effect-scope scheduler (`extensions/alarm/extension.ts`, `extensions/alarm/view.ts`, `extensions/alarm/widgets/alarm.ts`). | Alarm rows live in canonical `ctx.data`; old per-instance keys are ignored. | Sound and window reveal/focus use the reviewed fixed `ctx.alarm` capability. | Closed: P A L B D | Ported; generic data clone/evict owns duplicate/remove. |
| calculator | Ported contract widget and SDK icon (`extensions/calculator/extension.ts`, `extensions/calculator/view.ts`). | Expression draft and capped history live in canonical `ctx.data` (`extensions/calculator/widgets/calculator.ts`). Pre-contract keys are ignored. | None found. | Closed: P L D | Ported in Phase 1. |
| calendar | Contract component, menu, icon, schema configuration, provider queries/actions, and reviewed meeting-link capability (`extensions/calendar/extension.ts`, `extensions/calendar/view.ts`, `extensions/calendar/widgets/`). | Selected calendar ids are canonical Contract configuration; old multi-calendar preference storage is ignored. | Google Calendar OAuth credential and host-side provider transport (`src-tauri/src/extensions/calendar/mod.rs`). | Closed: P C M L B D | Ported; generic gate owns connection/configuration and the Contract provider owns pagination and writes. |
| clipboard | Contract component and icon (`extensions/clipboard/extension.ts`, `extensions/clipboard/view.ts`). | History remains backend-owned and is read through the capability; no old widget storage is imported. | Rust list/restore/reveal/delete/clear through the reviewed fixed `ctx.clipboard` capability; image previews use the host asset URL adapter. | Closed: P B | Ported; the widget polls the backend-owned history and the old loader is gone. |
| clock | Component, settings, icon, duplicate/dispose (extensions/clock/index.ts:7-15). | locale, hour12, showSeconds, dateStyle, and timeZone live under kavibay:clock:<instance>, with legacy singleton kavibay:clock-v1; omission resets formatting and timezone (extensions/clock/clockLogic.ts:6-23,15,68-113). | None. | P C L D; timer teardown is supported by onScopeDispose (core/app/extension-host/fixtures/clock.ts:33-40). | First candidate, after static select options and config migration. |
| color-picker | Contract component and icon (`extensions/color-picker/extension.ts`, `extensions/color-picker/view.ts`). | No durable state found; an unfinished pick is ephemeral. | Rust start/stop plus sample/picked/cancelled events through the reviewed fixed `ctx.colorPicker` capability; copies use `ctx.clipboard`. | Closed: P B | Ported; event subscription and teardown are owned by the Contract model. |
| confetti | Standalone Contract palette action (`extensions/confetti/extension.ts`). | None. | Browser/global fullscreen effect. | Closed: A | Ported; it remains a global palette action without a widget card. |
| emoji-picker | Contract component, icon, local action, shared recent store, row action (`extensions/emoji-picker/extension.ts`, `extensions/emoji-picker/widgets/`). | Shared recents live in the extension-scoped `sharedData` cell; duplicate widgets read the same store. Pre-contract keys are ignored. | None found. | Closed: P A M L D | Ported in Phase 3; the host-owned shared scope keeps the old cross-instance semantics. |
| focus-tracker | Contract component, icon, custom settings, and effect-scope 5-second polling (`extensions/focus-tracker/extension.ts`, `extensions/focus-tracker/view.ts`, `extensions/focus-tracker/widgets/focusTracker.ts`). | Habit/ignore rules remain backend-owned; the Contract settings panel reaches them only through `ctx.focusTracker`. Pre-contract widget storage was not used. | Rust status/summary/rules/recent-app commands through the reviewed fixed Focus Tracker capability (`src-tauri/src/extensions/focus_tracker/commands.rs`). | Closed: P B R | Ported; no direct `invoke` or legacy loader remains. |
| gallery | Contract component, icon, host add-widget callback, and catalog (`extensions/gallery/extension.ts`, `extensions/gallery/view.ts`). | No extension-owned content; without the callback it cannot add widgets. | None found. | Closed: P H | Ported; catalog/onboarding orchestration still enters through the reviewed host callback. |
| github | Contract extension with GitHub Actions as its first widget (`extensions/github/extension.ts`, `extensions/github/view.ts`, `extensions/github/widgets/`). | Owner/repo are canonical Contract configuration; the old per-instance `localStorage` settings are ignored by design. | GitHub PAT through the shared credential registry and provider transport (`extensions/github/provider.ts`, `src-tauri/src/extensions/github/mod.rs`); run links use `ctx.openExternal`. | Closed: P C L B R D | Ported; `github-actions` remains the widget/catalog id, while the extension is named `github`. |
| image | Contract component, icon, schema style setting, and duplicate data (`extensions/image/extension.ts`, `extensions/image/view.ts`, `extensions/image/widgets/image.ts`). | Source URL/path, variant, and size live in canonical `ctx.data`; pre-contract localStorage is ignored. | App-data import/clear and asset URLs through the reviewed fixed `ctx.image` capability (`src-tauri/src/extensions/image_widget/mod.rs`). | Closed: P C L B D | Ported; each instance owns its copied file and the old loader/settings path is gone. |
| kill-port | Standalone Contract palette action with an icon (`extensions/kill-port/extension.ts`). | None. | Privileged process termination through the existing fixed `kill_port` command. | Closed: A B | Ported; port parsing stays extension-owned and the action never creates a widget. |
| launcher-buttons | Contract component, icon, schema settings, and duplicate data (`extensions/launcher-buttons/extension.ts`, `extensions/launcher-buttons/view.ts`, `extensions/launcher-buttons/widgets/launcherButtons.ts`). | App list, icons, sizing, and mute flags live in canonical `ctx.data`; old localStorage is ignored. | Installed-app enumeration, file/image pickers, icon extraction, URL icons, launch paths, and virtual keys through the reviewed fixed `ctx.launcher` capability (`src-tauri/src/extensions/app_launcher/mod.rs`). | Closed: P C L B D | Ported; the widget no longer calls Tauri directly and the legacy loader/menu state is gone. |
| moodist | Contract component, icon, duplicate, and effect-scope audio teardown (`extensions/moodist/extension.ts`, `extensions/moodist/view.ts`, `extensions/moodist/widgets/moodist.ts`). | Category and volumes live in canonical `ctx.data`; playback remains ephemeral and old keys are ignored. | No Rust backend; vendored sound assets and licensing remain untouched. | Closed: P L D | Ported; widget-local audio stays first-party and is released on scope disposal. |
| notes | Contract component, menu, icon, local action, duplicate (`extensions/notes/extension.ts`, `extensions/notes/widgets/`). | Markdown document and toolbar preference live in canonical `ctx.data`; palette body search is supplied by the extension. | None found; TipTap is widget-local. | Closed: P A M L D | Ported in Phase 2; rich-text view remains async to keep TipTap off startup. |
| now-playing | Contract component and icon (`extensions/now-playing/extension.ts`, `extensions/now-playing/widgets/`). | No durable state found; current media snapshot is intentionally ephemeral. | Rust media-session commands through the reviewed `ctx.nowPlaying` capability (`src-tauri/src/extensions/now_playing/mod.rs`). | Closed: P B R | Ported; snapshot polling and fixed transport controls are contract-owned. |
| one-purpose-llm | Component, icon, menu, local action, four text-action callbacks, duplicate/dispose (extensions/one-purpose-llm/index.ts:23-59). | Shared custom/hidden templates and per-instance prompt/settings reset (extensions/one-purpose-llm/onePurposeLlmLogic.ts:127-128,282-325,424-494). | Three credential types plus streamed/cancellable Rust chat (extensions/one-purpose-llm/OnePurposeLlmWidget.vue:12-13,208-228; extensions/README.md:45-49,98-112). | P A M T L B S D | Needs the most contract work; port last. |
| pomodoro | Contract component, schema settings, icon, local action, duplicate/dispose (`extensions/pomodoro/widgets/pomodoro.ts`). | Phase, completed sessions, active deadline, and settings live in canonical config/data; pre-contract keys are ignored. | None found. | Closed: P C A L D | Ported in Phase 2. |
| redacted | Ported contract widget with schema config and non-default surface metadata (`extensions/redacted/extension.ts`, `extensions/redacted/widgets/redacted.ts`). | Color/radius live in canonical host config; card size remains layout-owned (`core/app/extension-host/cockpit.ts`). Pre-contract keys are ignored. | None found. | Closed: P C L D | Ported in Phase 2. |
| snake | Contract component, icon, duplicate data transform, and effect-scope game loop (`extensions/snake/extension.ts`, `extensions/snake/view.ts`, `extensions/snake/widgets/snake.ts`). | Board size is canonical instance `ctx.data`; high score is extension-scoped `sharedData`; old localStorage keys are ignored. | The win easter egg uses the reviewed HTTPS-only `ctx.openExternal` capability. | Closed: P L B D | Ported; keyboard ownership remains widget-local and playground sizing remains manifest metadata. |
| snippets | Contract component, icon, dynamic action params, shared library, local action (`extensions/snippets/extension.ts`, `extensions/snippets/view.ts`, `extensions/snippets/widgets/snippets.ts`). | The shared snippet library is canonical extension-scoped `sharedData`; blank editor rows remain transient until normalized for persistence. | Expansion uses the reviewed `ctx.clipboard` capability; no Rust backend is needed. | Closed: P A B D | Ported; placeholder chips stay extension-owned. |
| stocks | Component, icon, settings, local action, duplicate/dispose (extensions/stocks/index.ts:11-30). | Per-instance ticker watchlist resets (extensions/stocks/stocksLogic.ts:57,92-109). | Yahoo endpoint broker through extension_http_call (extensions/stocks/stocksLogic.ts:1-8,331-339; extensions/README.md:55-63). | P C A L B D | Needs HTTP/provider adapter and local action support. |
| stopwatch | Component, icon, duplicate/suspend/dispose (extensions/stopwatch/index.ts:11-20). | No localStorage; each instance starts at zero, so only ephemeral elapsed state exists (extensions/stopwatch/useStopwatchState.ts:119-142). | None found. | P L | Needs visibility semantics; otherwise cheap after Clock. |
| system-info | Contract component, icon, schema configuration, and 5-second snapshot refresh (`extensions/system-info/extension.ts`, `extensions/system-info/widgets/`). | Presentation settings are canonical Contract configuration; old per-instance settings are intentionally ignored. | Rust CPU/memory/battery snapshot through the reviewed `ctx.systemInfo` capability (`src-tauri/src/extensions/system_info/mod.rs`). | Closed: P C B R D | Ported; configuration, polling, and teardown are contract-owned. |
| time-tracker | Contract component, schema config, icon, duplicate (`extensions/time-tracker/extension.ts`, `extensions/time-tracker/widgets/`). | Projects, tasks, sessions, selection and settings live in canonical config/data; active sessions are dropped on duplicate while closed sessions remain. | None found. | Closed: P C L D | Ported in Phase 2; the ledger and generic palette search are covered by contract assertions. |
| timer | Contract component, icon, local action, inline view, row instance actions, duplicate/dispose (`extensions/timer/extension.ts`, `extensions/timer/widgets/`). | Last chosen duration and a normalized runtime snapshot live in canonical `ctx.data`; duplicate resets running/ringing state. Pre-contract keys are ignored. | None found. | Closed: P A M L D | Ported in Phase 3; palette-row and local-action surfaces are contract-owned. |
| todo | Contract component, menu, icon, local action, inline detail, duplicate/dispose (`extensions/todo/extension.ts`, `extensions/todo/widgets/`). | Nested todo tree lives in canonical `ctx.data`; duplicate cloning preserves the whole tree. Pre-contract keys are ignored. | None found. | Closed: P A M L D | Ported in Phase 2; `kavibay.todo/list` fixture remains for assertions/dev board. |
| weather | Contract component, schema config, icon, declared HTTP capability, local action, duplicate/dispose (`extensions/weather/extension.ts`, `extensions/weather/widgets/`). | Location lives in schema config and carousel state in canonical `ctx.data`; pre-contract weather keys are ignored. | Open-Meteo geocoding and forecast through `ctx.http` with exact host declarations; no direct Tauri command. | Closed: P C A L B D | Ported in Phase 3; host-owned HTTP and manifest/handler action pairing are covered by contract assertions. |
| widget-wizard | Contract component, icon, and `ctx.wizard` capability (`extensions/widget-wizard/extension.ts`, `extensions/widget-wizard/widgets/`, `extensions/widget-wizard/view.ts`). | Conversations remain backend-owned files under appData/wizard; only the active conversation id is instance data, avoiding screenshot-sized quota usage. | The reviewed capability maps model, conversation, draft, scan, enable, and package operations to fixed host/Rust surfaces. Preview and permission UI are host-provided adapters. | Closed: H B | Ported in Phase 4; no direct `core` or Tauri import remains in the extension. |

### What movable now means

No current folder is movable now with full parity because the adapter drops
icons/UI metadata and static select options and generic config ownership are not
complete. “Movable now” in the order means “first after the prerequisite”; it
does not mean copying the old SFC into the contract. Clock is the first candidate.

## 3. Persistence ledger

The contract has two different persisted namespaces. Instance configuration is
owned by the cockpit under kavibay:widget-config:<instance>
(core/app/extension-host/cockpit.ts:152-198). ctx.data is per-instance
widget data under kavibay:widget-data:<instance>\0<key> and has quota/eviction
(core/app/extension-host/data-store.ts:3-16,33-42,63-103). The contract SDK
distinguishes config, data, and ephemeral UI state
(sdk/extension/contract/sdk.ts:227-243).

Use the target deliberately:

- Preference-like stores become config only when schema-driven. Clock's locale,
  timezone, date style, hour mode, and seconds must not be hidden in ctx.data.
- Todo, Notes, Time Tracker, Calculator history, Alarm rows, Image state, and
  similar user records belong in ctx.data unless they are host-owned assets.
  Forgetting these is content loss, not merely a reset.
- Shared stores in Emoji Picker, Snippets, and Single Purpose LLM do not fit the
  current per-instance ctx.data scope. Keep a host-owned shared store or add an
  explicit extension-scoped capability; do not silently make each instance private.
- Clipboard history, Focus Tracker rules, Wizard conversations, and imported
  Image files are backend-owned. They need a provider/host adapter and a call
  ledger, not a blind localStorage copy.

There is deliberately no legacy import or fallback. A Contract widget starts
with its schema defaults and canonical `ctx.data`; pre-contract `kavibay:` keys
are ignored. Duplication clones only the current Contract stores, and disposal
evicts only those stores through the generic host boundary.

## 4. Recommended implementation order

### Phase 0 — small host prerequisites

1. Add static select options to the contract and generated settings form.
2. Add generic config duplicate-copy and remove-eviction.
3. Decide catalog parity for icons, keywords/categories, default offset/size, and
   UI flags. Keep the contract framework-free; the view stays in widgetViews.
4. Decide explicitly whether old palette actions and row summaries/actions belong
   in the contract. The cockpit intentionally maps neither old actions nor
   contract commands into the old action shape
   (core/app/extension-host/cockpit.ts:301-305).

### Phase 1 — Clock, Stopwatch, Calculator

Clock exercises the lowest-risk new mechanism: local static settings.
Implement the timer with onScopeDispose, move its view model into
widgetViews, and map kavibay.clock/clock to the old catalog id through REPLACES
(the mechanism is core/app/extension-host/cockpit.ts:235-249). Remove only
the fixture's cockpit registration; do not change the fixture.

Stopwatch then checks cleanup and resume when the card leaves/re-enters the
mounted set. Calculator is the cheap content case: migrate bounded history and
draft to ctx.data, then verify duplicate/remove.

### Phase 2 — Redacted, Pomodoro, Todo, Notes, Time Tracker

Redacted proves schema settings and non-default presentation. Pomodoro adds an
active persisted timer and a local palette action. Todo is the first important
acceptance case: nested user content, duplicate/remove, menu, detail row, and
palette action meet in one widget. Notes follows with a rich-text document;
Time Tracker follows with a larger structured ledger. Todo's fixture remains
only a control case (core/app/extension-host/fixtures/todo.ts:17-49).

### Phase 3 — Timer, Emoji Picker, Weather, Stocks

Timer and Emoji Picker test row actions, shared-vs-instance state, and action
arguments. They are now closed; the generic `sharedData` scope covers
intentionally extension-wide state. Weather is the first public HTTP port; turn its declared endpoint
into contract http or a provider, then port settings and action. Stocks reuses
the broker seam but adds Yahoo endpoint quirks and a watchlist.

### Phase 4 — System Info, Now Playing, Calendar, GitHub Actions

System Info is the smallest backend snapshot replacement; Now Playing follows
with a 1-second media poll. Calendar is now closed: credential connection,
provider queries/actions, schema settings, menu refresh, and reviewed external
links are all host-mediated. GitHub Actions adds a PAT, adaptive polling, repo
settings, and browser launch. Provider credentials stay host-side; the provider
context exposes only connection status and the broker attaches authentication
(core/app/extension-host/runtime.ts:111-120).

### Phase 5 — Snake, Snippets, and OS integrations

Alarm and Moodist are closed: Alarm uses a reviewed fixed notification
capability and canonical instance data; Moodist keeps its audio elements inside
the first-party widget and persists only the normalized mix. Snake and Snippets
are now closed as well: their keyboard/playground, HTTPS launch, shared storage,
clipboard, and dynamic-chip boundaries are explicit. Focus Tracker, Clipboard,
Color Picker, Image, and Launcher Buttons are now closed as well: their
OS/filesystem boundaries are fixed host capabilities rather than
direct widget commands. Image and Launcher Buttons persist through `ctx.data`,
while Clipboard and Color Picker keep their backend/session semantics.

### Phase 6 — Single Purpose LLM; leave host control-plane surfaces put

Single Purpose LLM was last among the larger movable widgets because it combines
optional credentials, streaming/cancellation, shared template data, per-instance
state, menu UI, palette actions, and selection text actions. Confetti, Kill Port,
and Gallery are now ported; Widget Wizard is now ported behind its reviewed
authoring capability.

## Verification boundary

This phase changes the SDK capability contract, the host transport, and four
first-party extensions. Run `npm run verify` and `npm run build`; Rust source
was not changed, so `npm run verify:rust` is not required for this phase. The
manual smoke check should cover palette add, image import, color pick, and one
launcher launch when the Tauri app is available.

