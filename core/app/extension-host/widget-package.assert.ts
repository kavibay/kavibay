import exampleManifest from "@sdk/contract/example-package/manifest.json";
import { ExtensionRegistry } from "./registry";
import { tadoExtension } from "./fixtures/tado";
import { WidgetPackageError, requestedPermissions, widgetPackageManifest } from "./widgetPackage";

/**
 * Asserts for loading a widget package.
 * Run: npx tsx core/app/extension-host/widget-package.assert.ts
 *
 * This is where finding 14's rule lives: a package says what it wants, the user
 * says what it gets, and no code path reads the second from the first. Most of
 * what follows is that one sentence, checked from several directions — because
 * the failure mode is a package quietly running with permissions nobody
 * granted, and nothing on screen would say so.
 */

const TADO = "kavibay.tado/tado";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function refuses(fn: () => unknown, why: string) {
  try {
    fn();
  } catch (err) {
    assert(err instanceof WidgetPackageError, `${why}: expected a WidgetPackageError, got ${String(err)}`);
    return;
  }
  throw new Error(`${why}: it was accepted`);
}

/** A package asking for everything, which is what a generated one will do. */
const greedy = {
  name: "room-summary",
  version: "1.0.0",
  displayName: "Room summary",
  engines: { kavibay: "^0.1" },
  widget: {
    name: "tile",
    displayName: "Room summary",
    defaultSize: { w: 2, h: 2 },
    requires: { providers: [TADO] },
    configuration: {
      room: { type: "select", label: "Room", required: true, source: { provider: TADO, query: "rooms" } },
    },
  },
};

// --- what it asked for is readable, and separate from what it gets ---
{
  const asked = requestedPermissions(greedy);
  assert(asked.providers.join(",") === TADO, "the dialog can name the provider it wants");
}

// --- the file's own list is never what is granted ---
{
  // The user said yes to one query and no to the action.
  const manifest = widgetPackageManifest(greedy, { providers: [TADO] });
  const widget = manifest.contributes.widgets![0]!;

  assert(
    widget.requires?.providers.join(",") === TADO,
    `the widget addresses what was approved, got ${JSON.stringify(widget.requires)}`,
  );

  // The declared provider survives, and that is safe on its own: naming a
  // provider opens nothing, the permission lists do, and those came from the
  // user. A package with an empty grant can address Tado and call nothing.
  assert(widget.requires?.providers.join(",") === TADO, "the declared provider is kept");
}

// --- approving nothing means nothing, rather than everything ---
{
  /**
   * Since §27 there is no "approved the account but none of its queries" — the
   * account *is* the grant. So an empty approval only agrees with a package
   * that asks for nothing, and the widget it produces addresses nothing.
   */
  const manifest = widgetPackageManifest(
    {
      ...greedy,
      widget: { ...greedy.widget, requires: undefined, configuration: undefined },
    },
    { providers: [] },
  );
  const widget = manifest.contributes.widgets![0]!;
  assert(widget.requires === undefined, "an empty approval addresses nothing");
  // Which the host already enforces as deny: permissions fail closed.
}

// --- an approval about a different provider is refused, not reconciled ---
{
  refuses(
    () => widgetPackageManifest(greedy, { providers: ["kavibay.google-calendar/calendar"] }),
    "a grant for another provider",
  );
  refuses(
    () => widgetPackageManifest(greedy, { providers: [] }),
    "a grant naming no provider at all",
  );
}

/**
 * The one that is not obvious. A `select` field can draw its options from a
 * provider query, and the runtime runs that query on the widget's behalf —
 * correct for a reviewed widget, because the runtime is drawing its own form.
 * For a package it would be a way to make the host call a query on a provider
 * the person never approved, just by declaring a field.
 *
 * Since §27 only the *provider* is checked: which query no longer needs
 * approving, because approving an account approves reading from it. Naming an
 * account the package did not declare is still refused, and refused rather
 * than dropped — a settings form with an empty dropdown and no explanation is
 * worse than a package that will not load.
 */
{
  refuses(
    () =>
      widgetPackageManifest(
        {
          ...greedy,
          widget: {
            ...greedy.widget,
            configuration: {
              room: {
                type: "select",
                label: "Room",
                required: true,
                source: { provider: "kavibay.google-calendar/calendar", query: "calendars" },
              },
            },
          },
        },
        { providers: [TADO] },
      ),
    "options sourced from a provider the package did not declare",
  );

  const sneaky = {
    ...greedy,
    widget: {
      ...greedy.widget,
      configuration: {
        room: {
          type: "select", label: "Room",
          source: { provider: "kavibay.google-calendar/calendar", query: "calendars" },
        },
      },
    },
  };
  refuses(
    () => widgetPackageManifest(sneaky, { providers: [TADO] }),
    "options sourced from a provider the package never declared",
  );
}

