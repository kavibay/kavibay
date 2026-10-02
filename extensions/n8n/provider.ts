// SPDX-License-Identifier: MIT
import { defineProvider, type ProviderHostContext } from "@sdk/contract/sdk";

/**
 * n8n: workflows and executions, reached only through this provider.
 *
 * The instance host is whatever origin the person typed. This file writes
 * `{{origin}}` and the host fills it from credential metadata, so the
 * webview never chooses where the API key goes. Vendor envelopes (`data`)
 * stop here so a widget sees a flat list.
 */

export const PROVIDER_ID = "kavibay.n8n/n8n";

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  status: string;
  mode: string;
  startedAt: string;
  stoppedAt: string | null;
}

interface N8nExecutionsArgs {
  workflowId?: string;
}

const API = "{{origin}}/api/v1";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asBool = (value: unknown): boolean => value === true;

/** n8n ids are strings in current APIs and numbers in older ones. */
function asId(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Maps one n8n workflow into the flat widget DTO. */
function mapWorkflow(raw: unknown): N8nWorkflow {
  const row = asRecord(raw);
  const id = asId(row.id);
  if (!id) throw new Error("workflow missing id");
  return {
    id,
    name: asString(row.name),
    active: asBool(row.active),
    updatedAt: asString(row.updatedAt),
  };
}

/** Maps one n8n execution; missing `status` becomes running vs finished. */
function mapExecution(raw: unknown): N8nExecution {
  const row = asRecord(raw);
  const id = asId(row.id);
  if (!id) throw new Error("execution missing id");
  const status = asString(row.status);
  return {
    id,
    workflowId: asId(row.workflowId),
    status: status.length > 0 ? status : asBool(row.finished) ? "finished" : "running",
    mode: asString(row.mode),
    startedAt: asString(row.startedAt),
    stoppedAt: typeof row.stoppedAt === "string" && row.stoppedAt.length > 0 ? row.stoppedAt : null,
  };
}

function unwrapList(raw: unknown, missing: string): unknown[] {
  const data = asRecord(raw).data;
  if (!Array.isArray(data)) throw new Error(missing);
  return data;
}

/** GET after confirming an n8n credential exists; auth is attached host-side. */
async function n8nGet<T>(
  host: ProviderHostContext,
  path: string,
  params?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "n8n is not connected" };
  }
  return host.http.get<T>(`${API}${path}`, params);
}

export interface N8nNodeRun {
  name: string;
  status: string;
  startedAt: string;
  durationMs: number;
}

export interface N8nExecutionProgress {
  id: string;
  status: string;
  /** The last node n8n recorded a run for; null until the first one finishes. */
  lastNode: string | null;
  /** Best guess at the step running now — see `currentNodeOf`. */
  currentNode: string | null;
  /** Set while a Wait node holds the execution. */
  waitTill: string | null;
  /** Nodes in the workflow, sticky notes and disabled nodes left out. */
  totalNodes: number;
  nodes: N8nNodeRun[];
}

interface N8nExecutionProgressArgs {
  executionId: string;
}

/**
 * Which node is running, from what n8n stores — it never stores that directly.
 *
 * A task still marked running or waiting is the answer. Otherwise a waiting
 * execution sits on its last node (the Wait), and a running one is on the
 * first successor of the last finished node that has not run yet. Branches
 * make that a guess: an IF node's untaken output is still "a successor".
 */
function currentNodeOf(
  status: string,
  lastNode: string | null,
  runs: N8nNodeRun[],
  connections: Record<string, unknown>,
): string | null {
  const open = runs.find((run) => run.status === "running" || run.status === "waiting");
  if (open) return open.name;
  if (status === "waiting") return lastNode;
  if (status !== "running" || !lastNode) return null;
  const ran = new Set(runs.map((run) => run.name));
  const outputs = asRecord(connections[lastNode]).main;
  for (const output of Array.isArray(outputs) ? outputs : []) {
    for (const link of Array.isArray(output) ? output : []) {
      const next = asString(asRecord(link).node);
      if (next && !ran.has(next)) return next;
    }
  }
  return null;
}

/**
 * Flattens one execution's run data to names, status and timing.
 *
 * Item data stays behind on purpose: it is the workflow's payload — often
 * large, sometimes personal — and a progress view needs none of it.
 */
