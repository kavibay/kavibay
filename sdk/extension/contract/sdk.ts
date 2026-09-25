// SPDX-License-Identifier: MIT
/**
 * Kavibay Extension SDK — contract.
 * Sections 1-7 have zero framework dependency. Section 8 (Vue bindings) lives
 * in sdk-vue.ts so the compiler enforces that separation.
 *
 * Ported unchanged from docs/extension-sdk-reference/sdk.ts (Phase 1), which is
 * frozen at that handoff. THIS FILE IS THE CONTRACT AND HAS GROWN SINCE — result
 * schemas, local widget actions, shared data. Where the two differ, this one is
 * right; the reference is kept identical so "ported unchanged" stays checkable,
 * not because it is still a description of the SDK.
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
    /** First-party palette actions that do not own a widget instance. */
    actions?: Record<string, ExtensionActionHandler>;
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
  /** Local Codex/Claude rate-limit snapshots and opt-in Claude capture setup. */
  aiUsage?: true;
  /** Native OS notifications; only bundled first-party widgets may declare it. */
  notification?: true;
  /** Read-only host snapshot; only bundled first-party widgets may declare it. */
  systemInfo?: true;
  /** Media-session snapshot and fixed transport controls. */
  nowPlaying?: true;
  /** Fixed alarm notification surface; only bundled first-party widgets may declare it. */
  alarm?: true;
  /** Open one reviewed external HTTPS URL; only bundled first-party widgets may declare it. */
  openExternal?: true;
  /** Write text to the host clipboard; only bundled first-party widgets may declare it. */
  clipboard?: true;
  /** Native screen-color session; only bundled first-party widgets may declare it. */
  colorPicker?: true;
  /** Instance-owned image file surface; only bundled first-party widgets may declare it. */
  image?: true;
  /** Desktop application launch and icon surface; only bundled first-party widgets may declare it. */
  launcher?: true;
  /** Focus tracking snapshots and rule management; only bundled first-party widgets may declare it. */
  focusTracker?: true;
  /** Provider-neutral LLM model discovery and streaming; host owns credentials. */
  llm?: true;
  /** Widget Wizard authoring and generated-package management; bundled only. */
  wizard?: true;
}

export interface HttpCapabilityDeclaration {
  hosts: string[];                        // exact hostnames, no wildcards
  methods: Array<"GET" | "POST">;
}

export interface HttpCapability {
  get<T = unknown>(url: string, params?: Record<string, string | number | boolean>): Promise<T>;
  post<T = unknown>(url: string, body?: unknown): Promise<T>;
}

/**
 * Provider fetches may PUT. Widget capabilities may not — that declaration is
 * still GET/POST, and the capability broker never grows a method a widget
 * did not list. Spotify play/pause is PUT, which is why this type exists.
 */
export interface ProviderHttpCapability extends HttpCapability {
  put<T = unknown>(url: string, body?: unknown): Promise<T>;
}

/**
 * Reviewed host capability for OS metrics. The result stays extension-owned:
 * the SDK only promises a snapshot operation and does not duplicate its JSON
 * schema in the shared contract.
 */
export interface SystemInfoCapability {
  snapshot<T = unknown>(): Promise<T>;
}

/**
 * Reviewed host capability for local AI subscription usage. The setup method
 * names one fixed integration; extensions cannot supply a command or path.
 */
export interface AiUsageCapability {
  snapshot<T = unknown>(): Promise<T>;
  enableClaudeCapture<T = unknown>(): Promise<T>;
}

export interface NotificationRequest {
  title: string;
  body: string;
}

/** Reviewed host capability for native operating-system notifications. */
export interface NotificationCapability {
  show(request: NotificationRequest): Promise<void>;
}

export type NowPlayingControl = "previous" | "playPause" | "next" | "openSource";

/**
 * Reviewed host capability for the active Windows media session. Controls are
 * named operations rather than an arbitrary command string, so a widget cannot
 * widen this surface by choosing another Tauri command name.
 */
export interface NowPlayingCapability {
  snapshot<T = unknown>(): Promise<T>;
  control(action: NowPlayingControl): Promise<void>;
}

export type AlarmNotification = "sound_and_pop" | "pop" | "sound" | "none";

