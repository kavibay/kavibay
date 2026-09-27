import satisfies from "semver/functions/satisfies.js";
import validRange from "semver/ranges/valid.js";
// Named import so Rollup shakes the JSON module down to the one string we use,
// instead of inlining the whole Tauri config into the bundle. `tauri.conf.json`
// is the version source the port map names; `scripts/versionSync.assert.mjs`
// already keeps it equal to package.json and Cargo.toml, so there is no fourth
// place to forget on a release bump.
import { version as APP_VERSION } from "../../../src-tauri/tauri.conf.json";

import type {
  ExtensionManifest, ExtensionSource, TrustTier, LoadedExtension, ExtensionId,
  ProviderId, ProviderDefinition, WidgetDefinition, WidgetDefinitionId,
  CommandDefinition, ActionCommand, ProviderRequirements,
} from "@sdk/contract/sdk";

/**
 * Ported from docs/extension-sdk-reference/registry.ts (Phase 1) with the two
 * substitutions the port map asks for: the hand-rolled `satisfiesCaret` is now
 * the `semver` library, and `APP_VERSION` comes from `tauri.conf.json`.
 *
 * NOTE ON ENGINE RANGES: the reference ran against a fictional app version
 * 0.4.2, so its extension manifests declare `engines.kavibay: "^0.4"`. This
 * app is at 0.1.0, and under caret semantics 0.x minors are breaking — `^0.4`
 * is NOT satisfied by 0.1.0. Manifests ported into this repo must declare a
 * range this app actually satisfies (`^0.1`). That is a fixture change, not a
 * loosening of the check: refusing a mismatched engine range is asserted
 * behaviour and must keep failing for genuinely incompatible extensions.
 */

const RESERVED = new Set(["kavibay", "core", "official", "system"]);

/**
 * SECURITY INVARIANT: the namespace comes from the load source, never from the
 * manifest. An extension cannot name itself into a trust tier.
 */
function deriveNamespace(source: ExtensionSource): string {
  switch (source.kind) {
    case "bundled": return "kavibay";
    case "catalog": return source.entry.split("/")[0] ?? "unknown";
    case "generated": return "local";
    case "sideloaded": return "dev";
  }
}

/**
 * The definition id a bundled extension's widget will get once loaded.
 *
 * Exported so the view map can be keyed without a second copy of the namespace
 * rule: it goes through `deriveNamespace` like everything else, so "bundled
 * means kavibay" is stated exactly once. Composing an id here grants nothing
 * — `load()` is still what decides whether that id exists.
 */
export function bundledDefinitionId(extensionName: string, widgetName: string): WidgetDefinitionId {
  return `${deriveNamespace({ kind: "bundled" })}.${extensionName}/${widgetName}`;
}

/**
 * The same provider named twice.
 *
 * Harmless to every lookup — they are all by id — and refused anyway, because
 * the only way to write it is by accident, and the accident it usually stands
 * for is a second entry that was meant to be a different provider.
 */
function duplicateProviders(who: string, declared: readonly ProviderId[]): string[] {
  const seen = new Set<ProviderId>();
  return declared
    .filter((pid) => (seen.has(pid) ? true : (seen.add(pid), false)))
    .map((pid) => `${who}: requires ${pid} more than once`);
}

/**
 * Returns why a generated extension may not load, or undefined if it may.
 *
 * Refusing rather than stripping. A generated widget quietly loaded without the
 * action it declared would fail at the moment the user pressed the button, with
 * "action not permitted" and no hint that the decision was made at load time.
 */
function generatedContributionRefusal(manifest: ExtensionManifest): string | undefined {
  if (manifest.contributes.providers?.length) {
    return "generated extensions cannot contribute a provider — that is auth and credential handling";
  }
  if (manifest.contributes.commands?.length) {
    return "generated extensions cannot contribute a command — that is code the palette runs in the host";
  }
  for (const w of manifest.contributes.widgets ?? []) {
    /**
     * Palette `widget.actions` are still refused for generated packages — that
     * is a callback the host would invoke. Provider actions are not declared
     * here: they run through `Host.action`, and the grant is the account.
     */
    /**
     * A local palette action is a `run` callback the host invokes — the same
     * category as `contributes.commands` two checks up, which is refused for
     * exactly that reason. The field arrived later than the rule and was not
     * covered by it.
     *
     * Nothing can reach this today: `widgetPackageManifest` builds a widget
     * field by field out of JSON, and a function cannot come from JSON. That is
     * the point of adding the check anyway — the protection was coming from
     * another file's construction rather than from the rule that claims it, and
     * the day a package format grows a way to express behaviour, the rule is
     * already where it needs to be.
     */
    const actionIds = Object.keys(w.actions ?? {});
    if (actionIds.length > 0) {
      return `widget ${w.name} declares the palette action ${actionIds[0]}; generated widgets contribute no code the host runs`;
    }
    /**
     * Same argument for the palette hooks: `inlineView`, `searchText` and
     * `instanceActions` are all callbacks the palette calls, on every keystroke
     * in the case of the first two.
     */
    if (w.palette) {
      return `widget ${w.name} declares palette hooks; generated widgets contribute no code the host runs`;
    }
  }
  return undefined;
}

