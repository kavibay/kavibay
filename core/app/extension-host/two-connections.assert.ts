import {
  defineExtension,
  defineProvider,
  defineWidget,
  type ExtensionSource,
  type ProviderHostContext,
  type WidgetContext,
} from "@sdk/contract/sdk";
import { ExtensionRegistry } from "./registry";
import { Host } from "./runtime";
import { makeUi } from "./fixtures/harness";
import type { Fetcher } from "./http";
import type { ProviderConnection, ProviderTransport } from "./providerTransport";

/**
 * Asserts for two accounts of one platform, side by side.
 * Run: npx tsx core/app/extension-host/two-connections.assert.ts
 *
 * The case the connection model exists for: Linear issues one API key per
 * workspace, so "connected to Linear" is not a fact about Linear — it is a fact
 * about one widget instance and one saved key. Two widgets on one desk must be
 * able to show different workspaces at the same time.
 *
 * What is under test is the *host*: whether it keeps two accounts apart across
 * the cache, and whether it fails closed when a widget has not chosen one. The
 * provider here is a fixture rather than `extensions/linear`, because the
 * behaviour being pinned is not Linear's — and because `core/app/` naming an
 * extension is a boundary the import guard only lets shrink.
 *
 * What each block pins down:
 *  - two instances on different connections do not share a cache entry, even
 *    though provider, query and arguments are identical;
 *  - two instances on the *same* connection still do share one, so a second
 *    widget stays free;
 *  - an unchosen, deleted or disconnected connection fails closed. This is the
 *    one that matters: falling back to "the other account" would silently show
 *    a user their personal workspace inside a work widget, and nothing on
 *    screen would say so;
 *  - switching a connection, or editing the key behind one, serves the new
 *    account rather than the previous answer.
 */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

interface Issue {
  id: string;
  title: string;
  workspace: string;
}

/** Issue rows per workspace, so a wrong account is visible in the result. */
const WORKSPACES: Record<string, string> = { "cred-work": "Work", "cred-personal": "Personal" };

const PROVIDER = "kavibay.tracker/tracker";

/**
 * A credential-backed provider in the shape the real ones have: it declares its
 * credential type, guards on `isConnected`, and posts to one host. It never
 * names an account — the host attaches one, which is the invariant under test.
 */
const tracker = defineProvider({
  name: "tracker",
  displayName: "Tracker",
  requiresCredential: true,
  credentialType: "linearApi",
  hosts: ["api.example.com"],
  queries: {
    assignedIssues: {
      description: "Open issues assigned to you",
      args: {},
      key: () => [],
      staleTime: 60_000,
      fetch: async (_args: Record<string, never>, host: ProviderHostContext): Promise<Issue[]> => {
        if (!(await host.credentials.isConnected())) {
          throw { kind: "disconnected", message: "tracker is not connected" };
        }
        return host.http.post<Issue[]>("https://api.example.com/graphql", { query: "{ issues }" });
      },
    },
  },
  actions: {},
});

/**
 * Stands in for the Rust side: the binding store, the availability check and
 * the network. `credentialId` arrives from the host on every fetch, which is
 * the whole point — provider code never passes one.
 */
