// SPDX-License-Identifier: MIT
import type {
  HostEvent, ProviderError, ProviderId, ProviderStatus, QueryState, WidgetContext, WidgetInstance,
  WidgetProviderApi, WidgetRequest, WidgetResponse,
} from "./sdk";

/**
 * The guest half of the wire boundary, and the message shapes both halves use.
 *
 * MIT and here rather than in the host, because this is the code that runs
 * inside a package — third-party or generated — and a runtime shipped into
 * somebody else's package cannot be GPL. The host half stays in
 * `core/app/extension-host/`, which is where it belongs: it holds the
 * connection and every decision that matters.
 *
 * The message shapes live on this side too. They are the contract between the
 * halves, and a wire protocol described in two places drifts.
 */

const REQUEST = "kavibay.widget.request";
const RESPONSE = "kavibay.widget.response";
const EVENT = "kavibay.widget.event";
const READY = "kavibay.widget.ready";
const INIT = "kavibay.widget.init";
const THEME = "kavibay.widget.theme";
const MOUNTED = "kavibay.widget.mounted";
const FAILED = "kavibay.widget.failed";
const FAULT = "kavibay.widget.fault";

export interface RequestMessage { kind: typeof REQUEST; id: string; payload: string }
export interface ResponseMessage { kind: typeof RESPONSE; id: string; payload: string }
export interface EventMessage { kind: typeof EVENT; payload: string }

/**
 * Shape checks rather than trust. Anything may postMessage into a window —
 * Vite's HMR client does it on every reload — so a transport that assumes the
 * messages it sees are its own will try to parse someone else's.
 */
export const isRequest = (m: unknown): m is RequestMessage =>
  isRecord(m) && m.kind === REQUEST && typeof m.id === "string" && typeof m.payload === "string";

export const isResponse = (m: unknown): m is ResponseMessage =>
  isRecord(m) && m.kind === RESPONSE && typeof m.id === "string" && typeof m.payload === "string";

export const isEvent = (m: unknown): m is EventMessage =>
  isRecord(m) && m.kind === EVENT && typeof m.payload === "string";

export const requestMessage = (id: string, payload: string): RequestMessage =>
  ({ kind: REQUEST, id, payload });

export const responseMessage = (id: string, payload: string): ResponseMessage =>
  ({ kind: RESPONSE, id, payload });

export const eventMessage = (payload: string): EventMessage => ({ kind: EVENT, payload });

function isRecord(m: unknown): m is Record<string, unknown> {
  return typeof m === "object" && m !== null;
}

/**
 * The handshake. A frame's script runs when the browser gets to it, so the host
 * cannot know when to speak first — the guest says when it is listening and the
 * host answers with what it is.
 *
 * The guest learning its own identity from the host is the right direction: the
 * host is authoritative about which instance a frame is, and the frame is
 * authoritative about nothing. See finding 16.
 */
export const readyMessage = (): unknown => ({ kind: READY });
export const isReady = (m: unknown): boolean => isRecord(m) && m.kind === READY;

/**
 * Init carries the declared provider ids alongside the instance.
 *
 * The frame cannot read a manifest, so without this it has no way to know
 * which handles to build once `requires` is a list. Told by the host, in the
 * same direction as the instance itself (finding 16) — and told, not trusted:
 * the bridge re-checks every request against the declaration, so a frame that
 * ignored this list and asked for something else gets refused. What it buys is
 * a `ctx.providers` a widget can enumerate, not a permission.
 */
export const initMessage = (
  instance: WidgetInstance<unknown>,
  providers: readonly string[] = [],
): unknown => ({ kind: INIT, payload: JSON.stringify({ instance, providers }) });

export interface SandboxInit {
  instance: WidgetInstance<unknown>;
  providers: string[];
}

