# Kavibay Widget Reference

Load this when implementing an extension. Keep `SKILL.md` for the workflow.

## File checklist

Minimum:

```
extensions/<id>/
  manifest.json
  index.ts
  <Name>Widget.vue
```

Add as needed:

| File | When |
|------|------|
| `intro.mp4` | Optional — 640×480 (or any 4:3) muted preview for the Widget Gallery desk widget |
| `icon.svg` | Catalog icon for Widgets menu + palette type rows (`manifest.icon`) |
| `<name>Logic.ts` | Pure types, normalize, load/save, helpers (no Vue) |
| `use<Name>State.ts` / `use<Name>Settings.ts` | Per-instance cache via `createInstanceStore` (debounce only if typing-heavy) |
| `<Name>Settings.vue` | Gear-popover settings (`settingsComponent`) |
| `<Name>Menu.vue` | External / overflow menu (`menuComponent`) |
| Extra `.vue` | Only if the reference widgets do the same |

Do **not** add the extension to a barrel file. `loadExtensions.ts` globs `/extensions/*/manifest.json` and `index.ts`.

## `manifest.json`

Required fields: `id`, `name`, `description`, `version`, `author`, `keywords`, `categories`, `ui`, `commands`, `permissions`.

```json
{
  "id": "example",
  "name": "Example",
  "description": "One-line catalog blurb.",
  "version": "1.0.0",
  "author": "kavibay",
  "keywords": ["example", "beispiel"],
  "categories": ["tools"],
  "icon": "icon.svg",
  "ui": {
    "defaultOffset": { "x": 0, "y": 0 },
    "defaultSize": { "w": 240, "h": 200 },
    "allowDuplicate": true,
    "flush": false,
    "compact": false,
    "defaultHideTitle": false,
    "defaultScale": 1,
    "grabCursor": true,
    "fullDrag": false
  },
  "commands": [],
  "credentials": [],
  "permissions": []
}
```

Notes:

- `id` === folder name
- `defaultSize: { w, h }` — required; CSS px; host sets instance size on Add. **First guess only** — once a widget of this type has been resized, the host reuses that size for the next one (`core/app/host/typeSizeMemory.ts`)
- `icon` — package-relative `icon.svg` (or `.png`) for Widgets menu / palette type rows; missing → generic mark
- Optional `intro.mp4` in the extension folder → Widget Gallery tile (muted video preview)
- `hugHeight: true` → only `defaultSize.w` on Add; height follows content
- `defaultHideTitle: true` → card opens without its title bar (menu can restore it)
- `defaultScale` — content zoom on Add, the factor Ctrl+mousewheel writes; `1` = unzoomed, clamped to `0.5`…`3`
- Declare Tauri command names in `commands` when the extension invokes them (enforcement later)
- `credentials: [{ "type": "githubPat", "required": true }]` when the widget needs an account — type ids come from `src-tauri/src/credentials/registry.rs`
- `grabCursor: false` for text-heavy widgets (e.g. notes)
- Categories used elsewhere: `productivity`, `tools`, etc. — match neighbors

## `index.ts`

```ts
import type { ExtensionModule } from "@sdk/types";
import ExampleWidget from "./ExampleWidget.vue";

const extension: ExtensionModule = {
  component: ExampleWidget,
  // settingsComponent, menuComponent,
  // backendCommand, refreshInterval,
  // onCreate, onDuplicate, onSuspend, onResume, onDispose,
};

export default extension;
```

Lifecycle:

| Hook | Typical use |
|------|-------------|
| `onCreate` | Init instance cache |
| `onDuplicate` | Seed new id from source (copy settings; often **not** transient history) |
| `onDispose` | Dispose reactive cache + clear storage for that instance |
| `onSuspend` / `onResume` | Pause/resume timers, polling |

Host stays generic — no `typeId` switches for new widgets.

## Persistence patterns

**New extensions — canonical key:**

```ts
import { instanceStorageKey } from "@sdk/instanceStorageKey";
// → kavibay:<extId>:<instanceId>
instanceStorageKey("example", instanceId);
```

Leave legacy keys (`kavibay:notes-widget:…`, `kavibay:foo-v1`, etc.) unchanged.

**Per-instance settings/state** — use `createInstanceStore` (see `clock` / `weather`):

