import type {
  ExtensionManifest, ExtensionSource, TrustTier, LoadedExtension, ExtensionId,
  ProviderId, ProviderDefinition, WidgetDefinition, CommandDefinition, ActionCommand,
} from "../sdk.js";

const APP_VERSION = "0.4.2";
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

function deriveTrust(source: ExtensionSource): TrustTier {
  switch (source.kind) {
    case "bundled": return "core";
    case "catalog": return source.signature ? "reviewed" : "untrusted";
    case "generated": return "generated";
    case "sideloaded": return "untrusted";
  }
}

/** Minimal caret range check. Real impl uses a semver lib. */
function satisfiesCaret(version: string, range: string): boolean {
  if (!range.startsWith("^")) return version === range;
  const [rMaj = "0", rMin = "0"] = range.slice(1).split(".");
  const [vMaj = "0", vMin = "0"] = version.split(".");
  if (rMaj !== "0") return vMaj === rMaj && Number(vMin) >= Number(rMin);
  return vMaj === "0" && vMin === rMin; // 0.x: minor is the breaking axis
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
    if (!satisfiesCaret(APP_VERSION, manifest.engines.kavibay)) {
      this.errors.push(`${id} requires kavibay ${manifest.engines.kavibay}, app is ${APP_VERSION}`);
      return undefined;
    }

    const entry: RegistryEntry = {
      id, version: manifest.version, manifest, source,
      trust: deriveTrust(source),
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
        else if (!satisfiesCaret(target.version, dep.version)) {
          problems.push(`${ext.id}: ${depId}@${target.version} does not satisfy ${dep.version}`);
        }
      }

      for (const [wid, w] of ext.widgets) {
        const pid = w.requires?.provider;
        if (!pid) continue;
        const owner = this.providers.get(pid)?.owner;
        if (!owner) { problems.push(`${wid}: unknown provider ${pid}`); continue; }
        if (owner !== ext.id && !ext.manifest.dependencies?.[owner]) {
          problems.push(`${wid}: uses ${pid} without declaring a dependency on ${owner}`);
        }
        const def = this.providers.get(pid)!.def;
        for (const q of w.permissions?.queries ?? []) {
          if (!def.queries[q]) problems.push(`${wid}: permission for unknown query ${pid}.${q}`);
        }
        for (const a of w.permissions?.actions ?? []) {
          if (!def.actions[a]) problems.push(`${wid}: permission for unknown action ${pid}.${a}`);
        }
      }

      for (const [cid, c] of ext.commands) {
        if (c.kind === "action") { problems.push(...this.validateActionCommand(cid, c)); continue; }
        const pid = c.requires?.provider;
        if (!pid) continue;
        const p = this.providers.get(pid);
        if (!p) { problems.push(`${cid}: unknown provider ${pid}`); continue; }
        if (p.owner !== ext.id && !ext.manifest.dependencies?.[p.owner]) {
          problems.push(`${cid}: uses ${pid} without declaring a dependency on ${p.owner}`);
        }
        for (const q of c.permissions?.queries ?? []) {
          if (!p.def.queries[q]) problems.push(`${cid}: permission for unknown query ${pid}.${q}`);
        }
        for (const a of c.permissions?.actions ?? []) {
          if (!p.def.actions[a]) problems.push(`${cid}: permission for unknown action ${pid}.${a}`);
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

  private unload(id: ExtensionId) {
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