/**
 * Reviewed host capability for alarm notifications. The widget chooses only
 * the notification mode; the host owns the sound, window focus, and reveal.
 */
export interface AlarmCapability {
  notify(mode: AlarmNotification): Promise<void>;
}

/** Reviewed host capability for a fixed external-link surface. */
export interface OpenExternalCapability {
  open(url: string): Promise<void>;
}

/** Reviewed host capability for writing text without exposing host internals. */
export interface ClipboardCapability {
  writeText(text: string): Promise<void>;
  list<T = unknown>(): Promise<T>;
  /**
   * Called with the whole history whenever it changes — a copy anywhere, or a
   * restore, delete or clear here. Resolves to the unsubscribe.
   */
  onChange<T = unknown>(listener: (entries: T) => void): Promise<() => void>;
  restore(id: string): Promise<void>;
  setRevealed(id: string, revealed: boolean): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  imageUrl(path: string): string;
}

export interface ColorPickerSample {
  r: number;
  g: number;
  b: number;
}

export type ColorPickerEvent =
  | { type: "sample"; sample: ColorPickerSample }
  | { type: "picked"; sample: ColorPickerSample }
  | { type: "cancelled" };

/** Reviewed host capability for the one native screen-colour pick session. */
export interface ColorPickerCapability {
  start(onEvent: (event: ColorPickerEvent) => void): Promise<() => void>;
  stop(): Promise<void>;
}

/** Reviewed host capability for image files owned by one widget instance. */
export interface ImageCapability {
  pick(): Promise<string | null>;
  import(sourcePath: string): Promise<string>;
  clear(): Promise<void>;
  imageUrl(path: string): string;
}

export type LauncherPickKind = "file" | "folder" | "image";

/** Fixed desktop-launch surfaces used by the Launcher Buttons widget. */
export interface LauncherCapability {
  pick(kind: LauncherPickKind): Promise<string[]>;
  listInstalled<T = unknown>(): Promise<T>;
  extractIcon(path: string): Promise<string>;
  loadIcon(path: string): Promise<string>;
  fetchUrlIcon(url: string): Promise<string>;
  launch(path: string): Promise<void>;
  sendKey(keyId: string): Promise<void>;
}

export type FocusTrackerRange = "day" | "week" | "month";
export type FocusTrackerGroupBy = "app" | "title";
export type FocusTrackerIgnoreKind = "app" | "title";

/**
 * Reviewed host capability for foreground-focus history and its persisted
 * rules. The DTOs stay extension-owned; the SDK fixes the operations and
 * argument vocabulary without duplicating Focus Tracker's response schema.
 */
export interface FocusTrackerCapability {
  status<T = unknown>(): Promise<T>;
  summary<T = unknown>(range: FocusTrackerRange, groupBy: FocusTrackerGroupBy): Promise<T>;
  listHabitRules<T = unknown>(): Promise<T>;
  upsertHabitRule<T = unknown>(appName: string, limitMinutes: number): Promise<T>;
  deleteHabitRule(id: number): Promise<void>;
  recentApps<T = unknown>(limit?: number): Promise<T>;
  listIgnoreRules<T = unknown>(): Promise<T>;
  upsertIgnoreRule<T = unknown>(kind: FocusTrackerIgnoreKind, value: string): Promise<T>;
  deleteIgnoreRule(id: number): Promise<void>;
}

export type LlmChatRole = "system" | "user";

export interface LlmImage {
  mediaType: string;
  data: string;
}

export interface LlmChatMessage {
  role: LlmChatRole;
  content: string;
  images?: LlmImage[];
}

export interface LlmChatRequest {
  requestId: string;
  model: string;
  messages: LlmChatMessage[];
}

export type LlmStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "done" }
  | { type: "cancelled" }
  | { type: "error"; message: string };

/** Host Settings section a first-party widget may open, with an optional focus. */
export type SettingsOpenSection = "credentials" | "ai";

/**
 * Reviewed host surface for first-party LLM widgets.
 *
 * The model DTO stays extension-owned: the host only promises discovery and
 * a stream lifecycle. Credentials, provider selection and command names stay
 * inside the host's Rust LLM module.
 */