function deriveTrust(source: ExtensionSource): TrustTier {
  switch (source.kind) {
    case "bundled": return "core";
    case "catalog": return source.signature ? "reviewed" : "untrusted";
    case "generated": return "generated";
    case "sideloaded": return "untrusted";
  }
}

/**
 * Replaces the reference's hand-rolled caret check. `semver.satisfies` throws on
 * a malformed range rather than returning false, so an unparseable range is
 * caught and treated as "not satisfied" — a manifest with a typo'd range must
 * fail closed, not load unchecked.
 */
function satisfiesRange(version: string, range: string): boolean {
  if (validRange(range) === null) return false;
  return satisfies(version, range, { includePrerelease: true });
}

export interface RegistryEntry extends LoadedExtension {
  providers: Map<ProviderId, ProviderDefinition>;
  widgets: Map<string, WidgetDefinition<any>>;
  commands: Map<string, CommandDefinition>;
}

export class ExtensionRegistry {
  readonly extensions = new Map<ExtensionId, RegistryEntry>();
  readonly providers = new Map<ProviderId, { def: ProviderDefinition; owner: ExtensionId }>();
  readonly errors: string[] = [];

  /**
   * FINDING 2: loading has to be two-phase. A command binding to a provider in
   * another extension cannot be validated until every extension is loaded, and
   * a dependency cannot be resolved against something not yet present.
   * Phase 1 registers, phase 2 links. A single-pass load() cannot work.
   */
  load(manifest: ExtensionManifest, source: ExtensionSource): ExtensionId | undefined {
    const ns = deriveNamespace(source);
    if (RESERVED.has(ns) && source.kind !== "bundled") {
      this.errors.push(`reserved namespace "${ns}" refused for ${source.kind} extension`);
      return undefined;
    }
    if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      this.errors.push(`invalid extension name "${manifest.name}"`);
      return undefined;
    }
    const id = `${ns}.${manifest.name}`;
    if (this.extensions.has(id)) {
      this.errors.push(`duplicate extension id ${id}`);
      return undefined;
    }
    if (!satisfiesRange(APP_VERSION, manifest.engines.kavibay)) {
      this.errors.push(`${id} requires kavibay ${manifest.engines.kavibay}, app is ${APP_VERSION}`);
      return undefined;
    }

    const trust = deriveTrust(source);

    /**
     * What generated code may contribute, checked where trust is decided rather
     * than where a manifest is built.
     *
     * `widgetPackage.ts` refuses these too, but it is one caller. This is the
     * place that knows the load source, and a rule about generated code that
     * lives anywhere else is a rule someone can route around by constructing a
     * manifest another way.
     *
     * Read-only for now, and that is a product decision rather than a technical
     * limit: an action writes to the real world — on tado° it is the heating —
     * and it is a poor first thing to let a model reach for. Widening this is a
     * deliberate change to this line.
     *
     * Providers and commands are refused outright: a provider is auth and
     * credential handling, and a command is code the palette runs in the host.
     * Neither is something generated output has any business defining.
     */
    if (trust === "generated") {
      const refusal = generatedContributionRefusal(manifest);
      if (refusal) {
        this.errors.push(`${id}: ${refusal}`);
        return undefined;
      }
    }

    const entry: RegistryEntry = {
      id, version: manifest.version, manifest, source,
      trust,
      providers: new Map(), widgets: new Map(), commands: new Map(),
    };

    for (const p of manifest.contributes.providers ?? []) {
      const pid: ProviderId = `${id}/${p.name}`;
      if (this.providers.has(pid)) {
        this.errors.push(`duplicate provider id ${pid}`);
        return undefined;
      }
      entry.providers.set(pid, p);
      this.providers.set(pid, { def: p, owner: id });
    }
    for (const w of manifest.contributes.widgets ?? []) entry.widgets.set(`${id}/${w.name}`, w);
    for (const c of manifest.contributes.commands ?? []) entry.commands.set(`${id}/${c.name}`, c);

