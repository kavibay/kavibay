import type {
  ConfigField,
  ExtensionManifest,
  ProviderActions,
  ProviderId,
  WidgetDefinition,
} from "@sdk/contract/sdk";

/**
 * Turns a widget package's `manifest.json` into something the registry can
 * load.
 *
 * The whole reason this is a function and not a `JSON.parse` is the grant. A
 * package states what it *wants*; what it *gets* is passed in separately, by
 * the caller, from what the user approved. There is no code path that reads a
 * permission out of the file — not "we validate it first", not "we intersect
 * it". The argument is required, so a caller cannot forget it, and the file's
 * own list is only ever answered as a question (`requestedPermissions`) for
 * whoever draws the approval dialog.
 *
 * That is finding 14's rule made mechanical rather than remembered: trust comes
 * from the load source (the registry's own invariant 1), and permissions come
 * from the user.
 */

/**
 * Deliberately the same two fields `requires` carries, under the same names:
 * which accounts the widget may read, and which actions it may call on them. A
 * grant that described itself differently from the thing it produces would be
 * a second vocabulary for one fact, and the mapping between them the place a
 * mistake hides.
 *
 * `actions` is required, not optional, so a caller building a grant has to say
 * "none" out loud. Palette `widget.actions` are a different thing and still
 * refused for generated packages by the registry.
 */
export interface ApprovedGrant {
  /** The providers the user approved this widget for. Empty means none. */
  providers: ProviderId[];
  /** The actions the user let it call, per approved provider. Empty means none. */
  actions: ProviderActions;
}

/**
 * FINDINGS §27 shrank this to a provider list. What the user decides is which
 * accounts a widget may use, not which queries — so the grant carries exactly
 * that, and the separation finding 14 is about is unchanged: the package states
 * what it wants, the caller passes what the person allowed, and no code path
 * reads the second from the first.
 */
export class WidgetPackageError extends Error {}

const fail = (message: string): never => {
  throw new WidgetPackageError(message);
};

const str = (value: unknown, what: string): string =>
  typeof value === "string" && value.length > 0 ? value : fail(`${what} must be a non-empty string`);

