# Write your first widget

From an empty folder to a widget in the palette, in four steps. You will build
**Hello**: it greets a name you can change in its settings, counts how often
you pressed its button, and offers a palette action that renames it.

Every first-party widget is a *contract* extension — the format described in
[extension-host.md](extension-host.md), typed in `sdk/extension/contract/sdk.ts`.
`extensions/calculator/` is the smallest real one; keep it open beside this page.

| Tier | When | Backend |
|------|------|---------|
| **S** | Client-only, or a keyless public API | none, or a host list in Rust |
| **M** | Per-instance settings, remembered data, palette actions | same as S |
| **L** | An account, streaming, an OS API | a provider, or a reviewed host capability |

Steps 1–3 are S and M. [Data from outside](#data-from-outside) covers the keyless
API (still S) and L. Most widgets never need L.

## The shape

```
extensions/hello/
  manifest.json        what it is: identity + how the catalog lists it
  extension.ts         assembly: reads identity from the manifest, lists contributions
  view.ts              the Vue half: widget name → component + icon
  widgets/
    hello.ts           the definition: config, actions, a headless setup()
    HelloView.vue      how it draws
    hello.assert.ts    a test for the definition (step 4)
```

Four rules, each enforced by `scripts/extensionManifests.assert.mjs` (part of
`pnpm run verify`), because breaking any of them makes the widget silently
absent rather than broken:

- The folder name **must** equal `manifest.name`.
- The manifest says `"format": "contract"` — nothing else loads.
- `extension.ts` and `view.ts` are read by their **default export**. A named
  export alone typechecks and then fails at module load in the browser.
- There is no registry file to edit. `core/app/extension-host/bundledExtensions.ts`
  finds the folder through a Vite glob.

The glob runs when Vite starts, so a **new** folder needs a restart of
`pnpm run tauri dev`. Edits to an existing one hot-reload.

Why the definition and the view are separate files: a definition imports no
`.vue` file, so `tsx` can load it — that is what lets the assert suite and the
repo guards run real definitions in Node. The view is the only part that needs
the Vue compiler.

## Step 1 — a static widget

`manifest.json`:

```json
{
  "format": "contract",
  "name": "hello",
  "version": "1.0.0",
  "displayName": "Hello",
  "description": "Says hello.",
  "author": "you",
  "engines": { "kavibay": "^0.1" },
  "widgets": {
    "hello": {
      "keywords": ["hello", "demo"],
      "categories": ["tools"],
      "ui": {
        "defaultOffset": { "x": 0, "y": 0 },
        "defaultSize": { "w": 220, "h": 110 }
      }
    }
  }
}
```

The top block is identity — the same fields a widget package states. Each key
under `widgets` is one widget, named like its definition below. `keywords` are
read **per widget**: a top-level `keywords` list reaches nothing for a widget
and fails the guard. `ui.defaultSize` is the card size in CSS pixels; the other
`ui` fields are in [extensions.md → Manifest layout and sizing](extensions.md#manifest-layout-and-sizing).

`extension.ts`:

```ts
import { defineExtension } from "@sdk/contract/sdk";
import manifest from "./manifest.json";
import { helloWidget } from "./widgets/hello";

export const helloExtension = defineExtension({
  name: manifest.name,
  version: manifest.version,
  displayName: manifest.displayName,
  description: manifest.description,
  author: manifest.author,
  engines: manifest.engines,
  contributes: {
    widgets: [helloWidget],
  },
});

export default helloExtension;
```

Assembly only: identity is read back from the manifest so the two cannot drift,
and everything the extension contributes fits on one screen.

`widgets/hello.ts`:

```ts
import { defineWidget } from "@sdk/contract/sdk";

export interface HelloModel {
  greeting: string;
}

export const helloWidget = defineWidget({
  name: "hello",
  displayName: "Hello",
  description: "Says hello.",
  defaultSize: { w: 2, h: 1 },
  component: {
    setup(): HelloModel {
      return { greeting: "Hello, world" };
    },
  },
});
```

`setup(ctx)` is headless: it builds a *view model* and returns it. It runs
inside an effect scope the host owns, so `onScopeDispose` is the whole teardown
contract — there is no mount or unmount hook. The definition's `defaultSize` is
in grid units and only used when the manifest gives no pixel size.

`widgets/HelloView.vue`:

```vue
<script setup lang="ts">
import type { HelloModel } from "./hello";

defineProps<{ model: HelloModel }>();
</script>

<template>
  <div class="hello">{{ model.greeting }}</div>
</template>

<style scoped>
.hello {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 16px;
  color: rgba(var(--fg-rgb), 0.92);
}
</style>
```

The view receives exactly one prop, `model` — whatever `setup` returned. Use the
app's CSS variables (`--fg-rgb`) rather than fixed colours so it follows the
light/dark theme, and **do not paint your own background**: the card the host
draws already is one. The rest of the house style is in [DESIGN.md](DESIGN.md).

`view.ts`:

```ts
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { SparklesIcon } from "@sdk/icons";

const HelloView = defineAsyncComponent(() => import("./widgets/HelloView.vue"));

const views: ExtensionViews = {
  hello: { view: HelloView, icon: SparklesIcon },
};

export default views;
```

Keyed by the widget `name`. The view is imported with `defineAsyncComponent`
because `view.ts` itself is loaded at start-up — a static import would put your
component in the launch bundle of every window, even for people who never add
the widget. [extensions.md → Lazy views](extensions.md#lazy-views) has the
details and the one exception (`hugHeight` widgets).

Restart `pnpm run tauri dev`, double-tap `Ctrl`, type `hello`, press `Enter`.
The card opens on the desk.

## Step 2 — a setting and remembered data

A widget has three kinds of state, and the contract keeps them apart:

| Kind | Lives in | Example here |
|---|---|---|
| **config** — what the user set | `configuration` schema → `ctx.config` | the name to greet |
| **data** — what the widget remembers | `ctx.data` (per instance, persisted) | how often you waved |
| **ui state** — gone on remount | a `ref` in `setup` | — |

Replace `widgets/hello.ts`:

```ts
import { ref, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";

export interface HelloConfig {
  name?: string;
}

export interface HelloModel {
  greeting: string;
  waves: Ref<number>;
  wave(): void;
}

export const HELLO_WAVES_KEY = "waves";

/** Blank or junk falls back to "world". */
export function normalizeName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  return name || "world";
}

/** Anything that is not a non-negative integer counts as never waved. */
export function normalizeWaves(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

export const helloWidget = defineWidget<HelloConfig>({
  name: "hello",
  displayName: "Hello",
  description: "Says hello.",
  defaultSize: { w: 2, h: 1 },
  configuration: {
    name: { type: "string", label: "Name", default: "world" },
  },
  duplicateData: true,
  component: {
    setup(ctx: WidgetContext<HelloConfig>): HelloModel {
      const waves = ref(0);
      void ctx.data.get<unknown>(HELLO_WAVES_KEY).then((raw) => {
        waves.value = normalizeWaves(raw);
      });

      return {
        greeting: `Hello, ${normalizeName(ctx.config.name)}`,
        waves,
        wave() {
          waves.value += 1;
          void ctx.data.set(HELLO_WAVES_KEY, waves.value);
        },
      };
    },
  },
});
```

And the template of `widgets/HelloView.vue`, plus a style for the button:

```vue
<template>
  <div class="hello">
    <p class="hello-greeting">{{ model.greeting }}</p>
    <button type="button" class="hello-wave" @click="model.wave()">
      Wave ({{ model.waves.value }})
    </button>
  </div>
</template>

<style scoped>
.hello {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
}

.hello-greeting {
  margin: 0;
  font-size: 16px;
  color: rgba(var(--fg-rgb), 0.92);
}

.hello-wave {
  font: inherit;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.72);
  background: rgba(var(--fg-rgb), 0.08);
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
</style>
```

What the host now does for you, with no further code:

- **Settings.** The gear on the card opens a form built from `configuration`
  (`string`, `number`, `boolean`, `select`). You write no settings component.
- **Config is read once.** `ctx.config` is a plain value, and saving the form
  remounts the widget. That is why `greeting` is a string, not a `ref`.
- **Data is per instance.** Two Hello cards count separately. Values must be
  JSON, at most 256 KiB each.
- **Duplicate and delete.** Duplicating copies the configuration, and — because
  of `duplicateData: true` — the stored data. Deleting clears both. There is no
  `onDuplicate` or `onDispose` to write.

`model.waves` needs `.value` in the template: the view gets the model as a prop
object, and Vue only unwraps refs at the top level of a template's own bindings.

**No `<form>` in a view.** Widgets run under `sandbox="allow-scripts"`, where the
`submit` event never fires. Use `@click` on the button and `@keyup.enter` on the
field. `scripts/extensionHostSandboxGuard.assert.mjs` catches it.

## Step 3 — a palette action

An action lets the palette act on your widget without opening it: type `hello`,
press `Tab`, type a name, press `Enter`. It has two halves, paired by id.

The declaration goes in `manifest.json`, under the widget entry:

```json
"hello": {
  "keywords": ["hello", "demo"],
  "categories": ["tools"],
  "ui": {
    "defaultOffset": { "x": 0, "y": 0 },
    "defaultSize": { "w": 220, "h": 110 }
  },
  "actions": [
    {
      "id": "set-name",
      "title": "Set Name",
      "subtitle": "Change who Hello greets",
      "keywords": ["greet", "rename"],
      "params": [
        { "name": "name", "type": "text", "required": true, "placeholder": "Name" }
      ]
    }
  ]
}
```

The handler goes in the definition, beside `configuration`:

```ts
  duplicateData: true,
  actions: {
    "set-name": ({ args, setConfig }) => {
      const name = args.name?.trim();
      if (!name) throw new Error("name is empty"); // the palette stays open
      setConfig({ name });
    },
  },
  component: {
```

A declaration without a handler, or a handler without a declaration, is a hard
error — `scripts/extensionActions.assert.ts` runs the real pairing over every
extension. `setConfig` persists the change and remounts the widget, so the
handler works even when the card has not mounted yet. Throwing keeps the palette
open with the query intact. Parameters, standalone actions and
`needsInstance: false` are in [extensions.md → Palette actions](extensions.md#palette-actions).

## Step 4 — a test

The definition is plain TypeScript, so its logic — and `setup` itself — can be
tested without a browser. Plain asserts, no test runner. `widgets/hello.assert.ts`:

```ts
// Run: npx tsx extensions/hello/widgets/hello.assert.ts
import { effectScope } from "vue";
import type { WidgetContext, WidgetDataStore } from "@sdk/contract/sdk";
import { HELLO_WAVES_KEY, helloWidget, normalizeName, normalizeWaves, type HelloConfig, type HelloModel } from "./hello";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(normalizeName(undefined) === "world", "missing name falls back to world");
assert(normalizeName("  Alex ") === "Alex", "name is trimmed");
assert(normalizeName("   ") === "world", "blank name falls back to world");
assert(normalizeWaves(3) === 3, "a count survives");
assert(normalizeWaves(-1) === 0 && normalizeWaves("3") === 0, "junk counts as zero");

// setup() is plain code, so it runs here without a DOM — with an in-memory store.
const cells = new Map<string, unknown>([[HELLO_WAVES_KEY, 2]]);
const data: WidgetDataStore = {
  get: async <T>(key: string) => cells.get(key) as T | undefined,
  set: async (key, value) => void cells.set(key, value),
  delete: async (key) => void cells.delete(key),
};
const ctx: WidgetContext<HelloConfig> = { instanceId: "hello-assert", config: { name: "Alex" }, data };

const scope = effectScope();
const model = scope.run(() => helloWidget.component.setup(ctx)) as HelloModel;
await Promise.resolve(); // let the stored count arrive
assert(model.greeting === "Hello, Alex", "greeting reads the configured name");
assert(model.waves.value === 2, "the stored count is restored");
model.wave();
assert(cells.get(HELLO_WAVES_KEY) === 3, "a wave is persisted");
scope.stop();

console.log("hello.assert.ts: ok");
```

Use the local `assert` function as above rather than `node:assert`: the app's
typecheck has no Node types, and `pnpm run verify` typechecks every assert file.
`scripts/runAsserts.mjs` finds the file by its name — nothing to register.

## Verifying

```bash
npx tsx extensions/hello/widgets/hello.assert.ts
```

```bash
pnpm run verify
```

Then the part no test covers: add the widget from the palette, press Wave,
change the name in its settings, run **Set Name** from the palette, duplicate
the card (the count comes along), delete it.

## Data from outside

### A keyless public API

Declare the hosts in the definition and call them through `ctx.http`:

```ts
capabilities: {
  http: { hosts: ["api.example.com"], methods: ["GET"] },
},
```

```ts
const answer = await ctx.http!.get<{ value: string }>("https://api.example.com/v1/thing", { q: "hello" });
```

The request leaves through Rust, not the webview — so **no `connect-src` entry**
in the CSP — and Rust checks the host against a list compiled into the binary.
That list is the one piece of Rust you write: a directory
`src-tauri/src/extensions/hello/` with a `mod.rs` like
`src-tauri/src/extensions/calculator/mod.rs`:

```rust
use super::ExtensionRust;
use crate::extension_providers::CapabilityHosts;

pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "hello",
    capabilities: &[CAPABILITY],
};

const CAPABILITY: CapabilityHosts = CapabilityHosts {
    extension_id: "kavibay.hello",
    hosts: &["api.example.com"],
};
```

Then `pub mod hello;` and `&hello::EXTENSION` in `ALL`, both in
`src-tauri/src/extensions/mod.rs`. Its tests fail if a directory is missing from
`ALL` or names a folder that does not exist. Run `pnpm run verify:rust`.

The allowlist is not a security boundary — a widget allowed to reach a host can
encode anything it has read into a query string. Review is the control. Working
examples: `extensions/calculator/` (exchange rates), `extensions/stocks/`,
`extensions/weather/`.

### An account or an API key

**Anything that needs a credential is a provider**, never a `ctx.http` call with
a key in the configuration. The credential type goes in
`src-tauri/src/credentials/registry.rs` — that alone gives you the settings form,
the OAuth flows and the encrypted store. The provider is a `provider.ts` beside
`extension.ts`; the widget names it in `requires.providers` and reads it through
`ctx.providers[id]` (`useProviderQuery` in `@sdk/contract/sdk-vue`). It never
sees a token. After adding or changing a `provider.ts`, run
`pnpm run build:provider-doc` to regenerate the Rust allowlist.

Start from `extensions/tado/` (one provider, one widget) and read
[extension-host.md → The provider schema](extension-host.md#the-provider-schema)
and [extensions.md → Credentials](extensions.md#credentials-api-keys-oauth-accounts).

### Streaming or an OS API

A widget reaches the OS only through a reviewed host capability —
`ctx.systemInfo`, `ctx.nowPlaying`, `ctx.clipboard` and the others listed in
`CapabilityDeclaration` in `sdk/extension/contract/sdk.ts`. Adding one is an SDK
change, made when a bundled widget needs it and not before. Read
[extension-host.md → Writing a widget](extension-host.md#writing-a-widget) first,
and copy the closest neighbour (`extensions/system-info/`,
`extensions/now-playing/`).

## Copy from a neighbour

| Want | Look at |
|---|---|
| The smallest complete widget | `extensions/calculator/` |
| Settings from a `configuration` schema | `extensions/clock/` |
| Palette actions + a declared HTTP host | `extensions/stocks/` |
| Credentials + provider data | `extensions/tado/`, `extensions/github/` |
| Keyboard-heavy UI | `extensions/snake/` |

The full catalogue, with tier and notes for each: [../extensions/README.md](../extensions/README.md).

## No build step at all?

A **runtime package** is plain HTML/CSS/JS dropped into a folder — no Vue, no
Rust, no recompile, and it runs sandboxed. That is the right shape for something
you want to share with someone who is not going to clone this repo:
[runtime-packages.md](runtime-packages.md).