// --- a package never runs in this document ---
{
  const manifest = widgetPackageManifest(greedy, { providers: [TADO] });
  const widget = manifest.contributes.widgets![0]!;
  let threw = false;
  try {
    void widget.component.setup({} as never);
  } catch {
    threw = true;
  }
  // Loud rather than empty: the host calling this would mean a package was
  // mounted in the host document, which is what the boundary exists to prevent.
  assert(threw, "the host-side setup refuses to run");
}

// --- and the registry gives it the trust its load source implies ---
{
  const manifest = widgetPackageManifest(greedy, { providers: [TADO] });
  const reg = new ExtensionRegistry();
  reg.load(manifest, { kind: "generated", builderSessionId: "session-1" });
  const ext = [...reg.extensions.values()][0];

  assert(ext?.trust === "generated", `trust comes from the load source, got ${ext?.trust}`);
  // It cannot name itself into the reserved namespace either — invariant 1,
  // already enforced, and worth pinning here because a generated manifest is
  // exactly the input that would try.
  assert(!reg.extensions.has("kavibay.room-summary"), "a generated package gets no reserved namespace");
}

/**
 * Generated packages load; they may then call provider actions on accounts the
 * person approved. What the loader still refuses is everything that would put
 * generated code in the host process: a provider, a command, a palette action.
 */
{
  const manifest = widgetPackageManifest(greedy, { providers: [TADO] });

  const generated = new ExtensionRegistry();
  generated.load(tadoExtension, { kind: "bundled" });
  assert(
    generated.load(manifest, { kind: "generated", builderSessionId: "s" }) !== undefined,
    `a generated package loads; what it may then do is the host's call: ${JSON.stringify(generated.errors)}`,
  );
}

// --- nor may generated output define a provider or a command ---
{
  const withProvider = {
    ...widgetPackageManifest(greedy, { providers: [TADO] }),
    contributes: {
      widgets: [],
      providers: [{ name: "sneaky", displayName: "S", requiresCredential: true, hosts: ["x.example"], queries: {}, actions: {} }],
    },
  };
  const reg = new ExtensionRegistry();
  assert(
    reg.load(withProvider as never, { kind: "generated", builderSessionId: "s" }) === undefined,
    "a generated provider is refused — that is auth and credential handling",
  );

  const withCommand = {
    ...widgetPackageManifest(greedy, { providers: [TADO] }),
    contributes: {
      widgets: [],
      commands: [{ kind: "code", name: "run", title: "Run", run: () => {} }],
    },
  };
  const reg2 = new ExtensionRegistry();
  assert(
    reg2.load(withCommand as never, { kind: "generated", builderSessionId: "s" }) === undefined,
    "a generated command is refused — that is code the palette runs in the host",
  );
}

// --- malformed input is refused rather than half-loaded ---
{
  refuses(() => widgetPackageManifest(null, { providers: [] }), "null");
  refuses(() => widgetPackageManifest({}, { providers: [] }), "an empty object");
  refuses(
    () => widgetPackageManifest({ ...greedy, widget: { ...greedy.widget, name: "" } }, { providers: [TADO] }),
    "an empty widget name",
  );
  refuses(
    () => widgetPackageManifest({ ...greedy, engines: {} }, { providers: [TADO] }),
    "a missing engine range",
  );
  refuses(
    () => widgetPackageManifest(
      { ...greedy, widget: { ...greedy.widget, configuration: { x: { type: "colour", label: "X" } } } },
      { providers: [TADO] },
    ),
    "a field type that does not exist",
  );
}

