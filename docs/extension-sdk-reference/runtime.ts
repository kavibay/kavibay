import type {
  ProviderId, ProviderStatus, WidgetInstance, WidgetContext, WidgetProviderApi,
  QueryState, Subscription, ProviderError, ArgSpec, CommandContext, ArgBinding,
} from "../sdk.js";
import { ExtensionRegistry } from "./registry.js";
import { QueryCache, toProviderError } from "./query-cache.js";
import { CredentialVault } from "./credentials.js";
import { InstanceDataStore } from "./data-store.js";
import { HttpBroker, type Fetcher } from "./http.js";

const fail = (e: ProviderError) => { throw e; };

export interface HostUi {
  prompt(spec: ArgSpec & { name: string; options?: { value: string | number; label: string }[] }):
    Promise<string | number | boolean | undefined>;
  confirm(message: string): Promise<boolean>;
  notify(message: string): void;
}

export class Host {
  readonly cache = new QueryCache();
  readonly vault = new CredentialVault();
  readonly data = new InstanceDataStore();
  private http: HttpBroker;
  httpFor = (policy: { hosts: string[]; methods: ("GET" | "POST")[] }) => this.http.forPolicy(policy);
  private status = new Map<ProviderId, ProviderStatus>();
  private statusSubs = new Map<ProviderId, Set<(s: ProviderStatus) => void>>();

  constructor(readonly registry: ExtensionRegistry, fetcher: Fetcher, readonly ui: HostUi) {
    this.http = new HttpBroker(fetcher);
  }

  // --- provider lifecycle --------------------------------------------------

  providerStatus(id: ProviderId): ProviderStatus {
    if (!this.registry.providers.has(id)) return { state: "not-installed" };
    if (this.vault.isExpired(id)) return { state: "auth-expired" };
    return this.status.get(id) ?? { state: "disconnected" };
  }

  private setStatus(id: ProviderId, s: ProviderStatus) {
    this.status.set(id, s);
    for (const cb of this.statusSubs.get(id) ?? []) cb(s);
  }

  onStatusChange(id: ProviderId, cb: (s: ProviderStatus) => void): Subscription {
    let set = this.statusSubs.get(id);
    if (!set) { set = new Set(); this.statusSubs.set(id, set); }
    set.add(cb);
    return { unsubscribe: () => set!.delete(cb) };
  }

  async connect(id: ProviderId, creds: { accessToken?: string; apiKey?: string; expiresAt?: number }) {
    const p = this.registry.providers.get(id);
    if (!p) throw new Error(`unknown provider ${id}`);
    this.setStatus(id, { state: "connecting" });
    this.vault.put(id, creds);
    this.setStatus(id, { state: "connected" });
  }

  disconnect(id: ProviderId) {
    this.vault.clear(id);
    this.cache.evictProvider(id);
    this.setStatus(id, { state: "disconnected" });
  }

  private hostContext(id: ProviderId) {
    const def = this.registry.providers.get(id)!.def;
    return {
      http: this.http.forPolicy({ hosts: def.hosts, methods: ["GET", "POST"] as ("GET" | "POST")[] }),
      credentials: {
        getAccessToken: async () => this.vault.read(id)?.accessToken ?? fail({ kind: "disconnected", message: `${id} not connected` }),
        getApiKey: async () => this.vault.read(id)?.apiKey ?? fail({ kind: "disconnected", message: `${id} not connected` }),
      },
    };
  }

  // --- provider access (permission-checked) --------------------------------

  private assertReady(id: ProviderId) {
    const st = this.providerStatus(id);
    if (st.state === "connected") return;
    if (st.state === "auth-expired") fail({ kind: "auth-expired", message: `${id} token expired` });
    if (st.state === "not-installed") fail({ kind: "not-found", message: `${id} not installed` });
    fail({ kind: "disconnected", message: `${id} not connected` });
  }

  async query<T>(id: ProviderId, name: string, args: any, allowed: string[] | null = null): Promise<T> {
    if (allowed !== null && !(allowed ?? []).includes(name)) {
      fail({ kind: "permission-denied", message: `query ${name} not permitted` });
    }
    this.assertReady(id);
    const def = this.registry.providers.get(id)!.def;
    const q = def.queries[name] ?? fail({ kind: "not-found", message: `unknown query ${name}` });
    return this.cache.read<T>([id, name, ...q.key(args)], q.staleTime ?? 30_000, () => q.fetch(args, this.hostContext(id)));
  }

  async subscribe<T>(
    id: ProviderId, name: string, args: any,
    onState: (s: QueryState<T>) => void, allowed: string[] | null = null,
  ): Promise<Subscription> {
    if (allowed !== null && !(allowed ?? []).includes(name)) {
      fail({ kind: "permission-denied", message: `query ${name} not permitted` });
    }
    const def = this.registry.providers.get(id)!.def;
    const q = def.queries[name] ?? fail({ kind: "not-found", message: `unknown query ${name}` });
    const key = [id, name, ...q.key(args)];
    return this.cache.subscribe(
      key, q.staleTime ?? 30_000,
      async () => { this.assertReady(id); return q.fetch(args, this.hostContext(id)); },
      onState as (s: QueryState<unknown>) => void,
    );
  }

