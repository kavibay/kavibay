// SPDX-License-Identifier: MIT
import { defineProvider, type ProviderHostContext } from "@sdk/contract/sdk";

/**
 * Linear: issues and teams, reached only through this provider.
 *
 * Linear's public API is GraphQL at one host. The vendor envelope (`data`,
 * `errors`, nested `nodes`) stops here so a widget — including a generated one
 * — sees a flat list. Personal API keys are attached host-side as
 * `Authorization` without Bearer; this file never sees the secret.
 */

export const PROVIDER_ID = "kavibay.linear/linear";

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  updatedAt: string;
  state: string;
  stateType: string;
  team: string;
  teamKey: string;
}

interface LinearIssuesArgs {
  teamId: string;
}

interface GraphqlError {
  message?: unknown;
}

interface GraphqlEnvelope<T> {
  data?: T | null;
  errors?: GraphqlError[];
}

interface TeamsData {
  teams?: { nodes?: unknown };
}

interface AssignedData {
  viewer?: { assignedIssues?: { nodes?: unknown } };
}

interface TeamIssuesData {
  team?: { issues?: { nodes?: unknown } } | null;
}

const GRAPHQL = "https://api.linear.app/graphql";
const ISSUE_PAGE = 25;
const TEAM_PAGE = 50;
const ISSUE_SELECTION =
  "id identifier title url updatedAt state { name type } team { name key }";
/** Open workflow states; completed and canceled stay out of the default lists. */
const ACTIVE_STATES = "backlog, unstarted, started";
const TEAMS_QUERY = `{ teams(first: ${TEAM_PAGE}) { nodes { id name key } } }`;
const ASSIGNED_QUERY = `{ viewer { assignedIssues(first: ${ISSUE_PAGE}, filter: { state: { type: { in: [${ACTIVE_STATES}] } } }) { nodes { ${ISSUE_SELECTION} } } } }`;
const TEAM_ISSUES_QUERY = `query($teamId: String!) { team(id: $teamId) { issues(first: ${ISSUE_PAGE}, filter: { state: { type: { in: [${ACTIVE_STATES}] } } }) { nodes { ${ISSUE_SELECTION} } } } }`;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/** Maps one Linear Team node into the flat widget DTO. */
function mapTeam(raw: unknown): LinearTeam {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("team missing id");
  return { id, name: asString(row.name), key: asString(row.key) };
}

/** Maps one Linear Issue node; vendor nesting (`state.name`, `team.key`) stops here. */
function mapIssue(raw: unknown): LinearIssue {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("issue missing id");
  const state = asRecord(row.state);
  const team = asRecord(row.team);
  return {
    id,
    identifier: asString(row.identifier),
    title: asString(row.title),
    url: asString(row.url),
    updatedAt: asString(row.updatedAt),
    state: asString(state.name),
    stateType: asString(state.type),
    team: asString(team.name),
    teamKey: asString(team.key),
  };
}

function mapNodes<T>(raw: unknown, map: (row: unknown) => T, missing: string): T[] {
  if (!Array.isArray(raw)) throw new Error(missing);
  return raw.map(map);
}

function graphqlErrorMessage(errors: GraphqlError[] | undefined): string | undefined {
  const first = errors?.[0]?.message;
  return typeof first === "string" && first.length > 0 ? first : undefined;
}

/** Posts one GraphQL operation and unwraps `data`, or throws the first error. */
async function graphql<T>(
  host: ProviderHostContext,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  if (!(await host.credentials.isConnected())) {
    throw { kind: "disconnected", message: "Linear is not connected" };
  }
  const raw = await host.http.post<GraphqlEnvelope<T>>(
    GRAPHQL,
    variables ? { query, variables } : { query },
  );
  const message = graphqlErrorMessage(raw?.errors);
  if (message) throw new Error(message);
  if (raw?.data == null) throw new Error("Linear returned no data");
  return raw.data;
}

const teamSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    name: { type: "string" as const },
    key: { type: "string" as const },
  },
};

const issueSchema = {
  type: "object" as const,
  fields: {
    id: { type: "string" as const },
    identifier: { type: "string" as const },
    title: { type: "string" as const },
    url: { type: "string" as const },
    updatedAt: { type: "string" as const },
    state: { type: "string" as const },
    stateType: { type: "string" as const },
    team: { type: "string" as const },
    teamKey: { type: "string" as const },
  },
};

export const linearProvider = defineProvider({
  name: "linear",
  displayName: "Linear",
  requiresCredential: true,
  credentialType: "linearApi",
  hosts: ["api.linear.app"],
  queries: {
    teams: {
      description: "The teams in your Linear workspace",
      args: {},
      result: { type: "list", of: teamSchema },
      key: () => [],
      staleTime: 5 * 60 * 1000,
      fetch: async (_args: Record<string, never>, host): Promise<LinearTeam[]> => {
        const data = await graphql<TeamsData>(host, TEAMS_QUERY);
        return mapNodes(data.teams?.nodes, mapTeam, "teams missing or not a list");
      },
    },
    assignedIssues: {
      description: "Open issues assigned to you in Linear",
      args: {},
      result: { type: "list", of: issueSchema },
      key: () => [],
      staleTime: 60_000,
      fetch: async (_args: Record<string, never>, host): Promise<LinearIssue[]> => {
        const data = await graphql<AssignedData>(host, ASSIGNED_QUERY);
        return mapNodes(
          data.viewer?.assignedIssues?.nodes,
          mapIssue,
          "assigned issues missing or not a list",
        );
      },
    },
    teamIssues: {
      description: "Open issues in one Linear team",
      args: {
        teamId: {
          type: "string",
          label: "Team",
          required: true,
          source: { query: "teams" },
        },
      },
      result: { type: "list", of: issueSchema },
      key: (args: LinearIssuesArgs) => [args.teamId.trim()],
      staleTime: 60_000,
      fetch: async (args: LinearIssuesArgs, host): Promise<LinearIssue[]> => {
        const teamId = args.teamId.trim();
        if (!teamId) throw new Error("teamId required");
        const data = await graphql<TeamIssuesData>(host, TEAM_ISSUES_QUERY, { teamId });
        if (!data.team) return [];
        return mapNodes(data.team.issues?.nodes, mapIssue, "issues missing or not a list");
      },
    },
  },
  actions: {},
});

export default linearProvider;