function makeTransport() {
  const bindings = new Map<string, string>();
  const revisions = new Map<string, number>();
  const available = new Set<string>(Object.keys(WORKSPACES));
  const fetched: string[] = [];
  /** The package ids the host asked Rust to check a grant for. */
  const grantChecks: string[] = [];

  const transport: ProviderTransport = {
    async fetch(_providerId, _url, _method, _body, connection) {
      const credentialId = connection?.credentialId ?? "none";
      fetched.push(credentialId);
      // As the host does: the account must be the one bound to the owner asking.
      if (!connection?.owner || bindings.get(connection.owner) !== credentialId) {
        return { status: 409, body: "connection_changed" };
      }
      const workspace = WORKSPACES[credentialId];
      if (!workspace) return { status: 401, body: "no such connection" };
      return {
        status: 200,
        body: [{ id: `${workspace}-1`, title: `${workspace} issue`, workspace }],
      };
    },
    async capabilityFetch() {
      return { status: 500, body: "a provider never uses the capability path" };
    },
    async isConnected(_providerId, owner) {
      const id = bindings.get(owner ?? "");
      return Boolean(id && available.has(id));
    },
    async connection(_providerId, owner, packageId): Promise<ProviderConnection | null> {
      if (packageId) grantChecks.push(packageId);
      const credentialId = bindings.get(owner) ?? null;
      return {
        credentialId,
        available: Boolean(credentialId && available.has(credentialId)),
        revision: credentialId ? (revisions.get(credentialId) ?? 1) : 0,
      };
    },
  };

  return {
    transport,
    fetched,
    grantChecks,
    bind: (instanceId: string, credentialId: string) =>
      bindings.set(`widget:${instanceId}`, credentialId),
    /** The user deleted the saved key, or its token expired. */
    revoke: (credentialId: string) => available.delete(credentialId),
    /** The user replaced the key on an existing connection. */
    reKey: (credentialId: string) =>
      revisions.set(credentialId, (revisions.get(credentialId) ?? 1) + 1),
  };
}

const myIssues = defineWidget({
  name: "my-issues",
  displayName: "My issues",
  defaultSize: { w: 3, h: 3 },
  requires: { providers: [PROVIDER] },
  component: {
    async setup(ctx: WidgetContext) {
      return { issues: await ctx.providers![PROVIDER]!.query<Issue[]>("assignedIssues", {}) };
    },
  },
});

/** Never called: every provider fetch goes through the transport. */
const fetcher: Fetcher = async () => {
  throw new Error("the provider path must not reach the local fetcher");
};

function boot(demoSource: ExtensionSource = { kind: "bundled" }) {
  const reg = new ExtensionRegistry();
  reg.load(
    defineExtension({
      name: "tracker",
      version: "1.0.0",
      displayName: "Tracker",
      engines: { kavibay: "^0.1" },
      contributes: { providers: [tracker] },
    }) as never,
    { kind: "bundled" },
  );
  reg.load(
    defineExtension({
      name: "demo",
      version: "1.0.0",
      displayName: "Demo",
      engines: { kavibay: "^0.1" },
      dependencies: { "kavibay.tracker": { version: "*" } },
      contributes: { widgets: [myIssues] },
    }) as never,
    demoSource,
  );
  const failed = reg.link();
  assert(failed.length === 0, `the tracker widget must link: ${JSON.stringify(reg.errors)}`);
  const fake = makeTransport();
  return { reg, fake, host: new Host(reg, fetcher, makeUi({}).ui, fake.transport) };
}

function instance(id: string, definitionId = "kavibay.demo/my-issues") {
  return {
    id,
    definitionId,
    configuration: {},
    position: { x: 0, y: 0 },
    size: { w: 3, h: 3 },
    mode: "compact" as const,
  };
}

/** Reads through the widget's own handle, the way the gate mounts it. */
async function issuesOf(host: Host, id: string, definitionId?: string): Promise<Issue[]> {
  const ctx = host.buildWidgetContext(instance(id, definitionId));
  return (await ctx.providers![PROVIDER]!.query<Issue[]>("assignedIssues", {})) ?? [];
}

// --- two instances, two workspaces, one query name ---
{
  const { host, fake } = boot();
  fake.bind("work", "cred-work");
  fake.bind("home", "cred-personal");

  const work = await issuesOf(host, "work");
  const home = await issuesOf(host, "home");

  assert(work[0]?.workspace === "Work", `the work widget read the work account: ${work[0]?.workspace}`);
  assert(home[0]?.workspace === "Personal", `the home widget read its own: ${home[0]?.workspace}`);
  assert(
    fake.fetched.join() === "cred-work,cred-personal",
    `identical query and arguments must not collide in the cache: ${fake.fetched.join()}`,
  );
}