```ts
import { createInstanceStore } from "@sdk/createInstanceStore";

const store = createInstanceStore<ExampleSettings>({
  load: loadExampleSettings,
  save: saveExampleSettings,
  normalize: normalizeExampleSettings,
});

export function useExampleSettings(instanceId: string) {
  const { state: settings, update } = store.use(instanceId);
  return { settings, update };
}

export const disposeExampleSettings = store.dispose;
export const seedExampleSettingsFrom = store.seedFrom;
```

- Pure `load` / `save` / `normalize` / `clear` stay in `*Logic.ts`
- Debounce writes (~300ms) only when typing-heavy (e.g. notes) — wrap `update` if needed
- Inject `widgetInstanceId` in widget/settings components (string); throw if missing

## Backend widgets

```ts
const extension: ExtensionModule = {
  component: SystemInfoWidget,
  backendCommand: "widget_system_info",
  refreshInterval: 5000,
};
```

**When to use `useWidgetData`:** only for a global `backendCommand` with **no args** (`system-info`, `now-playing`).

**When not to:** instance-bound invokes (zone, repo, stream) — poll in the extension and use `onSuspend` / `onResume` (`tado`, `github-actions`, `ask-llm`).

Put new Rust under `src-tauri/src/…`, register commands in `lib.rs`, declare names in manifest `commands`.

## Network data: declare first, Rust only if you must

| Need | Do this |
|------|---------|
| One or two plain GET/POST calls, parsing in TS | `extensions/<id>/api.json` + `extension_http_call` (`weather`, `stocks`) |
| Provider needs a fixed User-Agent, or has a backup host | Same — `userAgent` and `fallbackUrls` are declaration fields (`stocks`) |
| Call needs an account | Same — set `credential` on the endpoint; the host injects it |
| Streaming / SSE, pagination loops, chained calls, nested JSON bodies, shared cache or a daily quota | Rust module (`ask-llm`, `calendar`, `tado`, `github-actions`) |

A declared endpoint (`extensions/weather/api.json`):

```json
{
  "schemaVersion": 1,
  "endpoints": [
    {
      "id": "forecast",
      "description": "Reads the current temperature for a location from Open-Meteo.",
      "method": "GET",
      "url": "https://api.open-meteo.com/v1/forecast",
      "query": {
        "latitude": { "type": "number", "required": true },
        "longitude": { "type": "number", "required": true },
        "current": { "type": "const", "value": "temperature_2m" }
      },
      "cache": { "ttlSeconds": 600 },
      "rate": { "minIntervalSeconds": 60 }
    }
  ]
}
```

Register it in `src-tauri/src/runtime_extensions/first_party.rs` (`include_str!`,
one line), then call it:

```ts
const res = await invoke<{ ok: boolean; data: unknown; code: string | null }>(
  "extension_http_call",
  { extId: "weather", endpointId: "forecast", args: { latitude, longitude } },
);
if (!res.ok) return showError(res.code);
```

The host owns the url, escapes and encodes every argument, refuses redirects and
private addresses, caps size and time, and enforces the interval and daily
budget. **Do not add a `connect-src` entry to the main-window CSP** — a declared
endpoint does not need one, and new CSP entries need maintainer review.

Full format: [docs/runtime-packages.md](../../../docs/runtime-packages.md).

## Credentials (API keys, OAuth accounts)

Never store, decrypt or pass a secret in the widget. Add the type once:

```rust
// src-tauri/src/credentials/registry.rs
const MY_API: CredentialTypeDef = CredentialTypeDef {
    id: "myApiKey",
    display_name: "My API",
    description: "API key with read access.",
    docs_url: Some("https://example.com/tokens"),
    fields: &[FieldDef {
        key: "token",
        label: "API Key",
        kind: FieldKind::Password,
        required: true,
        placeholder: None,
        help: None,
        env: None,
    }],
    auth: AuthKind::Static,          // or OAuth2AuthCode / OAuth2DeviceCode
    inject: Injection::Bearer { value: "{{token}}" },
    test: None,
};
```

Add it to `ALL`, then **Settings → Integrations → Credentials** renders the form,
the connect flow and the test button. Nothing else to build.

Resolve it in Rust:

```rust
let credential = credentials::resolve_for_type(&app, "myApiKey").await?;
let request = credential.apply(client.get(url))?;   // declared injection
```

`resolve_for_type` refreshes expired OAuth tokens on the way out. It returns
`not_configured` (render a setup state), `needs_reauth` (prompt to reconnect), or
a real failure.

Widget-side, only these:

| Command | Use |
|---------|-----|
| `credentials_configured` | `typeId` → bool, for the "set this up" gate |
| `credentials_type_status` | state, account label, missing fields, pending flag |
| `credentials_connect` / `credentials_cancel_connect` | start/stop a sign-in from the widget |
## UI conventions

- Live inside existing `WidgetCard` chrome (title, settings, menu, pin, move)
- Compact dark glass; reuse rgba white overlays like Notes / Clipboard / Clock
- Width roughly 240–320px unless the widget needs more (notes/image resize patterns)
- Settings: small form controls; live-apply when other widgets do

### Dropdowns — never `<select>`

A native `<select>` popup is drawn by Windows, not by the app: light background,
square corners, its own font and row height. It looks pasted on over the dark
card. Build the menu instead — a trigger showing the current value and a floating
panel of rows, check on the selected one.

**Working example to clone: `extensions/widget-wizard/WizardModelPicker.vue`** —
outside-click, Escape, arrow keys, two-line rows. Styling follows the host's `⋯`
menu (`.widget-context-menu` / `.widget-menu-item` in
`core/app/host/WidgetCard.vue`); copy those values rather than inventing new
ones. The skeleton below is the minimum when the picker is simpler than that:

```vue
<script setup lang="ts">
import { ref } from "vue";

const open = ref(false);
const value = ref("grammar");
const options = [
  { id: "grammar", label: "Correct grammar" },
  { id: "translate", label: "Translate" },
];

/** Pick an option and close the panel. */
function choose(id: string) {
  value.value = id;
  open.value = false;
}
</script>

<template>
  <!-- Close on outside click / Escape: v-on-click-outside or a document listener
       while open, exactly like WidgetCard does for its menu. -->
  <div class="dropdown">
    <button
      type="button"
      class="dropdown-trigger"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span>{{ options.find((o) => o.id === value)?.label }}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
    </button>
    <div v-if="open" class="dropdown-panel" role="listbox">
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        class="dropdown-item"
        role="option"
        :aria-selected="option.id === value"
        @click="choose(option.id)"
      >
        <span class="dropdown-check">{{ option.id === value ? "✓" : "" }}</span>
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.dropdown {
  position: relative;
}
.dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  font: inherit;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.08);
  color: inherit;
  cursor: pointer;
}
.dropdown-trigger:hover {
  background: rgba(var(--fg-rgb), 0.12);
}
.dropdown-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  min-width: 100%;
  padding: 4px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: rgba(var(--surface-bg-rgb), 0.95);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
}
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  font: inherit;
  text-align: left;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.9);
  cursor: pointer;
}
.dropdown-item:hover {
  background: rgba(var(--fg-rgb), 0.1);
}
.dropdown-check {
  width: 12px;
}
</style>
```

Same rule in settings popovers and menu components. Long lists get
`max-height: 180px; overflow: auto` on the panel, not a taller widget.
For runtime packages the literal (non-variable) colours are in
[docs/DESIGN.md](../../../docs/DESIGN.md) — the iframe does not see `--fg-rgb`.

## Reference extensions

| Need | Clone |
|------|--------|
| Minimal client | `extensions/calculator/` |
| Settings + localStorage | `extensions/clock/`, `extensions/weather/` |
| Menu + rich state | `extensions/notes/` |
| Backend + refresh | `extensions/system-info/`, `extensions/now-playing/` |
| One API call, no Rust | `extensions/weather/` (+ `api.json`) |
| API needing a User-Agent / fallback host | `extensions/stocks/` (+ `api.json`) |
| Credentials + Rust API module | `extensions/tado/`, `extensions/github-actions/` |
| Streaming + chat | `extensions/ask-llm/` |
| Dropdown / option picker (never `<select>`) | `extensions/widget-wizard/WizardModelPicker.vue` |

## Thin plan template (M / L)

```markdown
# <Name> Implementation Plan

**Goal:** …
**Tier:** M | L

## Global Constraints
- Extension id `…`, name **…**, category `…`
- …

## File Structure
| File | Responsibility |
|------|----------------|
| `extensions/…` | … |

## Task 1: …
**Files:** …
**Interfaces:** (types / function signatures only)
**Verify:** …

## Manual UI
- [ ] …
```

## Decision list template (Tier S)

```markdown
Tier: S
id / name / category: …
Reference extension: …
Files to create: …
State: none | localStorage per instance | …
Settings / menu: no | yes (what fields)
Duplicate behavior: …
Out of scope: …
```