export interface LlmCapability {
  models<T = unknown>(): Promise<T>;
  quickModel<T = unknown>(): Promise<T>;
  stream(request: LlmChatRequest, onEvent: (event: LlmStreamEvent) => void): Promise<void>;
  cancel(requestId: string): Promise<void>;
  /**
   * Opens Settings → AI. `focus` is a catalog provider id (`anthropic`) so
   * that provider's tab is selected — the panel that actually accepts the key.
   */
  openSettings(section: "ai", focus?: string): void;
}

export interface WizardCompletionRequest {
  model: string;
  messages: unknown[];
  format?: string;
  /**
   * Which accounts the generated widget reads from, as qualified provider ids.
   *
   * Ids, never rendered descriptions: the host holds a block per provider and
   * splices the ones named here, so a caller cannot change what the model is
   * told about an account — only which accounts it is told about.
   */
  providers?: string[];
  /**
   * Reasoning effort, in the model's own vocabulary.
   *
   * A level, not a knob the caller invents: the host checks it against the
   * levels the catalog states for that model and refuses anything else, so this
   * cannot widen what a request may ask for. The two providers do not share a
   * vocabulary and no equivalence between them is published, so the value
   * travels as the catalog stated it.
   *
   * Absent leaves the provider's own default alone — which is **not** the same
   * as the lowest level. On OpenAI the vocabulary itself contains `none`, and
   * defaulting somebody to no reasoning because they did not choose is the
   * opposite of leaving it be.
   */
  effort?: string;
}

/**
 * Reviewed host surface for the first-party Widget Wizard.
 *
 * The extension receives operations, never Tauri command names. Runtime
 * package permissions are still derived and checked by the host/backend; the
 * manifest and credential arrays are only the host's typed command input.
 */
export interface WizardCapability {
  models<T = unknown>(): Promise<T>;
  complete<T = unknown>(request: WizardCompletionRequest): Promise<T>;
  providers<T = unknown>(): Promise<T>;
  providerStatus<T = unknown>(id: string): Promise<T>;
  developerConsentBypass(): Promise<boolean>;
  /**
   * Whether Developer Extensions is on — the gate the bypass lives behind.
   *
   * Read so the switch can be *offered* only where it can work. Without it the
   * only honest alternative is a checkbox that snaps back to off, which says
   * "no" without ever saying why.
   */
  developerExtensionsEnabled(): Promise<boolean>;
  /**
   * Arm or disarm that bypass from where the consent screen appears.
   *
   * A write, not a second setting: it is the same Developer Extensions switch
   * Settings owns, reachable from the one place somebody actually meets the
   * dialog it skips. The host refuses to arm it while Developer Extensions is
   * off, so this cannot become a consent bypass of its own.
   */
  setDeveloperConsentBypass(on: boolean): Promise<boolean>;
  /**
   * Opens a host Settings section. `focus` is a registry credential type
   * (`googleCalendarOAuth2`) for `"credentials"`, or a catalog provider id
   * (`anthropic`) for `"ai"` — never a secret.
   */
  openSettings(section: SettingsOpenSection, focus?: string): void;

  conversationsList<T = unknown>(): Promise<T>;
  conversationLoad<T = unknown>(id: string): Promise<T>;
  conversationSave(conversation: unknown): Promise<void>;
  conversationDelete(id: string): Promise<void>;

  runtimeScan<T = unknown>(): Promise<T>;
  runtimeInstalls<T = unknown>(): Promise<T>;
  runtimeEntryUrl(id: string, entry: string): string;
  /**
   * Enabling *is* the consent. The host derives which accounts that covers
   * from the declaration on disk and the approved providers — a caller cannot
   * name a credential here, and a grant is for one account, never a type.
   */
  runtimeSetEnabled(
    id: string,
    enabled: boolean,
    manifestPermissions: string[],
    contractGrant?: unknown,
  ): Promise<void>;
  runtimeReadPackage<T = unknown>(id: string): Promise<T>;
  runtimeDeletePackage(id: string): Promise<void>;
  /**
   * Write the widget's files to a zip somewhere outside the app.
   *
   * `null` means the save dialog was dismissed, which is not an error and must
   * not be reported as one. Everything else — where the files come from, where
   * they may be written — is the host's: this asks for one widget by id, and
   * the place is picked in a native dialog the extension never sees.
   */
  exportPackage(id: string): Promise<WidgetExportReport | null>;

