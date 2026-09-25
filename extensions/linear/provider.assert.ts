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

/**
 * The state filter has to leave here as GraphQL *strings*.
 *
 * Written as bare words it parses as enum values and Linear answers every issue
 * query with `400 String cannot represent a non string value: backlog`. Nothing
 * caught it for a long time because no widget could obtain a Linear grant at
 * all, so these queries had never actually reached the API.
 *
 * Parsed rather than substring-matched: JSON.parse is the check that bare words
 * fail and quoted ones pass, which is exactly the difference that broke.
 */
{
  const sentQueries: string[] = [];
  const recorder = (envelope: unknown): ProviderHostContext => ({
    credentials: { isConnected: async () => true },
    http: {
      get: async () => undefined as never,
      post: async <T>(_url: string, body?: unknown): Promise<T> => {
        sentQueries.push(String((body as { query?: unknown })?.query ?? ""));
        return envelope as T;
      },
      put: async () => undefined as never,
    },
  });

  await fetchAssigned({}, recorder(assignedEnvelope));
  await fetchTeamIssues({ teamId: "team-1" }, recorder(teamEnvelope));
  assert(sentQueries.length === 2, "both issue queries were captured");

  for (const query of sentQueries) {
    const list = /in:\s*(\[[^\]]*\])/.exec(query)?.[1];
    assert(list !== undefined, `the state filter is still in the query: ${query}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(list!);
    } catch {
      assert(false, `state values must be quoted GraphQL strings, got ${list}`);
    }
    assert(
      Array.isArray(parsed) && parsed.join() === "backlog,unstarted,started",
      `the open states are sent as strings, got ${list}`,
    );
  }
}

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

const createIssue = linearProvider.actions.createIssue;
const createdNode = {
  ...issueNode,
  id: "issue-2",
  identifier: "ENG-13",
  title: "New overlay",
  url: "https://linear.app/acme/issue/ENG-13",
};
const createdEnvelope = {
  data: {
    issueCreate: {
      success: true,
      issue: createdNode,
    },
  },
};

let createBody: unknown;
let createPosts = 0;
const createHost: ProviderHostContext = {
  credentials: { isConnected: async () => true },
  http: {
    get: async () => undefined as never,
    post: async <T>(_url: string, body?: unknown): Promise<T> => {
      createPosts += 1;
      createBody = body;
      return createdEnvelope as T;
    },
    put: async () => undefined as never,
  },
};

const created = await createIssue.execute(
  {
    teamId: " team-1 ",
    title: " New overlay ",
    description: " Steps to reproduce ",
  },
  createHost,
) as LinearIssue;
assert(createPosts === 1, "create issue uses one POST");
assert(created.identifier === "ENG-13" && created.title === "New overlay", "the created issue is flattened");
assert(created.url.includes("ENG-13"), "the created issue keeps its url");

const sent = createBody as {
  query?: string;
  variables?: { input?: { teamId?: string; title?: string; description?: string } };
};
assert(typeof sent.query === "string" && sent.query.includes("issueCreate"), "create uses the issueCreate mutation");
assert(sent.variables?.input?.teamId === "team-1", "teamId is trimmed before it is sent");
assert(sent.variables?.input?.title === "New overlay", "issue title is trimmed");
assert(sent.variables?.input?.description === "Steps to reproduce", "description is trimmed");

const invalidations = await createIssue.invalidates?.({
  teamId: " team-1 ",
  title: "x",
});
assert(invalidations?.[0]?.query === "teamIssues", "create invalidates the team issue list");
assert(invalidations?.[0]?.key?.[0] === "team-1", "create invalidates the trimmed teamId");

createPosts = 0;
try {
  await createIssue.execute({ teamId: "team-1", title: "  " }, createHost);
  assert(false, "empty titles must throw");
} catch (error) {
  assert(createPosts === 0, "empty titles are rejected before POST");
  assert(String((error as Error).message).toLowerCase().includes("title"), "the empty-title error names the field");
}

createPosts = 0;
try {
  await createIssue.execute({ teamId: "  ", title: "A title" }, createHost);
  assert(false, "empty teamId must throw");
} catch {
  assert(createPosts === 0, "empty teamId is rejected before POST");
}

createPosts = 0;
await createIssue.execute({ teamId: "team-1", title: "No body", description: "  " }, createHost);
assert(
  (createBody as { variables?: { input?: { description?: string } } }).variables?.input?.description === undefined,
  "a blank description is omitted rather than sent as empty markdown",
);

try {
  await createIssue.execute({ teamId: "team-1", title: "x" }, hostFor({}, false));
  assert(false, "disconnected create must throw");
} catch (error) {
  assert(
    typeof error === "object" && error !== null && (error as { kind?: string }).kind === "disconnected",
    "a missing credential is disconnected, not a generic error",
  );
}

try {
  await createIssue.execute(
    { teamId: "team-1", title: "x" },
    hostFor({ data: { issueCreate: { success: false, issue: null } } }),
  );
  assert(false, "a failed create must throw");
} catch (error) {
  assert(String((error as Error).message).length > 0, "Linear refusing the create is surfaced");
}

const updateIssue = linearProvider.actions.updateIssue;
const updatedNode = {
  ...issueNode,
  title: "Overlay is fixed",
  state: { name: "Done", type: "completed" },
};
const updatedEnvelope = {
  data: {
    issueUpdate: {
      success: true,
      issue: updatedNode,
    },
  },
};
const statesEnvelope = {
  data: {
    issue: {
      team: {
        states: {
          nodes: [
            { id: "state-progress", name: "In Progress", type: "started", position: 1 },
            { id: "state-done", name: "Done", type: "completed", position: 3 },
            { id: "state-shipped", name: "Shipped", type: "completed", position: 4 },
          ],
        },
      },
    },
  },
};

function hostQueue(responses: unknown[]): {
  host: ProviderHostContext;
  bodies: unknown[];
} {
  const bodies: unknown[] = [];
  let index = 0;
  return {
    bodies,
    host: {
      credentials: { isConnected: async () => true },
      http: {
        get: async () => undefined as never,
        post: async <T>(_url: string, body?: unknown): Promise<T> => {
          bodies.push(body);
          const response = responses[index];
          index += 1;
          if (response === undefined) throw new Error("unexpected extra POST");
          return response as T;
        },
        put: async () => undefined as never,
      },
    },
  };
}

{
  const { host, bodies } = hostQueue([updatedEnvelope]);
  const updated = (await updateIssue.execute(
    { id: " issue-1 ", title: " Overlay is fixed " },
    host,
  )) as LinearIssue;
  assert(bodies.length === 1, "a title-only update is one POST");
  assert(updated.title === "Overlay is fixed", "the updated issue is flattened");
  const sent = bodies[0] as {
    query?: string;
    variables?: { id?: string; input?: { title?: string } };
  };
  assert(typeof sent.query === "string" && sent.query.includes("issueUpdate"), "update uses the issueUpdate mutation");
  assert(sent.variables?.id === "issue-1", "issue id is trimmed before it is sent");
  assert(sent.variables?.input?.title === "Overlay is fixed", "issue title is trimmed");
}

{
  const { host, bodies } = hostQueue([statesEnvelope, updatedEnvelope]);
  await updateIssue.execute({ id: "issue-1", stateType: " completed " }, host);
  assert(bodies.length === 2, "a status update loads the team's states then writes");
  assert(
    String((bodies[0] as { query?: string }).query ?? "").includes("states"),
    "the first POST reads workflow states for the issue's team",
  );
  const write = bodies[1] as { variables?: { input?: { stateId?: string } } };
  assert(write.variables?.input?.stateId === "state-done", "completed picks the team's first completed state by position");
}

{
  const { host, bodies } = hostQueue([updatedEnvelope]);
  try {
    await updateIssue.execute({ id: "  " }, host);
    assert(false, "empty id must throw");
  } catch {
    assert(bodies.length === 0, "empty id is rejected before POST");
  }
}

{
  const { host, bodies } = hostQueue([updatedEnvelope]);
  try {
    await updateIssue.execute({ id: "issue-1" }, host);
    assert(false, "an update with no fields must throw");
  } catch (error) {
    assert(bodies.length === 0, "nothing-to-update is rejected before POST");
    assert(String((error as Error).message).length > 0, "the empty update names the problem");
  }
}

{
  const { host, bodies } = hostQueue([updatedEnvelope]);
  try {
    await updateIssue.execute({ id: "issue-1", stateType: "done" }, host);
    assert(false, "unknown stateType must throw");
  } catch (error) {
    assert(bodies.length === 0, "unknown stateType is rejected before POST");
    assert(String((error as Error).message).includes("completed"), "the error lists the allowed state types");
  }
}

{
  const { host, bodies } = hostQueue([
    { data: { issue: { team: { states: { nodes: [{ id: "state-progress", name: "In Progress", type: "started", position: 1 }] } } } } },
  ]);
  try {
    await updateIssue.execute({ id: "issue-1", stateType: "completed" }, host);
    assert(false, "a missing state type on the team must throw");
  } catch (error) {
    assert(bodies.length === 1, "the team states were loaded");
    assert(String((error as Error).message).includes("completed"), "the missing-state error names the type");
  }
}

const updateInvalidations = await updateIssue.invalidates?.({ id: "issue-1", stateType: "completed" });
assert(
  updateInvalidations?.some((row) => row.query === "assignedIssues" && row.key === undefined) === true,
  "status changes drop completed issues out of the assigned list, so that cache must go",
);
assert(
  updateInvalidations?.some((row) => row.query === "teamIssues" && row.key === undefined) === true,
  "status changes drop completed issues out of team lists; the issue id does not name a team, so every teamIssues key goes",
);

try {
  await updateIssue.execute({ id: "issue-1", title: "x" }, hostFor({}, false));
  assert(false, "disconnected update must throw");
} catch (error) {
  assert(
    typeof error === "object" && error !== null && (error as { kind?: string }).kind === "disconnected",
    "a missing credential is disconnected, not a generic error",
  );
}

try {
  await updateIssue.execute(
    { id: "issue-1", title: "x" },
    hostFor({ data: { issueUpdate: { success: false, issue: null } } }),
  );
  assert(false, "a failed update must throw");
} catch (error) {
  assert(String((error as Error).message).length > 0, "Linear refusing the update is surfaced");
}

console.log("linear provider.assert: ok");
