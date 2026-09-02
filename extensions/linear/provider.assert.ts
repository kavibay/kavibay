// SPDX-License-Identifier: MIT
/**
 * Linear provider: GraphQL envelope unwrapping and issue/team mapping.
 * Run: npx tsx extensions/linear/provider.assert.ts
 */
import type { ProviderHostContext } from "@sdk/contract/sdk";
import {
  linearProvider,
  type LinearIssue,
  type LinearTeam,
} from "./provider";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hostFor(
  response: unknown,
  connected = true,
): ProviderHostContext {
  return {
    credentials: { isConnected: async () => connected },
    http: {
      get: async () => undefined as never,
      post: async <T>(_url: string, _body?: unknown): Promise<T> => response as T,
      put: async () => undefined as never,
    },
  };
}

const fetchTeams = linearProvider.queries.teams.fetch;
const fetchAssigned = linearProvider.queries.assignedIssues.fetch;
const fetchTeamIssues = linearProvider.queries.teamIssues.fetch;

const teamsEnvelope = {
  data: {
    teams: {
      nodes: [
        { id: "team-1", name: "Engineering", key: "ENG" },
        { id: "team-2", name: "Design", key: "DES" },
      ],
    },
  },
};

const teams = await fetchTeams({}, hostFor(teamsEnvelope)) as LinearTeam[];
assert(teams.length === 2 && teams[0]?.key === "ENG", "teams are flattened out of the GraphQL envelope");
assert(teams[1]?.id === "team-2" && teams[1]?.name === "Design", "team name and id survive");

const issueNode = {
  id: "issue-1",
  identifier: "ENG-12",
  title: "Fix the overlay",
  url: "https://linear.app/acme/issue/ENG-12",
  updatedAt: "2026-08-29T08:00:00.000Z",
  state: { name: "In Progress", type: "started" },
  team: { name: "Engineering", key: "ENG" },
};

const assignedEnvelope = {
  data: {
    viewer: {
      assignedIssues: { nodes: [issueNode] },
    },
  },
};

const assigned = await fetchAssigned({}, hostFor(assignedEnvelope)) as LinearIssue[];
assert(assigned.length === 1, "assigned issues are a flat list");
assert(assigned[0]?.identifier === "ENG-12", "identifier is the Linear issue key");
assert(assigned[0]?.state === "In Progress" && assigned[0]?.stateType === "started", "state is flattened");
assert(assigned[0]?.team === "Engineering" && assigned[0]?.teamKey === "ENG", "team is flattened");
assert(assigned[0]?.url.includes("ENG-12"), "issue url is kept");

const teamEnvelope = {
  data: {
    team: {
      issues: { nodes: [issueNode] },
    },
  },
};

const teamIssues = await fetchTeamIssues(
  { teamId: " team-1 " },
  hostFor(teamEnvelope),
) as LinearIssue[];
assert(teamIssues.length === 1 && teamIssues[0]?.id === "issue-1", "team issues use the same DTO");

let capturedBody: unknown;
const capturingHost: ProviderHostContext = {
  credentials: { isConnected: async () => true },
  http: {
    get: async () => undefined as never,
    post: async <T>(_url: string, body?: unknown): Promise<T> => {
      capturedBody = body;
      return teamEnvelope as T;
    },
    put: async () => undefined as never,
  },
};
await fetchTeamIssues({ teamId: " team-1 " }, capturingHost);
assert(
  typeof capturedBody === "object" &&
    capturedBody !== null &&
    (capturedBody as { variables?: { teamId?: string } }).variables?.teamId === "team-1",
  "teamId is trimmed before it is sent as a GraphQL variable",
);

try {
  await fetchAssigned({}, hostFor({}, false));
  assert(false, "disconnected must throw");
} catch (error) {
  assert(
    typeof error === "object" && error !== null && (error as { kind?: string }).kind === "disconnected",
    "a missing credential is disconnected, not a generic error",
  );
}

try {
  await fetchTeams({}, hostFor({ errors: [{ message: "Invalid token" }] }));
  assert(false, "GraphQL errors must throw");
} catch (error) {
  assert(String((error as Error).message).includes("Invalid token"), "the GraphQL error message is surfaced");
}

const missingTeam = await fetchTeamIssues(
  { teamId: "gone" },
  hostFor({ data: { team: null } }),
) as LinearIssue[];
assert(missingTeam.length === 0, "a deleted team is an empty list, not a crash");

console.log("linear provider.assert: ok");
