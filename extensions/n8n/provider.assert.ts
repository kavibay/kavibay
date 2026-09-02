// SPDX-License-Identifier: MIT
/**
 * n8n provider: list envelope unwrapping and workflow/execution mapping.
 * Run: npx tsx extensions/n8n/provider.assert.ts
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import {
  n8nProvider,
  type N8nExecution,
  type N8nWorkflow,
} from "./provider";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hostFor(
  response: unknown,
  connected = true,
): ProviderHostContext & { lastUrl?: string } {
  const host: ProviderHostContext & { lastUrl?: string } = {
    credentials: { isConnected: async () => connected },
    http: {
      get: async <T>(url: string): Promise<T> => {
        host.lastUrl = url;
        return response as T;
      },
      post: async () => undefined as never,
      put: async () => undefined as never,
    },
  };
  return host;
}

const fetchWorkflows = n8nProvider.queries.workflows.fetch;
const fetchExecutions = n8nProvider.queries.executions.fetch;

const workflowsHost = hostFor({
  data: [
    { id: "w1", name: "Invoice sync", active: true, updatedAt: "2026-08-29T08:00:00.000Z" },
    { id: 2, name: "Nightly", active: false, updatedAt: "2026-08-28T08:00:00.000Z" },
  ],
});
const workflows = (await fetchWorkflows({}, workflowsHost)) as N8nWorkflow[];
assert(workflows.length === 2 && workflows[0]?.name === "Invoice sync", "workflows are flattened out of data");
assert(workflows[1]?.id === "2" && workflows[1]?.active === false, "numeric ids become strings");
assert(
  workflowsHost.lastUrl?.startsWith("{{origin}}/api/v1/workflows"),
  "the instance host is a placeholder the host fills from the credential",
);

const executions = (await fetchExecutions(
  { workflowId: " w1 " },
  hostFor({
    data: [
      {
        id: "e1",
        workflowId: "w1",
        status: "success",
        mode: "trigger",
        startedAt: "2026-08-29T08:00:00.000Z",
        stoppedAt: "2026-08-29T08:00:02.000Z",
        finished: true,
      },
      {
        id: "e2",
        workflowId: "w1",
        finished: false,
        mode: "manual",
        startedAt: "2026-08-29T08:01:00.000Z",
        stoppedAt: null,
      },
    ],
  }),
)) as N8nExecution[];
assert(executions[0]?.status === "success" && executions[0]?.workflowId === "w1", "status and workflow id survive");
assert(executions[1]?.status === "running" && executions[1]?.stoppedAt === null, "an unfinished run has no status field");

try {
  await fetchWorkflows({}, hostFor({ data: [] }, false));
  assert(false, "disconnected must throw");
} catch (error) {
  assert(
    typeof error === "object" && error !== null && (error as { kind?: string }).kind === "disconnected",
    "a missing credential is disconnected, not a generic error",
  );
}

const empty = (await fetchExecutions({ workflowId: "none" }, hostFor({ data: [] }))) as N8nExecution[];
assert(empty.length === 0, "a workflow with no executions is an empty list");

console.log("n8n provider.assert: ok");
