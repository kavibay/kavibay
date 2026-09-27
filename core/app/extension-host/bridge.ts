import type {
  WidgetRequest, WidgetResponse, HostEvent, WidgetInstance, QueryState, Subscription,
  ProviderId,
} from "@sdk/contract/sdk";
import { Host } from "./runtime";
import type { GuestFault } from "@sdk/contract/sandbox-guest";
import { toProviderError } from "./query-cache";
import { redactArgs } from "./redact";

/**
 * Ported from docs/extension-sdk-reference/bridge.ts (Phase 1).
 * Per the port map this is "the only file that changes when sandboxing
 * changes" — the JSON transport below stands in for postMessage / iframe /
 * worker, and swapping one in must not reach into sdk.ts sections 4-6.
 *
 * FINDING 16: the ported version took the caller's identity from the request
 * payload. `WidgetRequest` in the contract deliberately carries no instance id
 * — it states the rule as "the wire never carries a value the host can derive
 * from the caller's identity" — and this file added one back and derived the
 * provider, the data scope, the permission list and the http capability from
 * it. Harmless while the only caller was a test making function calls; the
 * moment two sandboxes share a host, either can name the other and inherit
 * everything it is allowed to do.
 *
 * So a connection, not a payload field, is what says who is calling. A frame
 * gets a `BridgeConnection` bound to one instance at the time the host opens
 * it, and nothing in a request can change which instance that is.
 */

/**
 * One thing a widget asked the host to do, and what came back.
 *
 * WHY THE BRIDGE AND NOT THE WIDGET. A widget catches its own failures and
 * renders a sentence it wrote — "The WAQI station search could not be completed" —
 * which is the only thing anybody sees. The host knew it was
 * `unknown_endpoint`, or `consent_stale`, or an HTTP 401, and threw that away at
 * the boundary. This is the boundary, and every capability call crosses it, so
 * recording here catches all of them without a widget cooperating.
 *
 * Kept as plain data with no framework types: `bridge.ts` is the file the port
 * map says changes when sandboxing changes, and a debug panel must not be a
 * reason it grows a dependency.
 */
export interface WidgetCall {
  at: number;
  instanceId: string;
  /** `provider.query`, `endpoint.call`, `data.set`, … — the request type. */
  kind: string;
  /** Query name, endpoint id, storage key: what the request was about. */
  target: string;
  /** Arguments as sent, for reproducing the call. */
  args?: unknown;
  ok: boolean;
  /** `unknown_endpoint`, `permission-denied`, `http_error`, … */
  code?: string;
  detail?: string;
  status?: number;
  ms: number;
}

/**
 * The host half. Holds the instance map — the host's own record of which frame
 * is which — and hands out one connection per frame.
 */
export class JsonBridge {
  private instances = new Map<string, WidgetInstance<any>>();

  /**
   * `readonly` rather than `private`: the frame that mounts a package needs the
   * registry to tell the guest which providers it declares, and reaching it
   * through the bridge keeps that answer coming from the same object that
   * enforces it.
   */
  /**
   * Set by whoever wants to watch what widgets do — the Wizard's debug panel.
   *
   * One hook on the bridge rather than a parameter on every connection: the
   * panel is interested in a frame that has not been created yet, and a
   * subscriber that has to exist first would miss the calls a widget makes
   * while it mounts, which are the ones that fail.
   */
  onCall?: (call: WidgetCall) => void;

  /**
   * The same, for what a frame reports about itself rather than what it asked
   * for.
   *
   * A fault crosses no capability boundary — it is the browser's own message
   * about code that threw, relayed by the guest — so it is deliberately not a
   * `WidgetCall` and nothing here derives anything from it. It rides on the
   * bridge only because the bridge is the object every sandboxed frame already
   * holds, which keeps `SandboxedWidgetFrame` free of the app-wide singleton
   * the panel lives in.
   */
  onFault?: (instanceId: string, fault: GuestFault) => void;

  constructor(readonly host: Host) {}

  register(i: WidgetInstance<any>) { this.instances.set(i.id, i); }
  unregister(instanceId: string) { this.instances.delete(instanceId); }

  /**
   * Opens the channel for one widget instance. The instance is resolved here,
   * once, from the host's own map — so per-request lookups never consult
   * anything the caller controls.
   *
   * `emit` is this connection's event channel. Giving every connection its own
   * is what keeps one frame's subscription updates from being delivered to
   * another frame.
   */
  connect(
    instanceId: string,
    emit: (eventJson: string) => void,
    /**
     * Every query this frame opens, reported as it moves. The runtime drives
     * the skeleton and the error panel from this rather than from anything the
     * guest says about itself — the states are already crossing here, so there
     * is no reason to ask.
     */
    onQueryState?: (slot: string, state: QueryState<unknown>) => void,
  ): BridgeConnection {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error(`no such widget instance ${instanceId}`);
    return new BridgeConnection(this, this.host, instance, emit, onQueryState);
  }
}

