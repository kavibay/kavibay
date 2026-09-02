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
  workflowId: string;
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
      description: "Recent executions of one n8n workflow",
      args: {
        workflowId: {
          type: "string",
          label: "Workflow",
          required: true,
          source: { query: "workflows" },
        },
      },
      result: { type: "list", of: executionSchema },
      key: (args: N8nExecutionsArgs) => [args.workflowId.trim()],
      staleTime: 30_000,
      fetch: async (args: N8nExecutionsArgs, host): Promise<N8nExecution[]> => {
        const workflowId = args.workflowId.trim();
        if (!workflowId) throw new Error("workflowId required");
        const raw = await n8nGet<unknown>(host, "/executions", {
          workflowId,
          limit: 25,
        });
        return unwrapList(raw, "executions missing or not a list").map(mapExecution);
      },
    },
  },
  actions: {},
});

export default n8nProvider;