/** Returns what the host named, or undefined if this is not an init. */
export function readInit(m: unknown): SandboxInit | undefined {
  if (!isRecord(m) || m.kind !== INIT || typeof m.payload !== "string") return undefined;
  try {
    const parsed = JSON.parse(m.payload) as Partial<SandboxInit>;
    if (!parsed || typeof parsed !== "object" || !parsed.instance) return undefined;
    return {
      instance: parsed.instance as WidgetInstance<unknown>,
      providers: Array.isArray(parsed.providers)
        ? parsed.providers.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return undefined;
  }
}

/**
 * The guest's own lifecycle, and the only thing the host takes its word for.
 *
 * That is not a hole. Query states already cross the connection, so the host
 * reads those itself; what is left is "did setup finish", which is a fact about
 * the guest and nobody else. A guest that lies here draws a skeleton over its
 * own widget. It cannot use it to reach anything.
 */
export const mountedMessage = (): unknown => ({ kind: MOUNTED });
export const isMounted = (m: unknown): boolean => isRecord(m) && m.kind === MOUNTED;

export const failedMessage = (error: ProviderError): unknown =>
  ({ kind: FAILED, payload: JSON.stringify(error) });

/**
 * Returns the reported failure, or undefined if this is not one.
 *
 * A message that *is* a failure always yields an error, whatever its payload
 * turns out to be. Returning undefined for a malformed one would tell the frame
 * "not a failure", and the frame would go on holding a skeleton over a widget
 * that has already given up.
 *
 * The contents are shaped rather than trusted: this reaches the error panel,
 * which switches on `kind`, and a shape it has no branch for is what crashed it
 * once already.
 */
export function readFailure(m: unknown): ProviderError | undefined {
  if (!isRecord(m) || m.kind !== FAILED || typeof m.payload !== "string") return undefined;
  const unknownFailure: ProviderError = {
    kind: "provider-error",
    message: "the widget failed to start",
  };
  try {
    const parsed: unknown = JSON.parse(m.payload);
    if (typeof parsed !== "object" || parsed === null) return unknownFailure;
    const error = parsed as Partial<ProviderError>;
    return typeof error.kind === "string" && typeof error.message === "string"
      ? (error as ProviderError)
      : unknownFailure;
  } catch {
    return unknownFailure;
  }
}

// === FAULTS =================================================================

/**
 * Something that went wrong *inside* the frame, reported so the host can show
 * it.
 *
 * WHY THIS EXISTS. `failedMessage` covers one case — `setup` or `render` threw
 * — and nothing else. A package whose top-level script throws never reaches
 * `define`, so the host waits on a handshake that will not come and holds a
 * skeleton forever. A callback that throws ten seconds after mount, or a
 * rejected promise nobody awaited, produces nothing at all. In every one of
 * those the browser writes a perfectly good message to a console inside a
 * sandboxed frame that nobody can open.
 *
 * NOT A `WidgetResponse`, and not a bridge call. A fault crosses no capability
 * boundary and grants nothing; it is the guest telling the host what the
 * browser already told the guest. The host treats it as text to display and
 * derives nothing from it — which is what makes it safe to accept from code
 * that is, by construction, the thing being debugged.
 */
export interface GuestFault {
  /** How it surfaced: uncaught throw, unhandled rejection, or `console.error`. */
  source: "error" | "rejection" | "console";
  message: string;
  /** `widget.js:42:9`, when the browser says. */
  where?: string;
  stack?: string;
}

export const faultMessage = (fault: GuestFault): unknown =>
  ({ kind: FAULT, payload: JSON.stringify(fault) });

/**
 * Returns the reported fault, or undefined if this is not one.
 *
 * Shaped rather than trusted, for the same reason `readFailure` is: this
 * reaches a panel, from a document that is by definition running code nobody
 * has reviewed. A `source` outside the three known values is dropped to
 * `"error"` instead of being passed through to a `v-if` chain that has no
 * branch for it.
 */
export function readFault(m: unknown): GuestFault | undefined {
  if (!isRecord(m) || m.kind !== FAULT || typeof m.payload !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(m.payload);
    if (!isRecord(parsed) || typeof parsed.message !== "string") return undefined;
    const source = parsed.source;
    return {
      source: source === "rejection" || source === "console" ? source : "error",
      message: parsed.message,
      where: typeof parsed.where === "string" ? parsed.where : undefined,
      stack: typeof parsed.stack === "string" ? parsed.stack : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * How many faults one document may report before it goes quiet.
 *
 * A widget with a throwing `setInterval` produces one of these every frame.
 * The cap is on the guest side rather than only in the host's log because the
 * cost being avoided is the `postMessage` traffic, not the storage — and the
 * first few are the ones that say anything anyway.
 */
export const FAULT_LIMIT = 50;

const MESSAGE_MAX = 400;
const STACK_MAX = 800;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Anything at all, as one line. `JSON.stringify` throws on cycles. */
function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function stackOf(value: unknown): string | undefined {
  return value instanceof Error && typeof value.stack === "string"
    ? clip(value.stack, STACK_MAX)
    : undefined;
}

/**
 * `widget.js:42:9` — the basename, not the URL.
 *
 * Every file in a package is served from the same package root, so the prefix
 * is identical on every line and buys nothing in a panel that is 300 pixels
 * wide on a good day.
 */
function whereOf(event: any): string | undefined {
  const file = typeof event?.filename === "string" ? event.filename : "";
  if (!file) return undefined;
  const name = file.split("/").pop() || file;
  if (typeof event?.lineno !== "number" || event.lineno === 0) return name;
  return typeof event?.colno === "number" && event.colno !== 0
    ? `${name}:${event.lineno}:${event.colno}`
    : `${name}:${event.lineno}`;
}

/** Just enough of a window to listen on. */
export interface FaultTarget {
  addEventListener(type: string, listener: (event: any) => void, capture?: boolean): void;
}

/** Just enough of a console to wrap. */
export interface FaultConsole {
  error(...args: unknown[]): void;
}

/**
 * Starts reporting this document's failures through `report`.
 *
 * MUST RUN BEFORE THE PACKAGE'S OWN SCRIPT. A listener installed afterwards
 * misses the parse error and the top-level throw, which are precisely the
 * failures that leave no other trace — the widget never registers, so the host
 * never hears anything at all.
 *
 * The target and the console are injected rather than reached for, so the
 * behaviour can be checked without a DOM — the same reason `readTheme` takes a
 * `get`.
 *
 * `console.error` is wrapped rather than replaced: the original still runs, so
 * a person with devtools open on the frame loses nothing. It is included at all
 * because a generated widget's usual shape is `catch (e) { console.error(e) }`,
 * and that catch is where the useful sentence goes to die.
 */
export function installFaultReporting(
  target: FaultTarget,
  consoleObject: FaultConsole,
  report: (fault: GuestFault) => void,
): void {
  let sent = 0;
  let reporting = false;

  const send = (fault: GuestFault) => {
    // Reentrancy: `report` posts a message, and posting can throw. Without this
    // guard a reporter that fails through `console.error` would report its own
    // failure, forever.
    if (reporting || sent >= FAULT_LIMIT) return;
    reporting = true;
    sent += 1;
    try {
      report(
        sent === FAULT_LIMIT
          ? { ...fault, message: `${fault.message} — further faults are not reported` }
          : fault,
      );
    } catch {
      // A reporter that throws must not become the thing being reported.
    } finally {
      reporting = false;
    }
  };

  target.addEventListener("error", (event: any) => {
    const message = typeof event?.message === "string" && event.message
      ? event.message
      : describe(event?.error);
    send({
      source: "error",
      message: clip(message, MESSAGE_MAX),
      where: whereOf(event),
      stack: stackOf(event?.error),
    });
  });

  target.addEventListener("unhandledrejection", (event: any) => {
    send({
      source: "rejection",
      message: clip(describe(event?.reason), MESSAGE_MAX),
      stack: stackOf(event?.reason),
    });
  });

  /**
   * A `<script src>` or `<img>` that did not load — third argument `true`.
   *
   * Resource errors do not bubble, so the listener above never sees them; the
   * capture phase is the only way to hear one at the window. They are also not
   * `ErrorEvent`s and carry no message, only the element that failed.
   *
   * Worth the extra listener because "the file the generated HTML references
   * does not exist" is one of the most common ways a fresh package is blank,
   * and it is otherwise completely silent — no throw, no rejection, nothing.
   *
   * The url check is what separates the two: a real runtime error reaches this
   * listener too, targeted at the window, which has no `src` or `href`.
   */
  target.addEventListener(
    "error",
    (event: any) => {
      const element = event?.target;
      const url = element?.src ?? element?.href;
      if (typeof url !== "string" || url === "") return;
      send({ source: "error", message: clip(`failed to load ${url}`, MESSAGE_MAX) });
    },
    true,
  );

  const original = consoleObject.error.bind(consoleObject);
  consoleObject.error = (...args: unknown[]) => {
    send({ source: "console", message: clip(args.map(describe).join(" "), MESSAGE_MAX) });
    original(...args);
  };
}

/**
 * The design tokens, pushed. Separate from init because the theme changes while
 * the app runs and init happens once — a widget must not have to reload to
 * follow a colour-mode switch.
 */
export const themeMessage = (theme: Record<string, string>): unknown =>
  ({ kind: THEME, payload: JSON.stringify(theme) });

/** Returns the pushed tokens, or undefined if this is not a theme message. */
export function readThemeMessage(m: unknown): Record<string, unknown> | undefined {
  if (!isRecord(m) || m.kind !== THEME || typeof m.payload !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(m.payload);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

// === THEME ==================================================================

/**
 * The design tokens a sandboxed widget may rely on.
 *
 * A separate document inherits nothing, so a widget in a frame renders in the
 * browser's defaults until the host hands it the theme. This is that hand-off.
 *
 * A curated list rather than everything the app defines, and that is the point:
 * it is the set a widget author can depend on, so it can be documented and kept
 * stable while the host's internals move. A widget reaching for a token that is
 * not here should be a conversation about widening the list, not a silent break
 * the next time a variable is renamed.
 */
export const SANDBOX_THEME_TOKENS = [
  // Base tints. Everything below derives from these, and pushing them too means
  // a token that arrives with its `var()` still unsubstituted resolves anyway.
  "--fg-rgb",
  "--inset-rgb",
  "--surface-bg-rgb",

  "--font-family",

  "--text",
  "--text-muted",
  "--text-faint",

  "--border",
  "--border-strong",
  "--fill",
  "--fill-hover",
  "--inset-bg",

  "--surface-radius",
  // So the guest's form controls and scrollbars match the host rather than
  // rendering in the opposite scheme.
  "--native-color-scheme",
] as const;

export type SandboxTheme = Record<string, string>;

/**
 * Reads the current values through whatever the caller provides.
 *
 * Injected rather than touching `document` directly so the shape of this is
 * testable without a DOM — the same reason the data store takes a backend.
 */
export function readTheme(get: (token: string) => string): SandboxTheme {
  const theme: SandboxTheme = {};
  for (const token of SANDBOX_THEME_TOKENS) {
    const value = get(token).trim();
    // An empty value means the token is not defined in this document. Passing
    // it on would set an empty custom property in the guest, which shadows the
    // guest's own fallback with nothing.
    if (value) theme[token] = value;
  }
  return theme;
}

/**
 * Applies a received theme, and reports how many tokens were written.
 *
 * Only the tokens on the list are applied. A host is not an attacker here, but
 * a frame that writes whatever arrives has no answer for the day one of these
 * channels is fed by something less careful.
 */
export function applyTheme(
  set: (token: string, value: string) => void,
  theme: unknown,
): number {
  if (typeof theme !== "object" || theme === null) return 0;
  let applied = 0;
  for (const token of SANDBOX_THEME_TOKENS) {
    const value = (theme as Record<string, unknown>)[token];
    if (typeof value !== "string" || value === "") continue;
    set(token, value);
    applied++;
  }
  return applied;
}

// === THE GUEST PORT =========================================================

/**
 * The guest end of the channel. Builds the same `WidgetContext` a widget gets
 * in the host document, so a widget cannot tell which side of the boundary it
 * is on — the property the whole split rests on.
 */
export class SandboxGuestPort {
  private pending = new Map<string, (payload: string) => void>();
  private onEvent?: (eventJson: string) => void;
  private seq = 0;
  private disposed = false;

  constructor(private post: (message: unknown) => void) {}

  accept(data: unknown): boolean {
    if (isResponse(data)) {
      // An id nobody is waiting for is dropped rather than trusted. The host
      // echoes ids back, so a duplicate can only come from a guest that reused
      // one, and resolving a stale request with a fresh answer is worse than
      // letting it stay unanswered.
      const settle = this.pending.get(data.id);
      if (settle) {
        this.pending.delete(data.id);
        settle(data.payload);
      }
      return true;
    }
    if (isEvent(data)) {
      this.onEvent?.(data.payload);
      return true;
    }
    return false;
  }

  context<T>(instance: WidgetInstance<T>, providers: readonly string[] = []): WidgetContext<T> {
    return sandboxContext(
      instance,
      (requestJson) => this.send(requestJson),
      (cb) => { this.onEvent = cb; },
      providers,
    );
  }

  private send(requestJson: string): Promise<string> {
    if (this.disposed) return Promise.reject(new Error("sandbox closed"));
    const id = `r${++this.seq}`;
    return new Promise<string>((resolve) => {
      this.pending.set(id, resolve);
      this.post(requestMessage(id, requestJson));
    });
  }

  /**
   * Every pending call settles, as an error rather than a silence. A widget
   * awaiting a reply that never comes is a widget stuck on the host's skeleton
   * with nothing saying why.
   */
  dispose() {
    this.disposed = true;
    for (const settle of this.pending.values()) {
      settle(JSON.stringify({ ok: false, error: { kind: "disconnected", message: "sandbox closed" } }));
    }
    this.pending.clear();
  }
}

/**
 * Builds a `WidgetContext` over a string transport. It only ever sees strings.
 *
 * No instance id goes out with a request: the host knows which connection this
 * is, and a value the host can derive is a value a guest could forge.
 * Finding 16.
 */
export function sandboxContext<T>(
  instance: WidgetInstance<T>,
  send: (requestJson: string) => Promise<string>,
  onEvent: (cb: (eventJson: string) => void) => void,
  declaredProviders: readonly string[] = [],
): WidgetContext<T> {
  const handlers = new Map<string, (s: QueryState<unknown>) => void>();
  onEvent((json) => {
    const ev = JSON.parse(json) as HostEvent;
    if (ev.type === "query.update") handlers.get(ev.subscriptionId)?.(ev.state);
  });

  const call = async <R>(req: WidgetRequest): Promise<R> => {
    const res = JSON.parse(await send(JSON.stringify(req))) as WidgetResponse<R>;
    if (!res.ok) throw res.error;
    return res.value;
  };

  let n = 0;
  /** One handle per declared provider, each closing over its own id. */
  const apiFor = (provider: ProviderId): WidgetProviderApi => ({
    query: (name, args) => call({ type: "provider.query", provider, name, args: args ?? {} }),
    action: (name, args) => call({ type: "provider.action", provider, name, args: args ?? {} }),
    subscribe: async (name, args, onState) => {
      const subscriptionId = `${instance.id}-${++n}`;
      handlers.set(subscriptionId, onState as (s: QueryState<unknown>) => void);
      await call({ type: "provider.subscribe", provider, name, args: args ?? {}, subscriptionId });
      return {
        unsubscribe: () => {
          handlers.delete(subscriptionId);
          void call({ type: "provider.unsubscribe", subscriptionId });
        },
      };
    },
    status: async () => call<ProviderStatus>({ type: "provider.status", provider }),
    onStatusChange: () => ({ unsubscribe: () => {} }),
  });

  const providers = Object.fromEntries(
    declaredProviders.map((id) => [id, apiFor(id)]),
  ) as Record<ProviderId, WidgetProviderApi>;

  return {
    instanceId: instance.id,
    config: instance.configuration,
    data: {
      get: (key) => call({ type: "data.get", key }),
      set: (key, value) => call({ type: "data.set", key, value }),
      delete: (key) => call({ type: "data.delete", key }),
    },
    http: {
      get: (url, params) => call({ type: "http.get", url, params }),
      post: (url, body) => call({ type: "http.post", url, body }),
    },
    endpoint: ((endpoint: string, args?: Record<string, unknown>) =>
      call({ type: "endpoint.call", endpoint, args: args ?? {} })) as WidgetContext<T>["endpoint"],
    providers,
  };
}