/** One frame's channel. Everything it may reach is fixed at construction. */
export class BridgeConnection {
  private subs = new Map<string, Subscription>();
  private closed = false;

  constructor(
    private bridge: JsonBridge,
    private host: Host,
    private instance: WidgetInstance<any>,
    private emit: (eventJson: string) => void,
    private onQueryState?: (slot: string, state: QueryState<unknown>) => void,
  ) {}

  /** Matches the cache's notion of identity, and `observeQueries`'s in-process. */
  private slot(name: string, args: unknown) {
    return `${name}:${JSON.stringify(args ?? {})}`;
  }

  async handle(requestJson: string): Promise<string> {
    // A torn-down frame can still have a message in flight, and answering it
    // would resurrect subscriptions `dispose` just cleaned up.
    if (this.closed) return JSON.stringify(refused("connection closed"));
    let req: WidgetRequest;
    try {
      req = JSON.parse(requestJson) as WidgetRequest;
    } catch {
      return JSON.stringify(refused("unparseable request"));
    }
    return JSON.stringify(await this.dispatch(req));
  }

  /**
   * Unsubscribes everything this frame opened. Not optional book-keeping: a
   * subscribed query schedules its own refresh (finding 15), so a leaked
   * subscription keeps calling the provider on behalf of a widget that is gone.
   */
  dispose() {
    this.closed = true;
    for (const sub of this.subs.values()) sub.unsubscribe();
    this.subs.clear();
  }

  private async dispatch(req: WidgetRequest): Promise<WidgetResponse> {
    const started = Date.now();
    const response = await this.run(req);
    this.report(req, response, Date.now() - started);
    return response;
  }

  /**
   * Turns one request and its answer into a record.
   *
   * `endpoint.call` needs unwrapping: the wire call succeeded, and the failure
   * — `permission_denied`, `http_error` with a status — is inside the value.
   * Logging it as `ok` would hide exactly the errors this exists for.
   */
  private report(req: WidgetRequest, response: WidgetResponse, ms: number) {
    const onCall = this.bridge.onCall;
    if (!onCall) return;

    const envelope =
      response.ok && req.type === "endpoint.call" && typeof response.value === "object"
        ? (response.value as { ok?: boolean; code?: string; detail?: string; status?: number } | null)
        : null;

    onCall({
      at: Date.now(),
      instanceId: this.instance.id,
      kind: req.type,
      target: targetOf(req),
      args: redactArgs(req),
      ok: response.ok && envelope?.ok !== false,
      code: response.ok ? envelope?.code : response.error.kind,
      detail: response.ok ? envelope?.detail : response.error.message,
      status: envelope?.status,
      ms,
    });
  }

  private async run(req: WidgetRequest): Promise<WidgetResponse> {
    try {
      switch (req.type) {
        case "provider.query": {
          const slot = this.slot(req.name, req.args);
          this.onQueryState?.(slot, { status: "loading" });
          try {
            const value = await this.host.query(
              this.provider(req.provider),
              req.name,
              req.args,
              this.caller(),
            );
            this.onQueryState?.(slot, { status: "success", data: value, isStale: false, updatedAt: Date.now() });
            return ok(value);
          } catch (err) {
            this.onQueryState?.(slot, { status: "error", error: toProviderError(err) });
            throw err;
          }
        }
        case "provider.action":
          return ok(
            await this.host.action(
              this.provider(req.provider),
              req.name,
              req.args,
              this.caller(),
            ),
          );
        case "provider.subscribe": {
          // The guest picks the id, so it can reuse one. Dropping the previous
          // subscription rather than overwriting the handle keeps that from
          // leaking a refresh timer the frame can no longer reach.
          this.subs.get(req.subscriptionId)?.unsubscribe();
          const sub = await this.host.subscribe(
            this.provider(req.provider), req.name, req.args,
            (state: QueryState<unknown>) => {
              if (this.closed) return;
              this.onQueryState?.(this.slot(req.name, req.args), state);
              const ev: HostEvent = { type: "query.update", subscriptionId: req.subscriptionId, state };
              this.emit(JSON.stringify(ev));
            },
            this.caller(),
          );
          if (this.closed) { sub.unsubscribe(); return refused("connection closed"); }
          this.subs.set(req.subscriptionId, sub);
          return ok({ subscriptionId: req.subscriptionId });
        }
        case "provider.unsubscribe":
          // Only this connection's map is consulted, so a guessed id belonging
          // to another frame finds nothing here.
          this.subs.get(req.subscriptionId)?.unsubscribe();
          this.subs.delete(req.subscriptionId);
          return ok(null);
        case "provider.status":
          return ok(this.host.providerStatus(this.provider(req.provider), this.instance.id));
        case "data.get":
          return ok(await this.scope().get(req.key));
        case "data.set":
          return ok(await this.scope().set(req.key, req.value));
        case "data.delete":
          return ok(await this.scope().delete(req.key));
        case "endpoint.call":
          /**
           * The extension id is bound from the connection, never taken from the
           * payload — the frame chooses which of its own endpoints, and nothing
           * else. Rust re-checks the grant, the consent hash, the allowlist and
           * the budget, so this adds no decision of its own.
           */
          return ok(
            await this.host.callEndpoint(this.packageId(), req.endpoint, req.args ?? {}, this.instance.id),
          );
        case "openExternal":
          /**
           * The definition id is bound from the connection, exactly as the
           * extension id is for `endpoint.call` — the frame supplies the url
           * and nothing else. Which providers it declared, and therefore which
           * hosts they vouch for, is the host's fact about this widget.
           */
          return ok(
            await this.host.openExternalVouched(this.instance.definitionId, req.url),
          );
        case "http.get":
          return ok(await this.http().get(req.url, req.params as any));
        case "http.post":
          return ok(await this.http().post(req.url, req.body));
      }
      return refused("unknown request");
    } catch (err) {
      return { ok: false, error: toProviderError(err) };
    }
  }