    this.extensions.set(id, entry);
    return id;
  }

  /** Phase 2. Returns ids of extensions that failed linking and were unloaded. */
  link(): ExtensionId[] {
    const failed: ExtensionId[] = [];
    for (const ext of [...this.extensions.values()]) {
      const problems: string[] = [];

      for (const [depId, dep] of Object.entries(ext.manifest.dependencies ?? {})) {
        const target = this.extensions.get(depId);
        if (!target) problems.push(`${ext.id}: missing dependency ${depId}`);
        else if (!satisfiesRange(target.version, dep.version)) {
          problems.push(`${ext.id}: ${depId}@${target.version} does not satisfy ${dep.version}`);
        }
      }

      for (const [wid, w] of ext.widgets) {
        const declared = w.requires?.providers ?? [];
        problems.push(...duplicateProviders(wid, declared));
        problems.push(...this.declaredActionProblems(wid, w.requires));
        for (const pid of declared) {
          const owner = this.providers.get(pid)?.owner;
          if (!owner) { problems.push(`${wid}: unknown provider ${pid}`); continue; }
          if (owner !== ext.id && !ext.manifest.dependencies?.[owner]) {
            problems.push(`${wid}: uses ${pid} without declaring a dependency on ${owner}`);
          }
        }
      }

      for (const [cid, c] of ext.commands) {
        if (c.kind === "action") { problems.push(...this.validateActionCommand(cid, c)); continue; }
        const declared = c.requires?.providers ?? [];
        problems.push(...duplicateProviders(cid, declared));
        problems.push(...this.declaredActionProblems(cid, c.requires));
        for (const pid of declared) {
          const p = this.providers.get(pid);
          if (!p) { problems.push(`${cid}: unknown provider ${pid}`); continue; }
          if (p.owner !== ext.id && !ext.manifest.dependencies?.[p.owner]) {
            problems.push(`${cid}: uses ${pid} without declaring a dependency on ${p.owner}`);
          }
        }
      }

      if (problems.length) {
        this.errors.push(...problems);
        failed.push(ext.id);
        this.unload(ext.id);
      }
    }
    return failed;
  }

  /**
   * `requires.actions` and `requires.queries`, checked against the list beside
   * them and the provider.
   *
   * A key outside `providers` is a write permission on an account the code never
   * asked to read — FINDINGS §25's grant without a subject, one field over. An
   * unknown name passes review and fails the first time the button is pressed,
   * so it fails here instead, where the message can name the typo.
   */
  private declaredActionProblems(who: string, requires: ProviderRequirements | undefined): string[] {
    const out: string[] = [];
    for (const field of ["actions", "queries"] as const) {
      for (const [pid, names] of Object.entries(requires?.[field] ?? {})) {
        if (!requires?.providers.includes(pid)) {
          out.push(`${who}: requires.${field} names ${pid}, which is not in requires.providers`);
          continue;
        }
        const def = this.providers.get(pid)?.def;
        // An unknown provider is already reported by the caller's loop.
        if (!def) continue;
        for (const name of names ?? []) {
          if (!def[field][name]) out.push(`${who}: unknown ${field === "actions" ? "action" : "query"} ${pid}.${name}`);
        }
      }
    }
    return out;
  }

  private validateActionCommand(cid: string, c: ActionCommand): string[] {
    const out: string[] = [];
    const p = this.providers.get(c.action.provider);
    if (!p) return [`${cid}: unknown provider ${c.action.provider}`];
    const action = p.def.actions[c.action.name];
    if (!action) return [`${cid}: unknown action ${c.action.provider}.${c.action.name}`];

    for (const [name, spec] of Object.entries(action.args)) {
      const binding = c.action.args[name];
      if (!binding) {
        if (spec.required) out.push(`${cid}: missing required arg "${name}"`);
        continue;
      }
      if (binding.from === "literal" && typeof binding.value !== spec.type) {
        out.push(`${cid}: arg "${name}" expects ${spec.type}, got ${typeof binding.value}`);
      }
      /**
       * FINDING 3: forbidding a literal for a provider-sourced arg would kill
       * the exact case the AI builder exists for ("living room to 21 degrees").
       * Load-time validation can only check SHAPE. Provider-sourced literals
       * must be re-validated at invocation against a live query, and fail with
       * a not-found ProviderError if the room or calendar no longer exists.
       * Recorded here so the rule is not re-litigated: shape at load,
       * existence at invocation.
       */
    }
    for (const name of Object.keys(c.action.args)) {
      if (!action.args[name]) out.push(`${cid}: unknown arg "${name}"`);
    }
    if ((action.effect === "destructive" || action.effect === "sensitive") && c.confirm === false) {
      out.push(`${cid}: confirm cannot be disabled for a ${action.effect} action`);
    }
    return out;
  }

  /**
   * Public because packages arrive and leave while the app runs: a grant is
   * withdrawn, a widget is disabled, a folder is deleted. `link()` was the only
   * caller while everything was bundled at boot, and "loaded once, forever" was
   * an assumption of that arrangement rather than a rule.
   */
  unload(id: ExtensionId) {
    const e = this.extensions.get(id);
    if (!e) return;
    for (const pid of e.providers.keys()) this.providers.delete(pid);
    this.extensions.delete(id);
  }

  widget(defId: string) {
    for (const e of this.extensions.values()) {
      const w = e.widgets.get(defId);
      if (w) return { widget: w, ext: e };
    }
    return undefined;
  }

  command(cmdId: string) {
    for (const e of this.extensions.values()) {
      const c = e.commands.get(cmdId);
      if (c) return { command: c, ext: e };
    }
    return undefined;
  }
}
