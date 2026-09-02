import type {
  WidgetRequest, WidgetResponse, HostEvent, WidgetInstance, WidgetContext,
  WidgetProviderApi, QueryState, ProviderStatus, Subscription,
} from "../sdk.js";
import { Host } from "./runtime.js";
import { toProviderError } from "./query-cache.js";

/**
 * The transport. Every payload is stringified and parsed, so this proves the
 * boundary is genuinely serializable rather than serializable-by-convention.
 * Swapping postMessage / iframe / worker in must be a change to this file and
 * nowhere else. If a sandbox change forces edits to sdk.ts sections 4-6, the
 * boundary leaked.
 */
export class JsonBridge {
  private subs = new Map<string, Subscription>();
  private seq = 0;

  constructor(private host: Host, private emit: (eventJson: string) => void) {}

  async handle(requestJson: string): Promise<string> {
    const req = JSON.parse(requestJson) as WidgetRequest & { instanceId?: string };
    const res = await this.dispatch(req);
    return JSON.stringify(res);
  }

  private async dispatch(req: WidgetRequest & { instanceId?: string }): Promise<WidgetResponse> {
    try {
      switch (req.type) {
        case "provider.query":
          return ok(await this.host.query(this.providerOf(req.instanceId), req.name, req.args, this.perms(req.instanceId, "queries")));
        case "provider.action":
          return ok(await this.host.action(this.providerOf(req.instanceId), req.name, req.args, this.perms(req.instanceId, "actions")));
        case "provider.subscribe": {
          const sub = await this.host.subscribe(
            this.providerOf(req.instanceId), req.name, req.args,
            (state: QueryState<unknown>) => {
              const ev: HostEvent = { type: "query.update", subscriptionId: req.subscriptionId, state };
              this.emit(JSON.stringify(ev));
            },
            this.perms(req.instanceId, "queries"),
          );
          this.subs.set(req.subscriptionId, sub);
          return ok({ subscriptionId: req.subscriptionId });
        }
        case "provider.unsubscribe":
          this.subs.get(req.subscriptionId)?.unsubscribe();
          this.subs.delete(req.subscriptionId);
          return ok(null);
        case "provider.status":
          return ok(this.host.providerStatus(this.providerOf(req.instanceId)));
        case "data.get":
          return ok(await this.scope(req.instanceId).get(req.key));
        case "data.set":
          return ok(await this.scope(req.instanceId).set(req.key, req.value));
        case "data.delete":
          return ok(await this.scope(req.instanceId).delete(req.key));
        case "http.get":
          return ok(await this.httpOf(req.instanceId).get(req.url, req.params as any));
        case "http.post":
          return ok(await this.httpOf(req.instanceId).post(req.url, req.body));
      }
    } catch (err) {
      return { ok: false, error: toProviderError(err) };
    }
  }

  nextSubscriptionId() { return `sub-${++this.seq}`; }

  /** The host derives the provider from the caller, never from the payload. */
  private providerOf(instanceId?: string) {
    const i = instanceId ? this.instances.get(instanceId) : undefined;
    const pid = i ? this.host.registry.widget(i.definitionId)?.widget.requires?.provider : undefined;
    if (!pid) throw new Error("caller declares no provider");
    return pid;
  }

  private scope(instanceId?: string) {
    if (!instanceId) throw new Error("instanceId required");
    return this.host.data.scoped(instanceId);
  }
  private instances = new Map<string, WidgetInstance<any>>();
  register(i: WidgetInstance<any>) { this.instances.set(i.id, i); }

  private perms(instanceId: string | undefined, kind: "queries" | "actions"): string[] {
    if (!instanceId) return [];
    const i = this.instances.get(instanceId);
    if (!i) return [];
    const w = this.host.registry.widget(i.definitionId)?.widget;
    return w?.permissions?.[kind] ?? [];
  }
  private httpOf(instanceId?: string) {
    const i = instanceId ? this.instances.get(instanceId) : undefined;
    const w = i ? this.host.registry.widget(i.definitionId)?.widget : undefined;
    if (!w?.capabilities?.http) throw new Error("http capability not declared");
    return this.host.httpFor(w.capabilities.http as any);
  }
}

const ok = (value: unknown): WidgetResponse => ({ ok: true, value: JSON.parse(JSON.stringify(value ?? null)) });

/**
 * The widget-side half. Lives inside the sandbox in the target architecture.
 * It only ever sees strings.
 */
export function sandboxContext<T>(
  instance: WidgetInstance<T>,
  send: (requestJson: string) => Promise<string>,
  onEvent: (cb: (eventJson: string) => void) => void,
): WidgetContext<T> {
  const handlers = new Map<string, (s: QueryState<unknown>) => void>();
  onEvent((json) => {
    const ev = JSON.parse(json) as HostEvent;
    if (ev.type === "query.update") handlers.get(ev.subscriptionId)?.(ev.state);
  });

  const call = async <R>(req: WidgetRequest): Promise<R> => {
    const res = JSON.parse(await send(JSON.stringify({ ...req, instanceId: instance.id }))) as WidgetResponse<R>;
    if (!res.ok) throw res.error;
    return res.value;
  };

  let n = 0;
  const provider: WidgetProviderApi = {
    query: (name, args) => call({ type: "provider.query", name, args: args ?? {} }),
    action: (name, args) => call({ type: "provider.action", name, args: args ?? {} }),
    subscribe: async (name, args, onState) => {
      const subscriptionId = `${instance.id}-${++n}`;
      handlers.set(subscriptionId, onState as (s: QueryState<unknown>) => void);
      await call({ type: "provider.subscribe", name, args: args ?? {}, subscriptionId });
      return { unsubscribe: () => { handlers.delete(subscriptionId); void call({ type: "provider.unsubscribe", subscriptionId }); } };
    },
    status: async () => call<ProviderStatus>({ type: "provider.status" }),
    onStatusChange: () => ({ unsubscribe: () => {} }),
  };

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
    provider,
  };
}