// --- same connection, one fetch: sharing survives the split ---
{
  const { host, fake } = boot();
  fake.bind("a", "cred-work");
  fake.bind("b", "cred-work");

  await issuesOf(host, "a");
  const second = await issuesOf(host, "b");

  assert(second[0]?.workspace === "Work", "the second widget sees the same account");
  assert(
    fake.fetched.length === 1,
    `two widgets on one account still cost one request: ${fake.fetched.join()}`,
  );
}

/**
 * The fallback that must not exist. With exactly one usable account left, the
 * tempting behaviour is to serve it — which is how a work widget starts showing
 * personal issues after the user deletes a key.
 */
{
  const { host, fake } = boot();
  fake.bind("home", "cred-personal");

  let refused: unknown;
  try {
    await issuesOf(host, "work");
  } catch (error) {
    refused = error;
  }
  assert(
    (refused as { kind?: string })?.kind === "disconnected",
    `an instance with no chosen connection is disconnected: ${JSON.stringify(refused)}`,
  );
  assert(fake.fetched.length === 0, "and nothing was requested on another account's behalf");
}

// --- a deleted or expired connection stays refused, it does not re-resolve ---
{
  const { host, fake } = boot();
  fake.bind("work", "cred-work");
  fake.bind("home", "cred-personal");
  await issuesOf(host, "work");
  fake.revoke("cred-work");

  let refused: unknown;
  try {
    await issuesOf(host, "work");
  } catch (error) {
    refused = error;
  }
  assert(
    (refused as { kind?: string })?.kind === "disconnected",
    `a deleted connection is refused, not replaced: ${JSON.stringify(refused)}`,
  );
  assert(
    (await issuesOf(host, "home"))[0]?.workspace === "Personal",
    "and the other widget is untouched by it",
  );
}

// --- switching accounts serves the new one, not the cached answer ---
{
  const { host, fake } = boot();
  fake.bind("w", "cred-work");
  assert((await issuesOf(host, "w"))[0]?.workspace === "Work", "starts on the work account");

  fake.bind("w", "cred-personal");
  assert(
    (await issuesOf(host, "w"))[0]?.workspace === "Personal",
    "switching the connection switches the data",
  );
}

/**
 * Editing the key behind a connection keeps its id, so the id alone cannot be
 * the cache identity: the revision is what makes a re-keyed account re-fetch
 * instead of replaying a body fetched with the old token.
 */
{
  const { host, fake } = boot();
  fake.bind("w", "cred-work");
  await issuesOf(host, "w");
  assert(fake.fetched.length === 1, "one fetch so far");

  await issuesOf(host, "w");
  assert(fake.fetched.length === 1, "an unchanged connection reads the cache");

  fake.reKey("cred-work");
  await issuesOf(host, "w");
  assert(fake.fetched.length === 2, `a re-keyed connection refetches: ${fake.fetched.join()}`);
}

/**
 * Only bundled code skips the grant. The host checks a grant only for a
 * package id it is sent, so the tier that decides whether one is sent has to
 * fail closed: a signed catalog package is `reviewed`, not bundled, and used
 * to spend the account without being asked.
 */
{
  const bundled = boot();
  bundled.fake.bind("w", "cred-work");
  await issuesOf(bundled.host, "w");
  assert(bundled.fake.grantChecks.length === 0, "bundled code holds no grant and is not asked for one");

  const reviewed = boot({ kind: "catalog", entry: "acme/demo", signature: "signed" });
  reviewed.fake.bind("w", "cred-work");
  await issuesOf(reviewed.host, "w", "acme.demo/my-issues");
  assert(
    reviewed.fake.grantChecks.join() === "demo",
    `a reviewed package is checked against its grant: ${reviewed.fake.grantChecks.join()}`,
  );
}

console.log("two-connections.assert.ts: ok");