const record = (value: unknown, what: string): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${what} must be an object`);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/**
 * What the package asked for, for an approval dialog to show.
 *
 * Deliberately separate from loading, and deliberately returning plain data: a
 * caller that wants to grant these has to pass them back in, which is one more
 * place a reviewer can see the decision being made.
 */
export function requestedPermissions(raw: unknown): ApprovedGrant {
  const manifest = record(raw, "manifest");
  const widget = record(manifest.widget, "manifest.widget");
  const providers = declaredProviders(widget);
  return { providers, actions: declaredActions(widget, providers) };
}

/**
 * `widget.requires.providers`, from JSON.
 *
 * Only the plural spelling is read, and the singular one is refused rather than
 * ignored — see `refuseSingular`.
 */
function declaredProviders(widget: Record<string, unknown>): ProviderId[] {
  if (widget.requires === undefined) return [];
  const requires = record(widget.requires, "widget.requires");
  refuseSingular(requires);
  return strings(requires.providers) as ProviderId[];
}

/**
 * `widget.requires.actions`, from JSON: provider id to action names.
 *
 * An array is refused with the shape spelled out, because `["createEvent"]` is
 * the natural first guess and it is a permission with no stated subject
 * (FINDINGS §25). A key outside `requires.providers` is refused for the same
 * reason the registry refuses it on a bundled widget.
 */
function declaredActions(widget: Record<string, unknown>, providers: readonly ProviderId[]): ProviderActions {
  const requires = widget.requires === undefined ? {} : record(widget.requires, "widget.requires");
  if (requires.actions === undefined) return {};
  if (Array.isArray(requires.actions)) {
    fail('widget.requires.actions is keyed by provider: { "<provider id>": ["<action>"] }');
  }
  const actions: ProviderActions = {};
  for (const [pid, names] of Object.entries(record(requires.actions, "widget.requires.actions"))) {
    if (!providers.includes(pid)) {
      fail(`widget.requires.actions names ${pid}, which is not in requires.providers`);
    }
    actions[pid] = strings(names);
  }
  return actions;
}

/**
 * A manifest using the pre-list spelling is refused, not ignored.
 *
 * Reading nothing out of `requires: { provider: "…" }` would load the package
 * with no provider at all: it would appear, render empty, and say nothing about
 * why — the exact failure `widgetPackageLoad.ts` exists to stop producing. The
 * package is not wrong so much as old, and that is the message worth giving.
 */
function refuseSingular(requires: Record<string, unknown>): void {
  if (typeof requires.provider === "string") {
    fail(
      `widget.requires.provider is the old single-provider spelling; use requires.providers: ["${requires.provider}"]`,
    );
  }
}

export function widgetPackageManifest(raw: unknown, approved: ApprovedGrant): ExtensionManifest {
  const manifest = record(raw, "manifest");
  const widget = record(manifest.widget, "manifest.widget");
  const engines = record(manifest.engines, "manifest.engines");

  const declared = declaredProviders(widget);

  /**
   * Naming a provider grants nothing by itself — the permission map below is
   * what opens anything, and it comes from the user. But a mismatch means the
   * approval was about different providers than the ones that would be
   * addressed, so the two have to be the same fact.
   *
   * Compared as sets rather than as lists: order is a spelling detail of the
   * manifest, and refusing a correct package over it would read as the
   * package's mistake and is not.
   */
  const sameProviders =
    declared.length === approved.providers.length &&
    declared.every((pid) => approved.providers.includes(pid));
  if (!sameProviders) {
    fail(
      `the package declares ${declared.join(", ") || "no provider"} but the approval is for ${approved.providers.join(", ") || "none"}`,
    );
  }

  /**
   * The actions come from the grant, like everything else a package may do.
   * The file only bounds them: an approval naming an action the package never
   * asked for was an answer to a different question, so it is refused rather
   * than quietly narrowed.
   */
  const asked = declaredActions(widget, declared);
  const actions: ProviderActions = {};
  for (const [pid, names] of Object.entries(approved.actions)) {
    if (!names?.length) continue;
    if (!approved.providers.includes(pid)) {
      fail(`the approval lets ${pid} be written to without approving it to be read`);
    }
    const unasked = names.filter((name) => !(asked[pid] ?? []).includes(name));
    if (unasked.length) {
      fail(`the approval names ${unasked.map((name) => `${pid}.${name}`).join(", ")}, which the package does not declare`);
    }
    actions[pid] = [...names];
  }

  const definition: WidgetDefinition<Record<string, unknown>> = {
    name: str(widget.name, "widget.name"),
    displayName: str(widget.displayName, "widget.displayName"),
    description: typeof widget.description === "string" ? widget.description : undefined,
    defaultSize: size(widget.defaultSize),
    ...(declared.length > 0
      ? {
          requires: {
            providers: [...declared],
            ...(Object.keys(actions).length > 0 ? { actions } : {}),
          },
        }
      : {}),
    /**
     * FINDING 14. Not read from the file, not merged with it, not intersected
     * with it — replaced by it having never been consulted.
     */
    configuration: configuration(widget.configuration, approved),
    component: {
      /**
       * A package's `setup` runs inside its own frame, over the bridge. This
       * exists because `WidgetDefinition` requires it, and it throws rather
       * than returning something empty: the host calling it would mean a
       * package was mounted in this document, which is the one thing the whole
       * boundary exists to prevent, and it should be loud.
       */
      setup() {
        throw new Error("a widget package runs in its sandbox, never in the host document");
      },
    },
  };

  return {
    name: str(manifest.name, "manifest.name"),
    version: str(manifest.version, "manifest.version"),
    displayName: str(manifest.displayName, "manifest.displayName"),
    description: typeof manifest.description === "string" ? manifest.description : undefined,
    engines: { kavibay: str(engines.kavibay, "engines.kavibay") },
    ...dependencies(approved.providers),
    contributes: { widgets: [definition] },
  };
}

/**
 * The dependency on whoever owns the approved provider.
 *
 * The linker refuses a widget that uses a provider from another extension unless
 * the manifest declares a dependency on its owner — a rule written when every
 * manifest was hand-authored, and the fifth layer that turned out to assume
 * there was only one package format. A correct package was refused with
 * "uses kavibay.tado/tado without declaring a dependency on kavibay.tado",
 * which reads like the package's mistake and is not.
 *
 * Derived from the **grant**, not from the file, which is the only reason this
 * is safe to synthesise at all: the user was shown that provider by name and
 * said yes to it, so the declaration states something they decided rather than
 * something the package asserted about itself. A package cannot reach a provider
 * this way that it was not approved for — the permission lists are still empty
 * unless the same grant filled them.
 *
 * The range is `*` because it is honest. A package has no way to know which
 * version of a provider extension this install carries, and a range invented to
 * look specific would be a second gate that answers a question nobody asked.
 */
function dependencies(providers: readonly ProviderId[]) {
  const owners: Record<string, { version: string }> = {};
  for (const provider of providers) {
    const owner = provider.split("/")[0];
    // Two providers owned by one extension collapse to a single entry, which is
    // what a dependency list means anyway.
    if (owner) owners[owner] = { version: "*" };
  }
  return Object.keys(owners).length > 0 ? { dependencies: owners } : {};
}

function size(value: unknown): { w: number; h: number } {
  if (value === undefined) return { w: 2, h: 2 };
  const s = record(value, "widget.defaultSize");
  const n = (v: unknown, what: string) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fail(`${what} must be a positive number`);
  return { w: n(s.w, "defaultSize.w"), h: n(s.h, "defaultSize.h") };
}

/**
 * The settings schema, with one restriction that is not obvious.
 *
 * A `select` field may draw its options from a provider query, and the runtime
 * runs that query on the widget's behalf with permissions bypassed — correct
 * for a reviewed widget, because the runtime is drawing its own form and the
 * widget's list must not gate it. For a package the same path would be a way to
 * make the host call any query on any provider, approved or not, just by
 * declaring a field.
 *
 * So a package's option source has to name the provider it declared and a query
 * the user approved. Refused rather than dropped: a field that silently loses
 * its options is a settings form with an empty dropdown and no explanation.
 */
function configuration(
  value: unknown,
  approved: ApprovedGrant,
): Record<string, ConfigField> | undefined {
  if (value === undefined) return undefined;
  const fields = record(value, "widget.configuration");
  const out: Record<string, ConfigField> = {};

  for (const [key, rawField] of Object.entries(fields)) {
    const field = record(rawField, `configuration.${key}`);
    const type = str(field.type, `configuration.${key}.type`);
    if (!["string", "number", "boolean", "select"].includes(type)) {
      fail(`configuration.${key}.type is not a field type: ${type}`);
    }
    if (field.multiple !== undefined && typeof field.multiple !== "boolean") {
      fail(`configuration.${key}.multiple must be a boolean`);
    }
    if (field.multiple === true && type !== "select") {
      fail(`configuration.${key}.multiple is only valid for select fields`);
    }

    const built: ConfigField = {
      type: type as ConfigField["type"],
      label: str(field.label, `configuration.${key}.label`),
      required: field.required === true,
    };
    if (field.multiple === true) built.multiple = true;
    if (field.default !== undefined) built.default = field.default as ConfigField["default"];

    if (field.source !== undefined) {
      const source = record(field.source, `configuration.${key}.source`);
      const sourceProvider = str(source.provider, `configuration.${key}.source.provider`);
      const sourceQuery = str(source.query, `configuration.${key}.source.query`);
      /**
       * Only the provider is checked now. The query used to have to be one the
       * user ticked, and there is no ticking any more — approving a provider
       * approves reading from it, and a settings dropdown is reading.
       */
      if (!approved.providers.includes(sourceProvider as ProviderId)) {
        fail(`configuration.${key} draws options from ${sourceProvider}, which this package did not declare`);
      }
      built.source = { provider: sourceProvider as ProviderId, query: sourceQuery };
    }

    out[key] = built;
  }

  return out;
}