  /**
   * Call one endpoint the package declares, and return what came back.
   *
   * For showing a person — and a model — the real shape of a response instead
   * of a guessed one. Reaches nothing the preview could not already reach: the
   * id passed here is the id the preview frame runs under.
   */
  endpointCall<T = unknown>(extId: string, endpointId: string, args: unknown): Promise<T>;
  drafts<T = unknown>(): Promise<T>;
  draftRead<T = unknown>(id: string): Promise<T>;
  /**
   * Open a saved widget for editing: its existing draft, or a fresh checkout.
   *
   * One call rather than "is there a draft?" followed by "then check one out",
   * because the gap between those two is exactly long enough for another client
   * to create the draft the first answer said did not exist — after which the
   * second call publishes a stale copy of the saved files over it, with a
   * revision that validates. The reply says which of the two happened, so the
   * editor can name whose changes it just opened.
   */
  draftOpen<T = unknown>(id: string): Promise<T>;
  onDraftChanged(handler: (event: DraftChanged) => void): Promise<() => void>;
  draftPresence<T = DraftPresence[]>(): Promise<T>;
  onDraftPresenceChanged(handler: (event: DraftPresence) => void): Promise<() => void>;
  draftWrite<T = unknown>(id: string, files: unknown, expectedRevision?: string | null): Promise<T>;
  /**
   * Install a draft, retiring the widget it was opened from.
   *
   * `replaces` is the id that widget is installed under *now*. It matters only
   * after a rename, and only the caller knows it: once the draft moved to its
   * new name, nothing on disk still ties the two together, and a promotion
   * without it installs a second copy of the same widget.
   */
  draftPromote<T = unknown>(id: string, replaces?: string | null): Promise<T>;
  draftDiscard(id: string): Promise<void>;
}

/** What the host wrote, reported back so the Wizard can name it. */
export interface WidgetExportReport {
  /** The archive on disk, including the `.zip` the host guarantees. */
  path: string;
  files: number;
  bytes: number;
  /**
   * Which copy travelled: the saved widget, or the draft that is newer than it.
   *
   * The host decides, because only it knows whether a draft exists — and an
   * archive of the draft announced as the saved widget is the one wrong answer
   * this whole reply exists to prevent.
   */
  source: "draft" | "widget";
}

/** Identity-only event emitted after a draft tree is written, discarded or promoted. */
export interface DraftChanged {
  id: string;
  revision: string | null;
  kind: "written" | "discarded" | "promoted";
  origin: "wizard" | "mcp";
  /** Known MCP client reported by its initialization handshake. */
  client?: "codex" | "claude" | null;
  /** Exact, sanitized clientInfo.name for transparent UI attribution. */
  clientName?: string | null;
  /**
   * The id this package answered to until this event, when it was renamed.
   *
   * A written draft is renamed by its own manifest; a promoted one retires the
   * name its installed copy had. `id` is always the name that is live now.
   */
  renamedFrom?: string;
}

/** Ephemeral MCP activity for one widget; never persisted as draft content. */
export interface DraftPresence {
  id: string;
  /** Known client kind, or null when the handshake name is not recognized. */
  client: "codex" | "claude" | null;
  /** Exact, sanitized clientInfo.name supplied by the MCP client. */
  clientName: string | null;
  /** Draft-scoped MCP tool that most recently touched this widget. */
  tool: string;
  /** True only while a Kavibay MCP tool request is executing. */
  active: boolean;
  lastSeen: number;
  /** Recent activity disappears after this host-owned timestamp. */
  expiresAt: number;
}

// === 4. PROVIDERS ===========================================================

