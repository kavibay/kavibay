// SPDX-License-Identifier: MIT
/**
 * n8n provider: list envelope unwrapping and workflow/execution mapping.
 * Run: npx tsx extensions/n8n/provider.assert.ts
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import {
  mapProgress,
  n8nProvider,
  webhookPath,
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
      patch: async () => undefined as never,
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

const allHost = hostFor({ data: [{ id: "e3", workflowId: "w2", status: "error" }] });
const all = (await fetchExecutions({}, allHost)) as N8nExecution[];
assert(all[0]?.workflowId === "w2" && all[0]?.status === "error", "without workflowId every workflow's runs come back");
assert(
  n8nProvider.queries.executions.key({}).join() === "",
  "the all-workflows read has its own cache key",
);

assert(
  webhookPath("https://n8n.example.com/webhook/abc-123") === "/webhook/abc-123",
  "a production URL keeps only its path",
);
assert(
  webhookPath(" https://evil.example/n8n/webhook-test/abc/x?y=1 ") === "/webhook-test/abc/x",
  "the pasted host is dropped, so the credential's origin is the only target",
);
assert(webhookPath("abc-123") === "/webhook/abc-123", "a bare id is a production path");
let refused = false;
try {
  webhookPath("https://n8n.example.com/api/v1/workflows");
} catch {
  refused = true;
}
assert(refused, "a URL that is not a webhook is refused, not posted to");

let posted: { url: string; body: unknown } | undefined;
const triggerHost = hostFor({});
triggerHost.http.post = async <T>(url: string, body?: unknown): Promise<T> => {
  posted = { url, body };
  return { message: "Workflow was started" } as T;
};
const started = (await n8nProvider.actions.triggerWebhook.execute(
  { webhook: "https://n8n.example.com/webhook/abc", body: '{"a":1}' },
  triggerHost,
)) as { response: string };
assert(posted?.url === "{{origin}}/webhook/abc", "the webhook goes to the credential's origin");
assert((posted?.body as { a?: number } | undefined)?.a === 1, "the JSON body is sent parsed");
assert(started.response.includes("Workflow was started"), "the webhook's answer comes back as text");

// n8n leaves running executions out unless asked for status=running.
const splitHost = hostFor({});
splitHost.http.get = async <T>(_url: string, params?: Record<string, unknown>): Promise<T> =>
  (params?.status === "running"
    ? { data: [{ id: "r1", workflowId: "w1", status: "running" }] }
    : { data: [{ id: "r1", workflowId: "w1", status: "running" }, { id: "d1", workflowId: "w1", status: "success" }] }) as T;
const board = (await fetchExecutions({}, splitHost)) as N8nExecution[];
assert(
  board.map((execution) => execution.id).join() === "r1,d1",
  "running runs come first and appear once even when both lists carry them",
);

const getHost = hostFor("ok");
const viaGet = (await n8nProvider.actions.triggerWebhook.execute(
  { webhook: "abc", method: "get" },
  getHost,
)) as { response: string };
assert(getHost.lastUrl === "{{origin}}/webhook/abc" && viaGet.response === "ok", "a GET webhook is called with GET");

// Progress: the running node is never stored; it is derived.
const workflowData = {
  nodes: [
    { name: "Webhook", type: "n8n-nodes-base.webhook" },
    { name: "Wait", type: "n8n-nodes-base.wait" },
    { name: "HTTP Request", type: "n8n-nodes-base.httpRequest" },
    { name: "Note", type: "n8n-nodes-base.stickyNote" },
  ],
  connections: {
    Webhook: { main: [[{ node: "Wait", type: "main", index: 0 }]] },
    Wait: { main: [[{ node: "HTTP Request", type: "main", index: 0 }]] },
  },
};
const webhookRun = {
  startTime: 1_790_000_000_000,
  executionTime: 4,
  executionStatus: "success",
  data: { main: [[{ json: { secret: 1 } }]] },
};
const onWait = mapProgress({
  id: 7,
  status: "running",
  data: { resultData: { lastNodeExecuted: "Webhook", runData: { Webhook: [webhookRun] } } },
  workflowData,
});
assert(onWait.id === "7" && onWait.currentNode === "Wait", "a running execution is on the successor of its last node");
assert(onWait.totalNodes === 3, "sticky notes are not steps");
assert(onWait.nodes.length === 1 && onWait.nodes[0]?.durationMs === 4, "each run node keeps its timing");
assert(!JSON.stringify(onWait).includes("secret"), "item data never leaves the provider");

const parked = mapProgress({
  id: "8",
  status: "waiting",
  waitTill: "2026-10-02T15:00:00.000Z",
  data: {
    resultData: {
      lastNodeExecuted: "Wait",
      runData: { Webhook: [webhookRun], Wait: [{ ...webhookRun, startTime: webhookRun.startTime + 10 }] },
    },
  },
  workflowData,
});
assert(parked.currentNode === "Wait" && parked.waitTill !== null, "a waiting execution is on its Wait node");

const unsaved = mapProgress({ id: "9", status: "running", workflowData });
assert(unsaved.currentNode === null && unsaved.nodes.length === 0, "without saved progress nothing is guessed");

const done = mapProgress({
  id: "10",
  status: "success",
  data: { resultData: { lastNodeExecuted: "HTTP Request", runData: { Webhook: [webhookRun] } } },
  workflowData,
});
assert(done.currentNode === null && done.lastNode === "HTTP Request", "a finished run has no current node");

const progressHost = hostFor({ id: "11", status: "success" });
await n8nProvider.queries.executionProgress.fetch({ executionId: " 11 " }, progressHost);
assert(progressHost.lastUrl === "{{origin}}/api/v1/executions/11", "progress reads one execution by id");

console.log("n8n provider.assert: ok");