export function mapProgress(raw: unknown): N8nExecutionProgress {
  const row = asRecord(raw);
  const id = asId(row.id);
  if (!id) throw new Error("execution missing id");
  const status = asString(row.status) || (asBool(row.finished) ? "success" : "running");
  const resultData = asRecord(asRecord(row.data).resultData);
  const nodes: N8nNodeRun[] = Object.entries(asRecord(resultData.runData)).map(([name, tasks]) => {
    const last = asRecord(Array.isArray(tasks) ? tasks[tasks.length - 1] : undefined);
    const startTime = typeof last.startTime === "number" ? last.startTime : NaN;
    return {
      name,
      status: asString(last.executionStatus) || (last.error ? "error" : "success"),
      startedAt: Number.isFinite(startTime) ? new Date(startTime).toISOString() : "",
      durationMs: typeof last.executionTime === "number" ? last.executionTime : 0,
    };
  });
  nodes.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const lastNode = asString(resultData.lastNodeExecuted) || null;
  const workflow = asRecord(row.workflowData);
  const workflowNodes = Array.isArray(workflow.nodes) ? workflow.nodes.map(asRecord) : [];
  return {
    id,
    status,
    lastNode,
    currentNode: currentNodeOf(status, lastNode, nodes, asRecord(workflow.connections)),
    waitTill: typeof row.waitTill === "string" && row.waitTill.length > 0 ? row.waitTill : null,
    totalNodes: workflowNodes.filter(
      (node) => node.disabled !== true && node.type !== "n8n-nodes-base.stickyNote",
    ).length,
    nodes,
  };
}

interface TriggerWebhookArgs {
  webhook: string;
  body?: string;
  method?: string;
}

/**
 * The part of a pasted webhook URL from `/webhook/` or `/webhook-test/` on.
 *
 * Only the path survives: the host prepends the credential's own origin, so a
 * URL pointing at another server cannot send this request anywhere else. A
 * bare id (what the Webhook node shows after `/webhook/`) is accepted too.
 */
export function webhookPath(input: string): string {
  const trimmed = input.trim();
  const match = /\/(webhook(?:-test)?\/[^?#\s]+)/.exec(trimmed);
  // ponytail: assumes n8n's default webhook prefixes; a renamed
  // N8N_ENDPOINT_WEBHOOK needs a prefix field on the credential.
  if (match) return `/${match[1]}`;
  if (/^[\w-]+(\/[\w-]+)*$/.test(trimmed)) return `/webhook/${trimmed}`;
  throw new Error("Paste the webhook URL from the n8n Webhook node");
}

const workflowSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    name: { type: "string" as const },
    active: { type: "boolean" as const },
    updatedAt: { type: "string" as const },
  },
};

const executionSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    workflowId: { type: "string" as const },
    status: { type: "string" as const },
    mode: { type: "string" as const },
    startedAt: { type: "string" as const },
    stoppedAt: { type: "string" as const, nullable: true },
  },
};

