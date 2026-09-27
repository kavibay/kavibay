import type {
  ProviderId, ProviderStatus, ProviderHostContext, WidgetInstance, WidgetContext,
  WidgetProviderApi, QueryState, Subscription, ProviderError, ArgSpec, CommandContext,
  ArgBinding, ProviderQuery, FocusTrackerGroupBy, FocusTrackerIgnoreKind, FocusTrackerRange,
  ColorPickerEvent, WizardCapability, WizardCompletionRequest, SettingsOpenSection,
  ExtensionId,
  ProviderActions,
  TrustTier,
} from "@sdk/contract/sdk";
import { ExtensionRegistry } from "./registry";
import { describeProvider } from "@sdk/contract/providerSchema";
import { resultSchemaProblems } from "@sdk/contract/resultSchema";
import { rewriteImageUrls, schemaHasImage } from "@sdk/contract/imageUrls";
import { QueryCache, toProviderError } from "./query-cache";
import { CredentialVault } from "./credentials";
import { InstanceDataStore } from "./data-store";
import { HttpBroker, type Fetcher } from "./http";
import type { ProviderTransport, ProviderConnection } from "./providerTransport";
import type { WidgetCapabilityTransport } from "./widgetCapabilityTransport";
import { useDeveloperPrefs } from "../settings/useDeveloperPrefs";

/**
 * Ported from docs/extension-sdk-reference/runtime.ts (Phase 1), logic
 * unchanged. The port map marks this file "adapt": provider execution has to
 * route through Rust, but that is Phase 2 work and deliberately not started
 * here — `fetcher` is still injected, and `hostContext` still hands provider
 * code a TypeScript credential handle.
 */

const fail = (e: ProviderError) => { throw e; };

export interface HostUi {
  prompt(spec: ArgSpec & { name: string; options?: { value: string | number; label: string }[] }):
    Promise<string | number | boolean | undefined>;
  confirm(message: string): Promise<boolean>;
  notify(message: string): void;
}

/**
 * Who is asking, when it is not the host itself.
 *
 * `null` means the runtime is calling on its own behalf — resolving a settings
 * dropdown from a provider query, or running an action command the person
 * picked from the palette — and no caller rule applies. Anything originating in
 * extension code passes one.
 *
 * `actions` is the caller's `requires.actions`, copied from the registry's
 * definition (or, for a package, from its grant) where the caller is built.
 * Required rather than optional, so a new place that builds a caller cannot
 * leave it out and get "unchecked" by accident.
 */
export type Caller = {
  extensionId: ExtensionId;
  trust: TrustTier;
  instanceId?: string;
  actions: ProviderActions;
} | null;
const connectionOwner = (caller: Caller) => caller?.instanceId ? `widget:${caller.instanceId}` : "host:default";

export class Host {
  readonly cache = new QueryCache();
  readonly vault = new CredentialVault();
  readonly data = new InstanceDataStore();
  private http: HttpBroker;
  /** Capability http, bound to the declaring extension so the host can vet it. */
  httpFor = (extensionId: string, policy: { hosts: string[]; methods: ("GET" | "POST")[] }) =>
    this.http.forCapability(extensionId, policy);
  private status = new Map<ProviderId, ProviderStatus>();
  private statusSubs = new Map<ProviderId, Set<(s: ProviderStatus) => void>>();

  constructor(
    readonly registry: ExtensionRegistry,
    fetcher: Fetcher,
    readonly ui: HostUi,
    /**
     * Present in the app, absent under `tsx`. When it is there, provider
     * requests and connection checks run in the host process and no token ever
     * enters this one.
     */
    private transport?: ProviderTransport,
    /** Present in the app for reviewed first-party OS capabilities. */
    private widgetTransport?: WidgetCapabilityTransport,
    /** Keeps generated package definitions in sync after a wizard operation. */
    private runtimePackageSync?: (rows: unknown, installs: unknown) => void,
    /** Opens the host-owned Settings surface without exposing its implementation. */
    private settingsOpener?: (section: SettingsOpenSection, focus?: string) => void,
  ) {
    this.http = new HttpBroker(fetcher, transport);
  }

  // --- provider lifecycle --------------------------------------------------

  private statusKey(id: ProviderId, instanceId?: string): string {
    return this.transport?.connection && instanceId ? `${id}:${instanceId}` : id;
  }