export interface ProviderDefinition {
  name: string;
  displayName: string;
  /**
   * FINDING 12: one bit, not a flow. This used to be a `ProviderConnectionSpec`
   * naming an authorize url, a token url, a client id and scopes — a second
   * place to state something the host already states, and the two had already
   * drifted: it described PKCE with a loopback redirect while the app signs in
   * to tado° by device code, because tado° changed and the app followed.
   *
   * A provider author can neither act on that detail (no widget or provider
   * sees a token — finding 8) nor be trusted to set it (it decides where
   * credentials go — finding 11). Flow, endpoints, client id and scopes belong
   * next to the storage and the refresh, which is the host's credential
   * registry. What is left here is the only part a provider legitimately
   * declares about itself.
   */
  requiresCredential: boolean;
  /**
   * Which credential type the host attaches, from `credentials::registry`.
   *
   * A type id, never a secret and never a flow: the registry decides what
   * `githubPat` *is* — where it is obtained, refreshed and stored. This says
   * only which of those the provider wants, and it is the missing half that
   * lets the Rust allowlist be generated from this file instead of hand-kept
   * beside it (FINDINGS §28).
   *
   * Absent means no credential, which must agree with `requiresCredential`.
   */
  credentialType?: string;
  /**
   * Where this provider may send its credential.
   *
   * Exact hostnames for a public API (Linear, GitHub). `{ fromCredential }`
   * when the host is the instance URL the person typed (n8n) — the value is
   * not compiled in; the rule that it must come from the credential is.
   */
  hosts: string[] | { fromCredential: string };
  /**
   * Where this provider's *pictures* come from, which is almost never `hosts`.
   *
   * An API answers from `api.spotify.com` and hands back cover urls on
   * `i.scdn.co`. Those urls are public and carry no credential, so they are not
   * a second entry in `hosts` — putting them there would let a picture host
   * receive the token.
   *
   * A url in a field the result schema marks `image: true` is rewritten by the
   * host into a `kavibay-img:` url and fetched by the host process. So a widget
   * never opens a connection for a picture either, and its frame keeps
   * `connect-src 'none'` and an `img-src` with no network in it at all.
   *
   * Compiled in and PR-reviewed, like `hosts`: the url itself arrives inside a
   * vendor response and is therefore data, so the host re-checks it against
   * this list before fetching. A vendor that starts serving images from a host
   * nobody declared shows a placeholder, which is the right failure.
   */
  imageHosts?: string[];
  /**
   * Where this provider's records *live on the web* — the pages a person would
   * open to see the record itself. Linear answers from `api.linear.app` and its
   * issues live on `linear.app`.
   *
   * Compiled in and PR-reviewed, for the same reason as `imageHosts` and with
   * the same shape: the url arrives inside a vendor response and is therefore
   * data, so the host re-checks it against this list before handing it to the
   * OS browser. What this buys is that a *generated* widget can offer "open
   * this issue" at all — it cannot name the destination, only pass on a url the
   * reviewed provider already vouched for. Declaring nothing means this
   * provider's widgets open nothing, which is the right default.
   */
  linkHosts?: string[];
  queries: Record<string, ProviderQuery<any, any>>;
  actions: Record<string, ProviderAction<any, any>>;
}

export type QueryKey = ReadonlyArray<string | number>;

/**
 * What a query returns, in a form a picker and a model can read.
 *
 * DELIBERATELY SMALL. There is no union, no recursion and no map with dynamic
 * keys — and that omission is the design. A result that cannot be expressed
 * here is a result the provider has not normalized yet: tado° answers
 * `/zoneStates` with `{ "1": { sensorDataPoints: { insideTemperature: {…} } } }`,
 * keyed by ids that vary per account, and Home Assistant answers with entities
 * whose `attributes` differ per domain. Declaring either shape faithfully would
 * put one fact in two places with nothing checking them — findings 4 and 7 in a
 * new location. Splitting the query until it fits (`climateEntities` rather than
 * `entities`) is the intended pressure.
 *
 * `nullable` is not pedantry: a room that is offline has no temperature, and a
 * widget rendering `null` as a dash is correct behaviour rather than an error.
 */
export type ResultSchema =
  /**
   * `image: true` marks a string that is a picture url, and it is the only
   * thing that makes the host rewrite a value on the way out. Marking it is
   * what a widget needs instead of an `img-src` that reaches the network — see
   * `ProviderDefinition.imageHosts`.
   */
  | { type: "string" | "number" | "boolean"; nullable?: boolean; image?: boolean }
  | { type: "object"; fields: Record<string, ResultSchema>; nullable?: boolean }
  | { type: "list"; of: ResultSchema; nullable?: boolean };