export const n8nProvider = defineProvider({
  name: "n8n",
  displayName: "n8n",
  requiresCredential: true,
  credentialType: "n8nApi",
  hosts: { fromCredential: "origin" },
  queries: {
    workflows: {
      description: "The workflows on your n8n instance",
      args: {},
      result: { type: "list", of: workflowSchema },
      key: () => [],
      staleTime: 5 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<N8nWorkflow[]> => {
        const raw = await n8nGet<unknown>(host, "/workflows", { limit: 50 });
        return unwrapList(raw, "workflows missing or not a list").map(mapWorkflow);
      },
    },
    executions: {
      description:
        "Running n8n executions first, then the most recent finished ones. Without workflowId this is the newest across every workflow — one request for a status board instead of one per workflow; group by workflowId. status is running, success, error, canceled, waiting or crashed.",
      args: {
        workflowId: {
          type: "string",
          label: "Workflow",
          required: false,
          source: { query: "workflows" },
        },
      },
      result: { type: "list", of: executionSchema },
      key: (args: N8nExecutionsArgs) => [args.workflowId?.trim() ?? ""],
      // Also the poll interval while a widget watches it (query-cache.ts): a
      // status board must show a run starting and stopping, and the instance
      // is the person's own, so a few seconds is affordable.
      staleTime: 5_000,
      fetch: async (args: N8nExecutionsArgs, host): Promise<N8nExecution[]> => {
        const workflowId = args.workflowId?.trim() ?? "";
        const scope: Record<string, string> = workflowId ? { workflowId } : {};
        // n8n's public API leaves running executions out of a list "for
        // backward compatibility" unless it is filtered by status=running
        // (executions.public.controller.ts, `excludeRunning`). A status board
        // built on one request would never see a run, so ask for both.
        const [running, recent] = await Promise.all([
          n8nGet<unknown>(host, "/executions", { ...scope, status: "running", limit: 25 }),
          n8nGet<unknown>(host, "/executions", { ...scope, limit: workflowId ? 25 : 100 }),
        ]);
        const seen = new Set<string>();
        return [
          ...unwrapList(running, "executions missing or not a list"),
          ...unwrapList(recent, "executions missing or not a list"),
        ]
          .map(mapExecution)
          .filter((execution) => !seen.has(execution.id) && seen.add(execution.id));
      },
    },
    executionProgress: {
      description:
        "Which step one n8n execution is on: currentNode (null when unknown or finished), lastNode (last finished), totalNodes and every node that has run with its status and timing. executionId comes from executions. n8n writes this during a run only when the workflow setting Save execution progress (or EXECUTIONS_DATA_SAVE_ON_PROGRESS) is on; otherwise nodes stays empty until the run ends, so show the execution status then, not an error.",
      args: {
        executionId: {
          type: "string",
          label: "Execution",
          required: true,
          source: { query: "executions" },
        },
      },
      result: {
        type: "object",
        fields: {
          id: { type: "string" },
          status: { type: "string" },
          lastNode: { type: "string", nullable: true },
          currentNode: { type: "string", nullable: true },
          waitTill: { type: "string", nullable: true },
          totalNodes: { type: "number" },
          nodes: {
            type: "list",
            of: {
              type: "object",
              fields: {
                name: { type: "string" },
                status: { type: "string" },
                startedAt: { type: "string" },
                durationMs: { type: "number" },
              },
            },
          },
        },
      },
      key: (args: N8nExecutionProgressArgs) => [args.executionId.trim()],
      // Same cadence as executions: both describe a run that may be moving.
      staleTime: 5_000,
      fetch: async (args: N8nExecutionProgressArgs, host): Promise<N8nExecutionProgress> => {
        const executionId = args.executionId.trim();
        if (!executionId) throw new Error("executionId required");
        const raw = await n8nGet<unknown>(host, `/executions/${encodeURIComponent(executionId)}`, {
          includeData: true,
        });
        return mapProgress(raw);
      },
    },
  },
  actions: {
    triggerWebhook: {
      effect: "write",
      description:
        "Start a workflow through its Webhook node. webhook is the Production or Test URL the node shows; it must be on the connected instance. method must match the node's HTTP Method: GET (n8n's default for a new node) or POST — let the person choose it next to the URL. body is optional JSON text, sent only with POST. Returns the webhook's response as text.",
      args: {
        webhook: { type: "string", label: "Webhook URL", required: true },
        body: { type: "string", label: "JSON body", required: false },
        method: { type: "string", label: "HTTP method (GET or POST)", required: false },
      },
      execute: async (args: TriggerWebhookArgs, host): Promise<{ response: string }> => {
        const path = webhookPath(args.webhook);
        const method = (args.method?.trim() || "POST").toUpperCase();
        if (method !== "GET" && method !== "POST") throw new Error("method must be GET or POST");
        const text = args.body?.trim() ?? "";
        let body: unknown = {};
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            throw new Error("body must be JSON");
          }
        }
        if (!(await host.credentials.isConnected())) {
          throw { kind: "disconnected", message: "n8n is not connected" };
        }
        // The API key rides along like on every request here; same instance, and
        // a Webhook node ignores the header unless it is told to check it.
        const url = `{{origin}}${path}`;
        const raw =
          method === "GET" ? await host.http.get<unknown>(url) : await host.http.post<unknown>(url, body);
        return { response: typeof raw === "string" ? raw : JSON.stringify(raw ?? "") };
      },
      // A started run shows up in executions; no need to wait for the next poll.
      invalidates: () => [{ query: "executions" }],
    },
  },
});

export default n8nProvider;