/**
 * The example package, loaded rather than admired.
 *
 * It is what an author copies and what a generator will be pointed at, so "the
 * example and the loader disagree" is a failure with a real cost. Its manifest
 * is imported, not re-typed here, so the two cannot drift. The document and the
 * script are checked by extensionHostSandboxGuard, which is where the rules
 * about what may live in a sandboxed document already are.
 */
{
  const manifest = widgetPackageManifest(exampleManifest, { providers: [] });
  const widget = manifest.contributes.widgets![0]!;
  assert(widget.name === "counter", `the example loads, got ${widget.name}`);
  assert(
    widget.requires === undefined,
    "and needs no provider, which is why an empty grant suffices",
  );
}

console.log("widget-package.assert.ts: ok");

/**
 * Code a generated widget may not contribute, whatever the field is called.
 *
 * `contributes.commands` was refused from the start because a command is code
 * the palette runs in the host. `WidgetDefinition.actions` and `.palette`
 * arrived later, are the same thing, and were not covered — the rule had
 * stopped describing what it protects.
 *
 * These manifests are built by hand rather than through `widgetPackageManifest`
 * on purpose: that function constructs a widget field by field out of JSON and
 * would silently drop both, which is exactly why the gap was invisible. The
 * registry is the layer that must refuse them regardless of who built the
 * object.
 */
{
  const base = {
    name: "sneaky",
    version: "1.0.0",
    displayName: "Sneaky",
    engines: { kavibay: "^0.1" },
  };
  const widget = {
    name: "tile",
    displayName: "Tile",
    defaultSize: { w: 1, h: 1 },
    component: { setup: () => ({}) },
  };

  const withAction = new ExtensionRegistry();
  assert(
    withAction.load(
      {
        ...base,
        contributes: {
          widgets: [{ ...widget, actions: { "run-it": () => {} } }],
        },
      } as never,
      { kind: "generated", builderSessionId: "s" },
    ) === undefined,
    "a generated widget declaring a palette action is refused",
  );
  assert(
    withAction.errors.some((e) => e.includes("run-it")),
    `and names the action, got ${JSON.stringify(withAction.errors)}`,
  );

  const withPalette = new ExtensionRegistry();
  assert(
    withPalette.load(
      {
        ...base,
        contributes: {
          widgets: [{ ...widget, palette: { searchText: () => "anything" } }],
        },
      } as never,
      { kind: "generated", builderSessionId: "s" },
    ) === undefined,
    "a generated widget declaring palette hooks is refused",
  );

  // The same declarations are ordinary for code that shipped in the binary.
  const bundled = new ExtensionRegistry();
  assert(
    bundled.load(
      {
        ...base,
        contributes: {
          widgets: [{ ...widget, actions: { "run-it": () => {} } }],
        },
      } as never,
      { kind: "bundled" },
    ) !== undefined,
    "a bundled widget may declare one — the refusal is about trust, not the field",
  );
}

// --- capabilities are never synthesised from a manifest ---------------------
// `ctx.wizard` carries `endpointCall`, `draftWrite`, `draftPromote` and the
// model itself. It is handed out on `widget.capabilities?.wizard`, and the only
// widget that declares it is compiled into the binary.
//
// The property that makes that safe is here: a package's definition is *built*
// by `toExtension`, and it has no branch that reads `capabilities` at all. A
// manifest can ask for it in whatever spelling it likes and be ignored — not
// filtered, which could be relaxed by a later "merge the ones we trust", but
// never consulted. Pinned because the failure would be silent and total: every
// generated widget would hold the wizard's own capability.
{
  const built = widgetPackageManifest(
    {
      name: "cap-test",
      version: "1.0.0",
      displayName: "Cap Test",
      engines: { kavibay: "^1.0.0" },
      widget: {
        name: "w",
        displayName: "W",
        defaultSize: { w: 2, h: 2 },
        capabilities: { wizard: true, http: { hosts: ["example.com"], methods: ["GET"] }, openExternal: true },
      },
    } as never,
    { providers: [] },
  );

  const definition = built.contributes?.widgets?.[0] as { capabilities?: unknown } | undefined;
  assert(definition !== undefined, "the package still loads — this is not a refusal");
  assert(
    definition!.capabilities === undefined,
    "a manifest asking for capabilities gets none, however it spells it",
  );
}

console.log("widget-package.assert.ts: generated code contributions ok");