  providerStatus(id: ProviderId, instanceId?: string): ProviderStatus {
    const found = this.registry.providers.get(id);
    if (!found) return { state: "not-installed" };
    /**
     * A provider that needs no credential is connected as soon as it is
     * installed. There is nothing to connect *to* — no account, no token, no
     * expiry — so the four states below all describe a question it does not
     * have, and the default of `disconnected` would put a connect prompt in
     * front of a widget with nothing to connect.
     *
     * Derived here rather than pushed in by `refreshProviderStatus`, even
     * though the Rust side answers `true` for the same reason
     * (`provider_is_connected`: "nothing to connect"). The gate reads this
     * synchronously on first paint; waiting for a round trip to learn a fact
     * the definition already states would show that prompt for one frame.
     */
    if (!found.def.requiresCredential) return { state: "connected" };
    if (this.vault.isExpired(id)) return { state: "auth-expired" };
    return this.status.get(this.statusKey(id, instanceId)) ?? { state: "disconnected" };
  }

  private setStatus(id: ProviderId, s: ProviderStatus, instanceId?: string) {
    const key = this.statusKey(id, instanceId);
    this.status.set(key, s);
    for (const cb of this.statusSubs.get(key) ?? []) cb(s);
  }

  onStatusChange(id: ProviderId, cb: (s: ProviderStatus) => void, instanceId?: string): Subscription {
    const key = this.statusKey(id, instanceId);
    let set = this.statusSubs.get(key);
    if (!set) { set = new Set(); this.statusSubs.set(key, set); }
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

  /**
   * Pulls the connection state from the host process and publishes it.
   *
   * `providerStatus` is synchronous because the gate renders from it, but with
   * a transport the truth lives in Rust and cannot be derived here — so it has
   * to be fetched and pushed into the same status map, which then notifies
   * subscribers exactly as a local `connect()` would.
   */
  async refreshProviderStatus(id: ProviderId, instanceId?: string): Promise<void> {
    if (!this.transport || !this.registry.providers.has(id)) return;
    const connected = await this.transport.isConnected(id, instanceId ? `widget:${instanceId}` : "host:default");
    this.setStatus(id, connected ? { state: "connected" } : { state: "disconnected" }, instanceId);
  }

  disconnect(id: ProviderId) {
    this.vault.clear(id);
    this.cache.evictProvider(id);
    this.setStatus(id, { state: "disconnected" });
  }

  /**
   * FINDING 8: no token getter. Provider code gets a capability handle and a
   * yes/no, never a credential value — the HTTP broker attaches auth for the
   * provider's declared hosts. Until Phase 2 moves that broker into Rust the
   * vault still holds the token in JS; what has already changed is that no
   * provider can reach it, so the Phase 2 swap is invisible to provider code.
   */
  private hostContext(id: ProviderId, connection?: ProviderConnection | null): ProviderHostContext {
    const def = this.registry.providers.get(id)!.def;
    return {
      // forProvider, not forPolicy: the allowlist decision belongs to whoever
      // attaches the credential, and that is no longer this process.
      http: this.http.forProvider(id, Array.isArray(def.hosts) ? def.hosts : [], connection),
      credentials: {
        isConnected: async () =>
          connection ? connection.available : this.transport ? this.transport.isConnected(id) : this.vault.has(id),
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

  private async requestConnection(id: ProviderId, caller: Caller): Promise<ProviderConnection | null> {
    if (!this.transport?.connection) { this.assertReady(id); return null; }
    /**
     * Everything but bundled code answers to a grant. Listed the other way
     * round — naming the tiers that need one — a tier nobody thought of (a
     * signed catalog package is `reviewed`, and nothing bundled) spent the
     * account without one, because the host only checks a grant for a package
     * id it is given.
     */
    const packageId = caller && caller.trust !== "core"
      ? this.registry.extensions.get(caller.extensionId)!.manifest.name : undefined;
    const owner = connectionOwner(caller);
    const connection = await this.transport.connection(id, owner, packageId);
    if (connection && !connection.credentialId) {
      fail({ kind: "disconnected", message: `${id}: no account chosen yet` });
    }
    /**
     * Chosen but unusable is a different dead end, and saying "choose an
     * account" there sends the user to a control that already holds the right
     * answer. It is either an account that needs reconnecting, or one this
     * widget has not been approved for.
     */
    if (connection && !connection.available) {
      fail({
        kind: "disconnected",
        message: `${id}: this account needs reconnecting, or this widget has not been allowed to use it`,
      });
    }
    // The owner travels with every fetch: the host spends the account bound to
    // it and only checks that `credentialId` agrees.
    return connection && { ...connection, owner, ...(packageId ? { packageId } : {}) };
  }

  private connectionKey(connection: ProviderConnection | null): (string | number)[] {
    return connection ? ["connection", connection.credentialId!, connection.revision, connection.packageId ?? "bundled"] : [];
  }

  async query<T>(id: ProviderId, name: string, args: any, caller: Caller = null): Promise<T> {
    const connection = await this.requestConnection(id, caller);
    const def = this.registry.providers.get(id)!.def;
    const q = def.queries[name] ?? fail({ kind: "not-found", message: `unknown query ${name}` });
    return this.cache.read<T>([id, name, ...this.connectionKey(connection), ...q.key(args)], q.staleTime ?? 30_000, () =>
      this.runFetch(id, name, q, args, connection),
    );
  }

  async subscribe<T>(
    id: ProviderId, name: string, args: any,
    onState: (s: QueryState<T>) => void, caller: Caller = null,
  ): Promise<Subscription> {
    const connection = await this.requestConnection(id, caller);
    const def = this.registry.providers.get(id)!.def;
    const q = def.queries[name] ?? fail({ kind: "not-found", message: `unknown query ${name}` });
    const key = [id, name, ...this.connectionKey(connection), ...q.key(args)];
    return this.cache.subscribe(
      key, q.staleTime ?? 30_000,
      async () => { if (!this.transport?.connection) this.assertReady(id); return this.runFetch(id, name, q, args, connection); },
      onState as (s: QueryState<unknown>) => void,
    );
  }

  /**
   * The one place a provider's `fetch` is called, so the declared result can be
   * checked against the real one.
   *
   * DEV ONLY. A vendor adding or renaming a field must not show the user an
   * error panel in a release build — but it must be impossible to miss while
   * the person who can fix it is watching. Without this, `ProviderQuery.result`
   * would be a second statement of what `fetch` returns with nothing comparing
   * them, which is the shape of findings 4 and 7.
   *
   * `import.meta.env` is undefined under `tsx`, where the assert suite runs the
   * host headlessly — hence the optional read rather than a bare `.DEV`.
   */
  private async runFetch(
    id: ProviderId,
    name: string,
    q: ProviderQuery<any, any>,
    args: any,
    connection?: ProviderConnection | null,
  ): Promise<any> {
    const value = await q.fetch(args, this.hostContext(id, connection));
    if (q.result && import.meta.env?.DEV) {
      const problems = resultSchemaProblems(q.result, value);
      if (problems.length > 0) {
        console.error(
          `[extension-host] ${id}.${name} does not match its declared result:\n  ${problems.join("\n  ")}`,
        );
      }
    }
    /**
     * Picture urls become host-answered urls before anything caches them.
     *
     * Here rather than at the widget boundary because the cache entry is shared
     * — an in-app widget and a sandboxed package read the same one, and a value
     * that differed by reader would be two truths in one cache. The sandboxed
     * frame is the one that cannot fetch a picture itself; giving both the same
     * url costs the in-app path nothing and keeps one shape to reason about.
     */
    if (q.result && schemaHasImage(q.result)) {
      return rewriteImageUrls(q.result, value, id);
    }
    return value;
  }

  /**
   * A provider action, for a caller that declared it.
   *
   * The account is the read grant (FINDINGS §27); a write is one step further,
   * and it has to be named in `requires.actions`. The check comes before the
   * connection on purpose: an undeclared action is refused the same way whether
   * or not the account is connected, so the answer does not depend on state the
   * author cannot see while writing the widget.
   *
   * Generated widgets get the same API as bundled ones. What they still cannot
   * do is contribute a provider, a command, or a palette callback — code the
   * host would run, refused at load.
   */
  async action<T>(id: ProviderId, name: string, args: any, caller: Caller = null): Promise<T> {
    if (caller && !(caller.actions[id] ?? []).includes(name)) {
      fail({
        kind: "permission-denied",
        message: `${id}.${name} is not declared in requires.actions`,
      });
    }
    const connection = await this.requestConnection(id, caller);
    const def = this.registry.providers.get(id)!.def;
    const a = def.actions[name] ?? fail({ kind: "not-found", message: `unknown action ${name}` });
    const result = await a.execute(args, this.hostContext(id, connection));
    for (const inv of a.invalidates?.(args) ?? []) {
      this.cache.invalidate([id, inv.query, ...this.connectionKey(connection), ...(inv.key ?? [])]);
    }
    return result as T;
  }

  /**
   * One declared endpoint, executed by the Rust broker.
   *
   * Absent transport means the assert suite, which has no Tauri: answered as a
   * refusal rather than by throwing, because a widget must handle `ok: false`
   * anyway and a suite that crashes here would be testing the harness.
   */
  async callEndpoint(
    extensionId: ExtensionId,
    endpoint: string,
    args: Record<string, unknown>,
    instanceId: string,
  ): Promise<unknown> {
    if (!this.widgetTransport?.runtimeHttpCall) {
      return { ok: false, code: "unavailable" };
    }
    return this.widgetTransport.runtimeHttpCall(extensionId, endpoint, args, instanceId);
  }

  /**
   * Opens an https URL through the OS. The caller (in-process or the bridge)
   * must have already checked `capabilities.openExternal`.
   */
  async openExternal(url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("only HTTPS URLs may be opened by a widget");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("only HTTPS URLs may be opened by a widget");
    }
    if (!this.widgetTransport) {
      throw new Error("openExternal is unavailable");
    }
    await this.widgetTransport.openExternal(parsed.toString());
  }

  /**
   * Hostnames the providers a widget declares vouch for their records living on.
   *
   * Derived from the registry, never from the widget: the declaration is what
   * the person approved, and a guest asking to open a url has no say in which
   * providers it declared. Linear answers from `api.linear.app` and vouches for
   * `linear.app`, which is why this is its own list rather than `hosts`.
   */
  linkHosts(definitionId: string): string[] {
    const found = this.registry.widget(definitionId);
    if (!found) return [];
    return [
      ...new Set(
        (found.widget.requires?.providers ?? []).flatMap(
          (id) => this.registry.providers.get(id)?.def.linkHosts ?? [],
        ),
      ),
    ];
  }

  /**
   * Opens a url one of this widget's providers vouched for.
   *
   * The route a widget without the bundled-only `openExternal` capability
   * takes. A generated widget cannot name a destination — it can only pass on a
   * url that arrived inside a reviewed provider's response, and the host checks
   * that claim rather than believing it.
   */
  async openExternalVouched(definitionId: string, url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("only HTTPS URLs may be opened by a widget");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("only HTTPS URLs may be opened by a widget");
    }
    const allowed = this.linkHosts(definitionId);
    if (!allowed.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase())) {
      throw new Error(`no provider of this widget links to ${parsed.hostname}`);
    }
    if (!this.widgetTransport) {
      throw new Error("openExternal is unavailable");
    }
    await this.widgetTransport.openExternalVouched(parsed.toString());
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
    /**
     * Every provider that is not connected, not just the first.
     *
     * A list because the prompt has to name all of them: connecting one, being
     * asked for the next, connecting that one and being asked for a third is
     * the same wait presented as three surprises. `provider` and `status` are
     * kept alongside as the first entry so a caller that renders one prompt
     * stays correct.
     */
    | {
        state: "provider";
        provider: ProviderId;
        status: ProviderStatus;
        pending: { provider: ProviderId; status: ProviderStatus }[];
      }
    | { state: "unconfigured"; missing: string[] } {
    const found = this.registry.widget(instance.definitionId);
    if (!found) return { state: "missing-definition" };
    const pending = (found.widget.requires?.providers ?? [])
      .map((provider) => ({ provider, status: this.providerStatus(provider, instance.id) }))
      .filter((entry) => entry.status.state !== "connected");
    if (pending.length > 0) {
      return { state: "provider", provider: pending[0]!.provider, status: pending[0]!.status, pending };
    }
    const missing = Object.entries(found.widget.configuration ?? {})
      .filter(([k, f]) => {
        const value = (instance.configuration as any)?.[k];
        return f.required && (value === undefined || (Array.isArray(value) && value.length === 0));
      })
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
      sharedData: this.data.shared(found.ext.id),
    };
    if (w.capabilities?.http) ctx.http = this.http.forCapability(found.ext.id, w.capabilities.http);
    if (w.capabilities?.aiUsage && this.widgetTransport) {
      ctx.aiUsage = {
        snapshot: <T>() => this.widgetTransport!.aiUsageSnapshot() as Promise<T>,
        enableClaudeCapture: <T>() =>
          this.widgetTransport!.aiUsageEnableClaudeCapture() as Promise<T>,
      };
    }
    if (w.capabilities?.notification && this.widgetTransport) {
      ctx.notification = {
        show: (request) => this.widgetTransport!.notificationShow(request),
      };
    }
    if (w.capabilities?.systemInfo && this.widgetTransport) {
      ctx.systemInfo = {
        snapshot: <T>() => this.widgetTransport!.systemInfoSnapshot() as Promise<T>,
      };
    }
    if (w.capabilities?.nowPlaying && this.widgetTransport) {
      ctx.nowPlaying = {
        snapshot: <T>() => this.widgetTransport!.nowPlayingSnapshot() as Promise<T>,
        control: (action) => this.widgetTransport!.nowPlayingControl(action),
      };
    }
    if (w.capabilities?.alarm && this.widgetTransport) {
      ctx.alarm = {
        notify: (mode) => this.widgetTransport!.alarmNotify(instance.id, mode),
      };
    }
    if (w.capabilities?.openExternal && this.widgetTransport) {
      ctx.openExternal = {
        open: (url) => this.openExternal(url),
      };
    } else if (this.linkHosts(instance.definitionId).length > 0 && this.widgetTransport) {
      // No capability to declare: holding a provider that vouches for a link
      // host *is* the permission, and it came with the account the person
      // already approved.
      ctx.openExternal = {
        open: (url) => this.openExternalVouched(instance.definitionId, url),
      };
    }
    if (w.capabilities?.clipboard && this.widgetTransport) {
      ctx.clipboard = {
        writeText: (text) => this.widgetTransport!.clipboardWriteText(text),
        list: <T>() => this.widgetTransport!.clipboardList() as Promise<T>,
        onChange: <T>(listener: (entries: T) => void) =>
          this.widgetTransport!.clipboardOnChange(listener as (entries: unknown) => void),
        restore: (id) => this.widgetTransport!.clipboardRestore(id),
        setRevealed: (id, revealed) => this.widgetTransport!.clipboardSetRevealed(id, revealed),
        delete: (id) => this.widgetTransport!.clipboardDelete(id),
        clear: () => this.widgetTransport!.clipboardClear(),
        imageUrl: (path) => this.widgetTransport!.clipboardImageUrl(path),
      };
    }
    if (w.capabilities?.colorPicker && this.widgetTransport) {
      ctx.colorPicker = {
        start: (onEvent: (event: ColorPickerEvent) => void) =>
          this.widgetTransport!.colorPickerStart(onEvent),
        stop: () => this.widgetTransport!.colorPickerStop(),
      };
    }
    if (w.capabilities?.image && this.widgetTransport) {
      ctx.image = {
        pick: () => this.widgetTransport!.imagePick(),
        import: (sourcePath) => this.widgetTransport!.imageImport(instance.id, sourcePath),
        clear: () => this.widgetTransport!.imageClear(instance.id),
        imageUrl: (path) => this.widgetTransport!.imageUrl(path),
      };
    }
    if (w.capabilities?.launcher && this.widgetTransport) {
      ctx.launcher = {
        pick: (kind) => this.widgetTransport!.launcherPick(kind),
        listInstalled: <T>() => this.widgetTransport!.launcherListInstalled() as Promise<T>,
        extractIcon: (path) => this.widgetTransport!.launcherExtractIcon(path),
        loadIcon: (path) => this.widgetTransport!.launcherLoadIcon(path),
        fetchUrlIcon: (url) => this.widgetTransport!.launcherFetchUrlIcon(url),
        launch: (path) => this.widgetTransport!.launcherLaunch(path),
        sendKey: (keyId) => this.widgetTransport!.launcherSendKey(keyId),
      };
    }
    if (w.capabilities?.focusTracker && this.widgetTransport) {
      ctx.focusTracker = {
        status: <T>() => this.widgetTransport!.focusTrackerStatus() as Promise<T>,
        summary: <T>(range: FocusTrackerRange, groupBy: FocusTrackerGroupBy) =>
          this.widgetTransport!.focusTrackerSummary(range, groupBy) as Promise<T>,
        listHabitRules: <T>() => this.widgetTransport!.focusTrackerListHabitRules() as Promise<T>,
        upsertHabitRule: <T>(appName: string, limitMinutes: number) =>
          this.widgetTransport!.focusTrackerUpsertHabitRule(appName, limitMinutes) as Promise<T>,
        deleteHabitRule: (id) => this.widgetTransport!.focusTrackerDeleteHabitRule(id),
        recentApps: <T>(limit?: number) => this.widgetTransport!.focusTrackerRecentApps(limit) as Promise<T>,
        listIgnoreRules: <T>() => this.widgetTransport!.focusTrackerListIgnoreRules() as Promise<T>,
        upsertIgnoreRule: <T>(kind: FocusTrackerIgnoreKind, value: string) =>
          this.widgetTransport!.focusTrackerUpsertIgnoreRule(kind, value) as Promise<T>,
        deleteIgnoreRule: (id) => this.widgetTransport!.focusTrackerDeleteIgnoreRule(id),
      };
    }
    if (w.capabilities?.llm && this.widgetTransport) {
      ctx.llm = {
        models: <T>() => this.widgetTransport!.llmModels(instance.id) as Promise<T>,
        quickModel: <T>() => this.widgetTransport!.llmQuickModel() as Promise<T>,
        stream: (request, onEvent) =>
          this.widgetTransport!.llmStream(instance.id, request, onEvent),
        cancel: (requestId) => this.widgetTransport!.llmCancel(requestId),
        openSettings: (section, focus) => this.settingsOpener?.(section, focus),
      };
    }
    if (w.capabilities?.wizard && this.widgetTransport) {
      const refreshRuntimePackages = async <T>() => {
        const rows = await this.widgetTransport!.wizardRuntimeScan();
        const installs = await this.widgetTransport!.wizardRuntimeInstalls();
        this.runtimePackageSync?.(rows, installs);
        return rows as T;
      };
      const wizard: WizardCapability = {
        models: <T>() => this.widgetTransport!.wizardModels(instance.id) as Promise<T>,
        complete: <T>(request: WizardCompletionRequest) =>
          this.widgetTransport!.wizardComplete(request, instance.id) as Promise<T>,
        providers: <T>() =>
          Promise.resolve(
            [...this.registry.providers.entries()]
              .map(([id, entry]) => describeProvider(id, entry.def))
              .sort((a, b) => a.displayName.localeCompare(b.displayName)),
          ) as Promise<T>,
        providerStatus: <T>(id: string) => Promise.resolve(this.providerStatus(id)) as Promise<T>,
        developerConsentBypass: async () => useDeveloperPrefs().wizardAutoEnable.value,
        developerExtensionsEnabled: async () =>
          useDeveloperPrefs().developerExtensionsEnabled.value,
        setDeveloperConsentBypass: async (on: boolean) => {
          const prefs = useDeveloperPrefs();
          // `setWizardAutoEnable` normalises against the Developer Extensions
          // gate, so asking for it while that is off simply leaves it off —
          // and the answer says which it ended up as rather than assuming.
          prefs.setWizardAutoEnable(on);
          return prefs.wizardAutoEnable.value;
        },
        openSettings: (section, focus) => this.settingsOpener?.(section, focus),
        conversationsList: <T>() =>
          this.widgetTransport!.wizardConversationsList() as Promise<T>,
        conversationLoad: <T>(id: string) =>
          this.widgetTransport!.wizardConversationLoad(id) as Promise<T>,
        conversationSave: (conversation: unknown) =>
          this.widgetTransport!.wizardConversationSave(conversation),
        conversationDelete: (id: string) => this.widgetTransport!.wizardConversationDelete(id),
        runtimeScan: refreshRuntimePackages,
        runtimeInstalls: <T>() =>
          this.widgetTransport!.wizardRuntimeInstalls() as Promise<T>,
        runtimeEntryUrl: (id: string, entry: string) =>
          this.widgetTransport!.wizardRuntimeEntryUrl(id, entry),
        runtimeSetEnabled: async (
          id: string,
          enabled: boolean,
          manifestPermissions: string[],
          contractGrant?: unknown,
        ) => {
          await this.widgetTransport!.wizardRuntimeSetEnabled(
            id,
            enabled,
            manifestPermissions,
            contractGrant,
          );
          await refreshRuntimePackages();
        },
        runtimeReadPackage: <T>(id: string) =>
          this.widgetTransport!.wizardRuntimeReadPackage(id) as Promise<T>,
        exportPackage: (id: string) => this.widgetTransport!.wizardExportPackage(id),
        runtimeDeletePackage: async (id: string) => {
          await this.widgetTransport!.wizardRuntimeDeletePackage(id);
          await refreshRuntimePackages();
        },
        endpointCall: <T>(extId: string, endpointId: string, args: unknown) =>
          this.widgetTransport!.wizardEndpointCall(extId, endpointId, args) as Promise<T>,
        drafts: <T>() => this.widgetTransport!.wizardDrafts() as Promise<T>,
        draftRead: <T>(id: string) =>
          this.widgetTransport!.wizardDraftRead(id) as Promise<T>,
        draftOpen: <T>(id: string) =>
          this.widgetTransport!.wizardDraftOpen(id) as Promise<T>,
        onDraftChanged: (handler) => this.widgetTransport!.wizardOnDraftChanged(handler),
        draftPresence: <T>() => this.widgetTransport!.wizardDraftPresence() as Promise<T>,
        onDraftPresenceChanged: (handler) =>
          this.widgetTransport!.wizardOnDraftPresenceChanged(handler),
        draftWrite: <T>(id: string, files: unknown, expectedRevision?: string | null) =>
          this.widgetTransport!.wizardDraftWrite(id, files, expectedRevision) as Promise<T>,
        draftPromote: <T>(id: string, replaces?: string | null) =>
          this.widgetTransport!.wizardDraftPromote(id, replaces) as Promise<T>,
        draftDiscard: (id: string) => this.widgetTransport!.wizardDraftDiscard(id),
      };
      ctx.wizard = wizard;
    }
    /**
     * One handle per declared provider, each bound to its own id and its own
     * grant. `providerApi` keeps taking a single list pair and stays unaware
     * that a widget may hold more than one — the fan-out lives here, which is
     * also the only place that knows the declaration.
     */
    /**
     * Given unconditionally rather than behind a declaration: `api.json` is the
     * declaration, it is on disk beside the package, and Rust refuses every
     * endpoint that is not in it. A second gate here would be a second place
     * the same fact is stated.
     */
    ctx.endpoint = ((endpoint: string, args?: Record<string, unknown>) =>
      this.callEndpoint(found.ext.id, endpoint, args ?? {}, instance.id)) as WidgetContext<T>["endpoint"];

    const declared = w.requires?.providers ?? [];
    if (declared.length > 0) {
      const caller = {
        extensionId: found.ext.id,
        trust: found.ext.trust,
        instanceId: instance.id,
        actions: w.requires?.actions ?? {},
      };
      ctx.providers = Object.fromEntries(
        declared.map((pid) => [pid, this.providerApi(pid, caller)]),
      );
    }
    return ctx;
  }

  providerApi(pid: ProviderId, caller: Caller = null): WidgetProviderApi {
    return {
      query: (name, args) => this.query(pid, name, args ?? {}, caller),
      action: (name, args) => this.action(pid, name, args ?? {}, caller),
      subscribe: (name, args, onState) => this.subscribe(pid, name, args ?? {}, onState, caller),
      status: async () => this.providerStatus(pid, caller?.instanceId),
      onStatusChange: (cb) => this.onStatusChange(pid, cb, caller?.instanceId),
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
      const declared = c.requires?.providers ?? [];
      if (declared.length > 0) {
        const caller = {
          extensionId: found.ext.id,
          trust: found.ext.trust,
          actions: c.requires?.actions ?? {},
        };
        ctx.providers = Object.fromEntries(
          declared.map((pid) => [pid, this.providerApi(pid, caller)]),
        );
      }
      if (c.capabilities?.http) ctx.http = this.httpFor(found.ext.id, c.capabilities.http);
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
      // No caller: an ActionCommand is configuration in a reviewed manifest,
      // invoked from the palette by the person themselves. Generated extensions
      // may contribute no commands — the registry refuses that at load.
      await this.action(c.action.provider, c.action.name, args, null);
    } catch (err) {
      this.ui.notify(`${c.title} failed: ${toProviderError(err).message}`);
      throw err;
    }
  }
}