export interface ProviderQuery<TArgs, TResult> {
  /**
   * What the query takes, in the same vocabulary an action's arguments use.
   *
   * tado° needs none, which is why this went unnoticed until the second
   * provider: GitHub wants an owner and a repo, Linear a team, Home Assistant a
   * domain. `ArgSpec.source` already covers the picker case — an enumerable
   * argument draws its values from another query on the same provider.
   *
   * Optional in the type so the reference fixtures keep their pinned shape;
   * required for a shipping provider, enforced by `providerSchema.assert.ts`.
   */
  args?: Record<string, ArgSpec>;
  /**
   * What the query gives back, after the provider has normalized it.
   *
   * The declaration is checked against the real response in dev builds, so it
   * cannot quietly drift from what `fetch` returns. Same optionality rule as
   * `args`.
   */
  result?: ResultSchema;
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
  /**
   * What this reads, in a sentence a user can answer yes or no to.
   *
   * FINDING 20 asked this of the consent dialog, which no longer lists
   * queries — the grant is per provider now, so nobody is ever asked "may this
   * widget use roomState?". The sentence still has two readers who cannot do
   * without it: the model authoring a widget, which picks a query by what it
   * says it reads, and the settings form. Both fall back to the bare name,
   * which works and reads badly — the correct pressure.
   */
  description?: string;
}