  async action<T>(id: ProviderId, name: string, args: any, allowed: string[] | null = null): Promise<T> {
    if (allowed !== null && !(allowed ?? []).includes(name)) {
      fail({ kind: "permission-denied", message: `action ${name} not permitted` });
    }
    this.assertReady(id);
    const def = this.registry.providers.get(id)!.def;
    const a = def.actions[name] ?? fail({ kind: "not-found", message: `unknown action ${name}` });
    const result = await a.execute(args, this.hostContext(id));
    for (const inv of a.invalidates?.(args) ?? []) {
      this.cache.invalidate([id, inv.query, ...(inv.key ?? [])]);
    }
    return result as T;
  }

  // --- widget context ------------------------------------------------------

  /**
   * The runtime resolves the lifecycle before a widget ever renders:
   *   not-installed -> disconnected -> connecting -> unconfigured -> ready
   * A widget never builds its own connect screen.
   */
  widgetGate(instance: WidgetInstance<any>):
    | { state: "ready" }
    | { state: "missing-definition" }
    | { state: "provider"; provider: ProviderId; status: ProviderStatus }
    | { state: "unconfigured"; missing: string[] } {
    const found = this.registry.widget(instance.definitionId);
    if (!found) return { state: "missing-definition" };
    const pid = found.widget.requires?.provider;
    if (pid) {
      const st = this.providerStatus(pid);
      if (st.state !== "connected") return { state: "provider", provider: pid, status: st };
    }
    const missing = Object.entries(found.widget.configuration ?? {})
      .filter(([k, f]) => f.required && (instance.configuration as any)?.[k] === undefined)
      .map(([k]) => k);
    if (missing.length) return { state: "unconfigured", missing };
    return { state: "ready" };
  }

  buildWidgetContext<T>(instance: WidgetInstance<T>): WidgetContext<T> {
    const found = this.registry.widget(instance.definitionId);
    if (!found) throw new Error(`unknown widget ${instance.definitionId}`);
    const w = found.widget;

    const ctx: WidgetContext<T> = {
      instanceId: instance.id,
      config: instance.configuration,
      data: this.data.scoped(instance.id),
    };
    if (w.capabilities?.http) ctx.http = this.http.forPolicy(w.capabilities.http);
    const pid = w.requires?.provider;
    if (pid) ctx.provider = this.providerApi(pid, w.permissions);
    return ctx;
  }

  providerApi(pid: ProviderId, perms?: { queries: string[]; actions: string[] }): WidgetProviderApi {
    return {
      query: (name, args) => this.query(pid, name, args ?? {}, perms?.queries ?? []),
      action: (name, args) => this.action(pid, name, args ?? {}, perms?.actions ?? []),
      subscribe: (name, args, onState) => this.subscribe(pid, name, args ?? {}, onState, perms?.queries ?? []),
      status: async () => this.providerStatus(pid),
      onStatusChange: (cb) => this.onStatusChange(pid, cb),
    };
  }

  // --- commands ------------------------------------------------------------

  /** Palette visibility. A disconnected provider hides its commands. */
  visibleCommands(): string[] {
    const out: string[] = [];
    for (const ext of this.registry.extensions.values()) {
      for (const [cid, c] of ext.commands) {
        const need = c.when?.providerConnected;
        if (need && this.providerStatus(need).state !== "connected") continue;
        out.push(cid);
      }
    }
    return out;
  }

  async runCommand(cmdId: string): Promise<void> {
    const found = this.registry.command(cmdId);
    if (!found) throw new Error(`unknown command ${cmdId}`);
    const c = found.command;

    if (c.kind === "code") {
      const ctx: CommandContext = { ui: this.ui };
      if (c.requires?.provider) {
        ctx.provider = this.providerApi(c.requires.provider, c.permissions);
      }
      if (c.capabilities?.http) ctx.http = this.httpFor(c.capabilities.http);
      return c.run(ctx);
    }

    const def = this.registry.providers.get(c.action.provider)!.def;
    const spec = def.actions[c.action.name]!;
    const args: Record<string, unknown> = {};

    for (const [name, argSpec] of Object.entries(spec.args)) {
      const binding: ArgBinding | undefined = c.action.args[name];
      if (!binding) continue;
      if (binding.from === "literal") {
        // FINDING 3: existence check for provider-sourced literals, at invocation.
        if (argSpec.source) {
          const rows = await this.query<any[]>(c.action.provider, argSpec.source.query, {}, null);
          if (!rows.some((r) => r.id === binding.value)) {
            const e = { kind: "not-found" as const, message: `${name} "${binding.value}" no longer exists` };
            this.ui.notify(`${c.title} failed: ${e.message}`);
            throw e;
          }
        }
        args[name] = binding.value;
        continue;
      }
      // prompt-bound: resolve options from the provider now that it is live
      let options: { value: string | number; label: string }[] | undefined;
      if (argSpec.source) {
        const rows = await this.query<any[]>(c.action.provider, argSpec.source.query, {}, null);
        options = rows.map((r) => ({ value: r.id, label: r.name ?? String(r.id) }));
      }
      const value = await this.ui.prompt({ ...argSpec, name, options });
      if (value === undefined) return; // user cancelled
      args[name] = value;
    }

    const needsConfirm = c.confirm ?? (spec.effect !== "write");
    if (needsConfirm && !(await this.ui.confirm(`${c.title}?`))) return;

    try {
      await this.action(c.action.provider, c.action.name, args, [c.action.name]);
    } catch (err) {
      this.ui.notify(`${c.title} failed: ${toProviderError(err).message}`);
      throw err;
    }
  }
}
