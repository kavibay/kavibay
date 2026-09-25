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

interface CreateIssueArgs {
  teamId: string;
  title: string;
  description?: string;
}

interface UpdateIssueArgs {
  id: string;
  title?: string;
  description?: string;
  stateType?: string;
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

interface IssueCreateData {
  issueCreate?: { success?: unknown; issue?: unknown } | null;
}

interface IssueUpdateData {
  issueUpdate?: { success?: unknown; issue?: unknown } | null;
}

interface IssueStatesData {
  issue?: { team?: { states?: { nodes?: unknown } } | null } | null;
}

const GRAPHQL = "https://api.linear.app/graphql";
const ISSUE_PAGE = 25;
const TEAM_PAGE = 50;
const ISSUE_SELECTION =
  "id identifier title url updatedAt state { name type } team { name key }";
/** Open workflow states; completed and canceled stay out of the default lists. */
const ACTIVE_STATES = ["backlog", "unstarted", "started"];
/** Linear's five workflow types — the values a widget already sees as `stateType`. */
const STATE_TYPES = ["backlog", "unstarted", "started", "completed", "canceled"];
/**
 * The states as GraphQL *string* literals, quoted by `JSON.stringify` rather
 * than by hand.
 *
 * Linear types this filter as `String`. Written as bare words the server reads
 * them as enum values and answers `String cannot represent a non string value:
 * backlog` — a 400 on every issue query. Deriving the quotes is what stops the
 * next edit to this list from dropping them again.
 */
const ACTIVE_STATE_LIST = ACTIVE_STATES.map((state) => JSON.stringify(state)).join(", ");
const TEAMS_QUERY = `{ teams(first: ${TEAM_PAGE}) { nodes { id name key } } }`;
const ASSIGNED_QUERY = `{ viewer { assignedIssues(first: ${ISSUE_PAGE}, filter: { state: { type: { in: [${ACTIVE_STATE_LIST}] } } }) { nodes { ${ISSUE_SELECTION} } } } }`;
const TEAM_ISSUES_QUERY = `query($teamId: String!) { team(id: $teamId) { issues(first: ${ISSUE_PAGE}, filter: { state: { type: { in: [${ACTIVE_STATE_LIST}] } } }) { nodes { ${ISSUE_SELECTION} } } } }`;
const CREATE_ISSUE_MUTATION = `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_SELECTION} } } }`;
const ISSUE_STATES_QUERY = `query($id: String!) { issue(id: $id) { team { states { nodes { id name type position } } } } }`;
const UPDATE_ISSUE_MUTATION = `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_SELECTION} } } }`;

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

/** Maps one Linear workflow state; `position` is how "first of this type" is decided. */
function mapWorkflowState(raw: unknown): { id: string; type: string; position: number } {
  const row = asRecord(raw);
  const id = asString(row.id);
  if (!id) throw new Error("state missing id");
  return {
    id,
    type: asString(row.type),
    position: typeof row.position === "number" && Number.isFinite(row.position) ? row.position : 0,
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

/**
 * Linear's write wants a state UUID. Widgets only have `stateType`. Resolve
 * the team's first state of that type (lowest `position`) so a generated
 * widget can mark something done without a per-team states picker —
 * `ArgSpec.source` calls the source query with `{}` and cannot pass teamId.
 */
async function stateIdForType(
  host: ProviderHostContext,
  issueId: string,
  stateType: string,
): Promise<string> {
  const data = await graphql<IssueStatesData>(host, ISSUE_STATES_QUERY, { id: issueId });
  if (!data.issue) throw new Error("issue not found");
  const states = mapNodes(
    data.issue.team?.states?.nodes,
    mapWorkflowState,
    "states missing or not a list",
  );
  const match = states
    .filter((row) => row.type === stateType)
    .sort((a, b) => a.position - b.position)[0];
  if (!match) throw new Error(`no ${stateType} state on this team`);
  return match.id;
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
  // Issues answer from `api.linear.app` and live on `linear.app`; the `url` on
  // every issue row points at the latter.
  linkHosts: ["linear.app"],
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
  actions: {
    createIssue: {
      effect: "write",
      description: "Create an issue in one Linear team",
      args: {
        teamId: {
          type: "string",
          label: "Team",
          required: true,
          source: { query: "teams" },
        },
        title: { type: "string", label: "Title", required: true },
        description: { type: "string", label: "Description", required: false },
      },
      execute: async (args: CreateIssueArgs, host): Promise<LinearIssue> => {
        const teamId = args.teamId.trim();
        if (!teamId) throw new Error("teamId required");
        const title = args.title.trim();
        if (!title) throw new Error("Issue title cannot be empty");
        const description = args.description?.trim() ?? "";
        const input: Record<string, unknown> = { teamId, title };
        // Linear treats "" as a body. Skip the field so a blank form stays empty.
        if (description) input.description = description;
        const data = await graphql<IssueCreateData>(host, CREATE_ISSUE_MUTATION, { input });
        const payload = data.issueCreate;
        if (payload?.success !== true || payload.issue == null) {
          throw new Error("Linear did not create the issue");
        }
        return mapIssue(payload.issue);
      },
      // teamIssues keys on the trimmed id; a prefix of that id is enough.
      invalidates: (args: CreateIssueArgs) => [{ query: "teamIssues", key: [args.teamId.trim()] }],
    },
    updateIssue: {
      effect: "write",
      description:
        "Update an issue's title, description or status. id is the issue id from assignedIssues or teamIssues. To change status, pass stateType: backlog, unstarted, started, completed or canceled — that picks the team's first state of that type.",
      args: {
        id: { type: "string", label: "Issue", required: true },
        title: { type: "string", label: "Title", required: false },
        description: { type: "string", label: "Description", required: false },
        stateType: { type: "string", label: "Status type", required: false },
      },
      execute: async (args: UpdateIssueArgs, host): Promise<LinearIssue> => {
        const id = args.id.trim();
        if (!id) throw new Error("id required");
        const title = args.title?.trim() ?? "";
        const description = args.description?.trim() ?? "";
        const stateType = (args.stateType?.trim() ?? "").toLowerCase();
        if (stateType && !STATE_TYPES.includes(stateType)) {
          throw new Error(`stateType must be one of ${STATE_TYPES.join(", ")}`);
        }
        const input: Record<string, unknown> = {};
        if (title) input.title = title;
        if (description) input.description = description;
        if (stateType) input.stateId = await stateIdForType(host, id, stateType);
        if (Object.keys(input).length === 0) throw new Error("nothing to update");
        const data = await graphql<IssueUpdateData>(host, UPDATE_ISSUE_MUTATION, { id, input });
        const payload = data.issueUpdate;
        if (payload?.success !== true || payload.issue == null) {
          throw new Error("Linear did not update the issue");
        }
        return mapIssue(payload.issue);
      },
      // Completing an issue removes it from both open lists. The action only
      // has the issue id, not a teamId, so every cached key of those queries goes.
      invalidates: () => [{ query: "assignedIssues" }, { query: "teamIssues" }],
    },
  },
});

export default linearProvider;
