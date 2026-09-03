/**
 * Kavibay Extension SDK — contract.
 * Sections 1-7 have zero framework dependency. Section 8 (Vue bindings) lives
 * in sdk-vue.ts so the compiler enforces that separation.
 */

// === 1. IDENTITY AND TRUST ==================================================

export type ExtensionId = string;   // "<namespace>.<name>", e.g. "swetlow.tado"
export type ProviderId = string;    // "<ExtensionId>/<local name>"
export type CommandId = string;
export type WidgetDefinitionId = string;
export type WidgetInstanceId = string;

/** Derived by the runtime from the load source. Never read from a manifest. */
export type ExtensionSource =
  | { kind: "bundled" }
  | { kind: "catalog"; entry: string; signature?: string }
  | { kind: "generated"; builderSessionId: string }
  | { kind: "sideloaded"; path: string };

export type TrustTier = "core" | "reviewed" | "generated" | "untrusted";

export interface LoadedExtension {
  id: ExtensionId;
  version: string;
  manifest: ExtensionManifest;
  source: ExtensionSource;
  trust: TrustTier;
}

// === 2. MANIFEST ============================================================

export interface ExtensionManifest {
  name: string;                 // unqualified; runtime prefixes the namespace
  version: string;
  displayName: string;
  description?: string;
  author?: string;
  engines: { kavibay: string };
  dependencies?: Record<ExtensionId, ExtensionDependency>;
  contributes: {
    providers?: ProviderDefinition[];
    widgets?: WidgetDefinition<any>[];
    commands?: CommandDefinition[];
  };
}

export interface ExtensionDependency {
  version: string;
}

// === 3. CAPABILITIES ========================================================

/**
 * HARD RULE: anything needing a credential is a Provider, never an http call.
 * Secure storage is provider-runtime internal and never widget-facing.
 */
export interface CapabilityDeclaration {
  http?: HttpCapabilityDeclaration;
}

export interface HttpCapabilityDeclaration {
  hosts: string[];                        // exact hostnames, no wildcards
  methods: Array<"GET" | "POST">;
}

export interface HttpCapability {
  get<T = unknown>(url: string, params?: Record<string, string | number | boolean>): Promise<T>;
  post<T = unknown>(url: string, body?: unknown): Promise<T>;
}

// === 4. PROVIDERS ===========================================================

export interface ProviderDefinition {
  name: string;
  displayName: string;
  connection: ProviderConnectionSpec;
  /** Hosts the provider itself may reach. Enforced by the host runtime. */
  hosts: string[];
  queries: Record<string, ProviderQuery<any, any>>;
  actions: Record<string, ProviderAction<any, any>>;
}

export type ProviderConnectionSpec =
  | { kind: "none" }
  | { kind: "oauth2-pkce"; authorizeUrl: string; tokenUrl: string; clientId: string; scopes: string[] }
  | { kind: "api-key"; label: string; helpUrl?: string };

export type QueryKey = ReadonlyArray<string | number>;

export interface ProviderQuery<TArgs, TResult> {
  /**
   * FINDING 4: the DISCRIMINATING part of the key only, e.g. `[a.roomId]`.
   * The host prefixes providerId and query name. The first draft let authors
   * write the full key (`["tado","roomState",roomId]`) and had the host
   * re-namespace it by slicing — which silently produced a key the matching
   * invalidation prefix could never hit. Never let two parties build one key.
   */
  key: (args: TArgs) => QueryKey;
  staleTime?: number;
  fetch: (args: TArgs, host: ProviderHostContext) => Promise<TResult>;
}

export interface ProviderAction<TArgs, TResult = void> {
  effect: "write" | "destructive" | "sensitive";
  args: Record<string, ArgSpec>;
  execute: (args: TArgs, host: ProviderHostContext) => Promise<TResult>;
  invalidates?: (args: TArgs) => QueryInvalidation[];
}

/** Omit `key` to invalidate every cached key of that query. */
export interface QueryInvalidation {
  query: string;
  key?: QueryKey;
}

export interface ArgSpec {
  type: "string" | "number" | "boolean";
  label: string;
  required?: boolean;
  /** Enumerable values come from a query on the same provider. */
  source?: { query: string };
}

/** Privileged. Handed to provider code only. Never crosses the wire. */
export interface ProviderHostContext {
  http: HttpCapability;
  credentials: {
    getAccessToken(): Promise<string>;
    getApiKey(): Promise<string>;
  };
}

export type ProviderStatus =
  | { state: "not-installed" }
  | { state: "disconnected" }
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "auth-expired" }
  | { state: "error"; message: string };

// === 5. WIDGETS =============================================================

export interface WidgetDefinition<TConfig = Record<string, unknown>> {
  name: string;
  displayName: string;
  description?: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  mode?: "compact" | "expanded" | "both";
  requires?: { provider: ProviderId };
  /**
   * FINDING 5: this is REQUIRED whenever `requires.provider` is set, and
   * missing entries mean DENY, never allow. As an optional field with
   * undefined meaning "unchecked", a widget that declared only queries could
   * call every action on its provider. Permissions must fail closed.
   */
  permissions?: { queries: string[]; actions: string[] };
  capabilities?: CapabilityDeclaration;
  configuration?: Record<string, ConfigField>;
  component: WidgetComponent<TConfig>;
}

/**
 * In the real app this is a Vue SFC and setup() receives the context.
 * Typed as a headless function so the contract can be exercised without a DOM
 * and so the contract itself carries no Vue types.
 */
export interface WidgetComponent<TConfig = Record<string, unknown>> {
  setup(ctx: WidgetContext<TConfig>): Promise<unknown> | unknown;
}