  private definition() {
    const found = this.host.registry.widget(this.instance.definitionId);
    if (!found) throw new Error(`unknown widget ${this.instance.definitionId}`);
    return found;
  }

  /**
   * FINDING 7, after `requires` became a list.
   *
   * The id used to be derived from what this connection is. With more than one
   * declared provider the connection no longer picks one out, so the request
   * says which — and this is the check that keeps that from being a grant. The
   * payload may only *select* among the caller's own declarations; anything
   * else is refused before the host is touched, so a widget still cannot reach
   * a provider it did not declare, whatever it puts on the wire.
   *
   * Note what is NOT consulted here: the registry's list of connected
   * providers. The question is never "does this provider exist" but "did this
   * caller declare it", and answering the first would be the reduction of
   * `requires` to a suggestion that finding 7 warned about.
   */
  private provider(requested: ProviderId) {
    const declared = this.definition().widget.requires?.providers ?? [];
    if (declared.length === 0) throw new Error("caller declares no provider");
    if (!declared.includes(requested)) {
      throw new Error(`caller does not declare ${requested}`);
    }
    return requested;
  }

  /**
   * The grant for the provider this connection addresses, never the whole map.
   *
   * `provider()` above and this lookup have to agree, and they do because both
   * start from the same definition — a grant written for another provider is
   * not reachable from here, it is simply a key this never looks up.
   */
  /**
   * Who this connection is, for the host's caller rules.
   *
   * The trust tier comes from the registry entry, never from the payload — a
   * frame cannot describe itself as reviewed.
   */
  /**
   * The package **directory**, which is what the Rust broker resolves.
   *
   * NOT `ext.id`. That is the registry's derived id — `local.test123` for a
   * generated package, `kavibay.tado` for a bundled one — and the namespace
   * in front of it exists precisely so a package cannot name itself into a
   * trust tier (invariant 1). The broker knows nothing of tiers; it looks up a
   * folder. Passing the derived id found no folder, reported "ships no
   * api.json", and sent somebody looking for a file that was sitting right
   * there.
   *
   * `manifest.name` is the right value and not a guess: the Rust scanner
   * refuses any package whose `manifest.name` differs from its directory
   * (`name_folder_mismatch`), so the two are the same string by construction.
   */
  private packageId() {
    return this.definition().ext.manifest.name;
  }

  private caller() {
    const found = this.definition();
    return {
      extensionId: found.ext.id,
      trust: found.ext.trust,
      instanceId: this.instance.id,
      actions: found.widget.requires?.actions ?? {},
    };
  }

  private scope() {
    return this.host.data.scoped(this.instance.id);
  }

  private http() {
    const found = this.definition();
    if (!found.widget.capabilities?.http) throw new Error("http capability not declared");
    return this.host.httpFor(found.ext.id, found.widget.capabilities.http as any);
  }
}

const ok = (value: unknown): WidgetResponse => ({ ok: true, value: JSON.parse(JSON.stringify(value ?? null)) });
const refused = (message: string): WidgetResponse => ({ ok: false, error: { kind: "provider-error", message } });

/**
 * The widget-side half moved to `@sdk/contract/sandbox-guest`. It runs inside a
 * package, and a runtime shipped into a third-party package cannot be GPL.
 * Re-exported here so the existing import path keeps working — a pointer, not a
 * second copy.
 */
export { sandboxContext } from "@sdk/contract/sandbox-guest";

/** What the request was about, for one readable column. */
function targetOf(req: WidgetRequest): string {
  switch (req.type) {
    case "provider.query":
    case "provider.action":
    case "provider.subscribe":
      return `${req.provider}.${req.name}`;
    case "provider.status":
      return req.provider;
    case "provider.unsubscribe":
      return req.subscriptionId;
    case "endpoint.call":
      return req.endpoint;
    case "data.get":
    case "data.set":
    case "data.delete":
      return req.key;
    case "openExternal":
    case "http.get":
    case "http.post":
      return req.url;
  }
}