export interface ProviderAction<TArgs, TResult = void> {
  effect: "write" | "destructive" | "sensitive";
  args: Record<string, ArgSpec>;
  execute: (args: TArgs, host: ProviderHostContext) => Promise<TResult>;
  invalidates?: (args: TArgs) => QueryInvalidation[];
  /** What this does, for the Wizard and the schema doc. */
  description?: string;
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

/**
 * Privileged. Handed to provider code only. Never crosses the wire.
 *
 * FINDING 8: provider code cannot read its own credentials. The first version
 * handed out `getAccessToken()` / `getApiKey()`, which made invariant 3
 * ("secrets never cross the wire") a rule provider authors had to keep rather
 * than a property of the system — a provider holding a token string can put it
 * in a query parameter, a log line, or a returned object, and no reviewer
 * reliably catches that. The HTTP broker attaches auth host-side for the
 * provider's declared `hosts`, so the value is never in JS at all. What is left
 * is the only thing provider code legitimately needs to branch on: whether a
 * credential exists.
 */
export interface ProviderHostContext {
  http: ProviderHttpCapability;
  credentials: {
    isConnected(): Promise<boolean>;
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
  /**
   * The providers this widget reads from. All of them are required: the gate
   * does not mount until every one is connected.
   *
   * THIS LIST IS THE PERMISSION. There is no second, finer declaration —
   * `permissions` used to name individual queries and actions, and it is gone
   * (FINDINGS §27). The grant a person gives is "this widget may use tado°",
   * which is a sentence they can decide about; "may it use zoneStates?" is not.
   *
   * What that costs, stated rather than buried: a widget granted a provider may
   * call every query that provider declares. Writes are the part that would
   * hurt, and they are refused for generated widgets by the host on the trust
   * tier instead — see `Host.action`. Trust comes from the load source and
   * cannot be declared, so that is a stronger guarantee than the list was.
   *
   * A BARE LIST, NOT ROLES. Every provider named here is needed. The day a
   * widget wants one it can render without — GitHub issues visible while Linear
   * is unconnected — that arrives as an additional field with a default, which
   * changes no existing declaration. Additive later beats invented now.
   */
  requires?: { providers: ProviderId[] };
  capabilities?: CapabilityDeclaration;
  configuration?: Record<string, ConfigField>;
  /** Copy all persisted ctx.data cells when the host duplicates an instance. */
  duplicateData?: boolean;
  /** Optional per-cell normalization applied while duplicating persisted data. */
  duplicateDataTransform?: (key: string, value: unknown) => unknown;
  /** Optional JSON-only palette summary; must remain a cheap synchronous read. */
  palette?: WidgetPaletteDefinition;
  /** Rebuilds action chips from values already typed in the palette. */
  dynamicActionParams?: (
    actionId: string,
    values: readonly string[],
  ) => WidgetActionParam[];
  /**
   * Local palette action handlers, keyed by the id their manifest entry
   * declares. They normally operate on one widget instance; a declaration with
   * `needsInstance: false` receives an empty instance id for shared actions.
   * Either way they never cross a provider boundary — deliberately separate
   * from provider-backed commands.
   */
  actions?: Record<string, WidgetActionHandler<TConfig>>;
  component: WidgetComponent<TConfig>;
}

export interface WidgetActionParam {
  name: string;
  type: "text" | "number" | "enum";
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface WidgetActionContext<TConfig = Record<string, unknown>> {
  ctx: WidgetContext<TConfig>;
  args: Record<string, string>;
  /** Persist a configuration change made by the action before remounting. */
  setConfig: (values: Record<string, unknown>) => void;
}

/** Metadata for a standalone palette action, kept in manifest.json. */
export interface ExtensionActionDeclaration {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  params?: WidgetActionParam[];
  /** Standalone actions must be false; they never create a widget instance. */
  needsInstance?: false;
}

/** Context for an extension-level action. The host supplies no widget state. */
export interface ExtensionActionContext {
  args: Record<string, string>;
}

export type ExtensionActionHandler = (
  context: ExtensionActionContext,
) => void | Promise<void>;

/**
 * What a local action DOES. What it *is* — title, keywords, the parameter it
 * prompts for — is declared in `manifest.json` and paired with this by id.
 *
 * The split is the old extension format's, kept on purpose. An action is the
 * most consequential thing a widget offers, and the manifest is the file a
 * person reads to see what an extension offers; merging the two put the
 * interesting half where only a reader of TypeScript would find it. It is also
 * what leaves room for a package to declare actions later, since a package's
 * only declarative surface is JSON.
 *
 * Pairing is a hard error in both directions — see `bundledExtensions.ts`. The
 * old loader only warned, and a handler with no declaration was silently
 * dropped.
 */
export type WidgetActionHandler<TConfig = Record<string, unknown>> = (
  context: WidgetActionContext<TConfig>,
) => void | Promise<void>;

export interface WidgetPaletteView {
  value?: string;
  label?: string;
  tone?: "neutral" | "active" | "warn" | "done";
  placement?: "inline" | "detail";
}

export interface WidgetPaletteDefinition {
  inlineView?: (instanceId: string) => WidgetPaletteView | null;
  /** Plain text indexed by the host when building palette rows. */
  searchText?: (instanceId: string) => string;
  /** State-dependent buttons attached to one widget instance's palette row. */
  instanceActions?: (instanceId: string) => WidgetPaletteInstanceAction[];
}

export interface WidgetPaletteInstanceAction {
  id: string;
  title: string;
  param?: WidgetActionParam;
  run: (value: string) => void | Promise<void>;
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
  /** A select may keep more than one option in an array. */
  multiple?: boolean;
  /** Static options for a local select; provider-backed options use `source`. */
  options?: ConfigOption[];
  /** Options from a provider query. Cannot run before the provider connects. */
  source?: { provider: ProviderId; query: string };
}

export interface ConfigOption {
  value: string | number;
  label: string;
}

export interface WidgetInstance<TConfig = Record<string, unknown>> {
  id: WidgetInstanceId;
  definitionId: WidgetDefinitionId;
  configuration: TConfig;
  position: { x: number; y: number };
  size: { w: number; h: number };
  mode: "compact" | "expanded";
}

export interface WidgetDataStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
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
  data: WidgetDataStore;
  /** Extension-scoped persistence for intentionally shared widget state. */
  sharedData?: WidgetDataStore;
  http?: HttpCapability;
  /**
   * Calls one endpoint the package declared in `api.json`.
   *
   * The answer a widget gets for reaching an API nobody wrote a provider for.
   * A provider is the better shape when one exists — it brings a shared cache,
   * a call budget and a result somebody normalized — but "no provider exists"
   * used to mean "not possible", and for a public API that is the wrong answer.
   *
   * Never rejects for a remote failure: check `ok` and branch on `code`, the
   * same contract `kavibay.http` gives a standalone package.
   */
  endpoint?: EndpointCapability;
  aiUsage?: AiUsageCapability;
  notification?: NotificationCapability;
  systemInfo?: SystemInfoCapability;
  nowPlaying?: NowPlayingCapability;
  alarm?: AlarmCapability;
  openExternal?: OpenExternalCapability;
  clipboard?: ClipboardCapability;
  colorPicker?: ColorPickerCapability;
  image?: ImageCapability;
  launcher?: LauncherCapability;
  focusTracker?: FocusTrackerCapability;
  llm?: LlmCapability;
  wizard?: WizardCapability;
  /**
   * One handle per provider in `requires.providers`, keyed by id.
   *
   * A map rather than a single handle even when a widget names one provider:
   * `ctx.provider` plus `ctx.providers` would be two ways to say one thing,
   * and the single-provider spelling is the one that silently keeps working
   * while meaning something different once a second provider appears.
   */
  providers?: Record<ProviderId, WidgetProviderApi>;
}

export interface EndpointCapability {
  <T = unknown>(
    endpoint: string,
    args?: Record<string, unknown>,
  ): Promise<
    | { ok: true; status: number; data: T }
    | { ok: false; code: string; status?: number; detail?: string; retryAfterSecs?: number }
  >;
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
   * declaration of what it may reach. The first draft had none, which left only
   * two options: unrestricted commands, or commands that can never touch a
   * provider. `when` is visibility, not capability — the two must not be
   * conflated, and this is the capability half.
   */
  requires?: { providers: ProviderId[] };
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
  /**
   * One handle per provider in `requires.providers`, keyed by id.
   *
   * A map rather than a single handle even when a widget names one provider:
   * `ctx.provider` plus `ctx.providers` would be two ways to say one thing,
   * and the single-provider spelling is the one that silently keeps working
   * while meaning something different once a second provider appears.
   */
  providers?: Record<ProviderId, WidgetProviderApi>;
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
 * FINDING 7, AND WHAT SURVIVED OF IT.
 *
 * The original rule was that `provider.*` requests carry no provider id: the
 * host derived it from the caller's registered instance and its
 * `requires.provider`, because letting the widget name the provider would let
 * any widget address any connected provider and reduce `requires` to a
 * suggestion.
 *
 * The derivation stopped being possible when `requires` became a list — the
 * caller's identity no longer picks one provider out. So the id is on the wire,
 * and `JsonBridge` checks it against the caller's declared set before anything
 * else happens. What finding 7 forbids is an id the host takes on trust; an id
 * the host validates against a declaration it already holds is the same
 * guarantee reached the other way round. `ActionCommand.action.provider` has
 * named a provider in a declaration since the port for exactly this reason.
 *
 * The rule, restated so it survives the next change: **the wire never decides
 * anything. It may only say which of the caller's own declarations it means.**
 */
export type WidgetRequest =
  | { type: "provider.query"; provider: ProviderId; name: string; args: unknown }
  | { type: "provider.action"; provider: ProviderId; name: string; args: unknown }
  | {
      type: "provider.subscribe";
      provider: ProviderId;
      name: string;
      args: unknown;
      subscriptionId: string;
    }
  | { type: "provider.unsubscribe"; subscriptionId: string }
  | { type: "provider.status"; provider: ProviderId }
  | { type: "data.get"; key: string }
  | { type: "data.set"; key: string; value: unknown }
  | { type: "data.delete"; key: string }
  | { type: "http.get"; url: string; params?: Record<string, unknown> }
  | { type: "http.post"; url: string; body?: unknown }
  /**
   * Open one url in the person's browser.
   *
   * A url, not a choice among declarations, because the destination arrived
   * inside a provider's own response — the widget is passing data back, not
   * naming a place. The host answers whether one of *its* providers vouches for
   * that host, so a frame asking for somewhere else is refused rather than
   * trusted.
   */
  | { type: "openExternal"; url: string }
  /**
   * One endpoint from the package's own `api.json`, by id.
   *
   * Not a url: the package declared where it may go and the person reviewed
   * that list, so the wire names a choice among declarations rather than a
   * destination — the same rule the provider id follows two variants up.
   */
  | { type: "endpoint.call"; endpoint: string; args: Record<string, unknown> };

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