export interface ConfigField {
  type: "string" | "number" | "boolean" | "select";
  label: string;
  required?: boolean;
  default?: unknown;
  /** Options from a provider query. Cannot run before the provider connects. */
  source?: { provider: ProviderId; query: string };
}

export interface WidgetInstance<TConfig = Record<string, unknown>> {
  id: WidgetInstanceId;
  definitionId: WidgetDefinitionId;
  configuration: TConfig;
  position: { x: number; y: number };
  size: { w: number; h: number };
  mode: "compact" | "expanded";
}

/**
 * THREE KINDS OF STATE:
 *   config      user-set parameters, schema-driven settings UI
 *   data        persisted instance data (todo items), app-managed and quota'd
 *   ui state    ephemeral, lives and dies with the mount
 */
export interface WidgetContext<TConfig = Record<string, unknown>> {
  instanceId: WidgetInstanceId;
  config: Readonly<TConfig>;
  data: {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };
  http?: HttpCapability;
  provider?: WidgetProviderApi;
}

export interface WidgetProviderApi {
  query<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  action<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Reactive read. The Vue layer in sdk-vue.ts is a thin wrapper over this. */
  subscribe<T = unknown>(
    name: string,
    args: Record<string, unknown> | undefined,
    onState: (state: QueryState<T>) => void,
  ): Promise<Subscription>;
  status(): Promise<ProviderStatus>;
  onStatusChange(cb: (status: ProviderStatus) => void): Subscription;
}

export interface Subscription {
  unsubscribe(): void;
}

// === 6. COMMANDS ============================================================

export type CommandDefinition = ActionCommand | CodeCommand;

interface CommandBase {
  name: string;
  title: string;
  keywords?: string[];
  when?: { providerConnected?: ProviderId };
}

/** Configuration, not code. The AI builder may generate these. */
export interface ActionCommand extends CommandBase {
  kind: "action";
  action: {
    provider: ProviderId;
    name: string;
    args: Record<string, ArgBinding>;
  };
  confirm?: boolean;
}

/** Arbitrary logic. Authored only. The AI builder may NOT generate these. */
export interface CodeCommand extends CommandBase {
  kind: "code";
  /**
   * FINDING 6: a code command runs extension code and therefore needs its own
   * capability and permission declaration. The first draft had none, which
   * left only two options once permissions fail closed: unrestricted commands,
   * or commands that can never touch a provider. `when` is visibility, not
   * capability — the two must not be conflated.
   */
  requires?: { provider: ProviderId };
  permissions?: { queries: string[]; actions: string[] };
  capabilities?: CapabilityDeclaration;
  run: (ctx: CommandContext) => Promise<void>;
}

/**
 * A command argument is either fixed at authoring time, or resolved from the
 * user at invocation time against the action's ArgSpec.
 */
export type ArgBinding =
  | { from: "literal"; value: string | number | boolean }
  | { from: "prompt"; label: string };

export interface CommandContext {
  provider?: WidgetProviderApi;
  http?: HttpCapability;
  /** Resolves prompt-bound args and confirmation. Owned by the runtime. */
  ui: {
    /**
     * `options` is filled by the runtime from `ArgSpec.source` at invocation
     * time, because provider-sourced values are only knowable after connect.
     * Returning undefined means the user cancelled.
     */
    prompt(
      spec: ArgSpec & { name: string; options?: { value: string | number; label: string }[] },
    ): Promise<string | number | boolean | undefined>;
    confirm(message: string): Promise<boolean>;
    notify(message: string): void;
  };
}

// === 7. WIRE LAYER ==========================================================

/**
 * Everything crossing the widget boundary. Async, serializable, no functions,
 * no reactive objects, no direct tauri invoke. Swapping in postMessage / iframe
 * / worker must be a change here and nowhere else.
 */
/**
 * FINDING 7: provider.* requests carry NO provider id. The host resolves it
 * from the caller's registered instance and its `requires.provider`. Letting
 * the widget name the provider on the wire would let any widget address any
 * connected provider and reduce `requires` to a suggestion. Rule: the wire
 * never carries a value the host can derive from the caller's identity.
 */
export type WidgetRequest =
  | { type: "provider.query"; name: string; args: unknown }
  | { type: "provider.action"; name: string; args: unknown }
  | { type: "provider.subscribe"; name: string; args: unknown; subscriptionId: string }
  | { type: "provider.unsubscribe"; subscriptionId: string }
  | { type: "provider.status" }
  | { type: "data.get"; key: string }
  | { type: "data.set"; key: string; value: unknown }
  | { type: "data.delete"; key: string }
  | { type: "http.get"; url: string; params?: Record<string, unknown> }
  | { type: "http.post"; url: string; body?: unknown };

export type HostEvent =
  | { type: "query.update"; subscriptionId: string; state: QueryState<unknown> }
  | { type: "config.changed"; instanceId: WidgetInstanceId; config: Record<string, unknown> }
  | { type: "provider.status"; provider: ProviderId; status: ProviderStatus };

export type WidgetResponse<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: ProviderError };

export interface ProviderError {
  kind:
    | "disconnected"
    | "auth-expired"
    | "permission-denied"
    | "rate-limited"
    | "offline"
    | "not-found"
    | "provider-error";
  message: string;
  retryAfterMs?: number;
}

export type QueryState<T> =
  | { status: "loading"; data?: T }
  | { status: "success"; data: T; isStale: boolean; updatedAt: number }
  | { status: "error"; error: ProviderError; data?: T };

// === AUTHORING HELPERS ======================================================

export const defineWidget = <TConfig>(d: WidgetDefinition<TConfig>) => d;
export const defineProvider = (d: ProviderDefinition) => d;
export const defineCommand = (d: CommandDefinition) => d;
export const defineExtension = (m: ExtensionManifest) => m;
