/**
 * Two connected accounts, for the Wizard's Linear/GitHub demo.
 *
 * On the desktop a provider's `host.http` call goes to Rust, which adds the
 * account's token and asks the real API. Here the same call is answered with a
 * response in that API's own shape: a GraphQL envelope for Linear, the search
 * API's `items` for GitHub. The shipping provider code (extensions/linear,
 * extensions/github) then parses, validates and maps it exactly as it would a
 * live answer, so what reaches the widget has been through everything real
 * except the network.
 *
 * Every other provider stays disconnected: the page has no account for it and
 * pretending otherwise would put invented data in widgets nobody scripted.
 */

type Args = Record<string, unknown>;

const LINEAR = "kavibay.linear/linear";
const GITHUB = "kavibay.github/github";
const CONNECTED = new Set([LINEAR, GITHUB]);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Four rows in all: what the Wizard's preview card shows without growing past the stage. */
const LINEAR_ISSUES = [
  { identifier: "ENG-412", title: "Palette should rank generated drafts first", state: ["In Progress", "started"], ago: 25 },
  { identifier: "ENG-405", title: "Desk: keep mention chips when duplicating a card", state: ["In Review", "started"], ago: 190 },
];

const GITHUB_REVIEWS = [
  { number: 318, title: "feat: Wizard mention chips in the composer", ago: 12 },
  { number: 314, title: "fix: runtime sandbox CSP on generated previews", ago: 300 },
];

function linearAssignedIssues() {
  return {
    data: {
      viewer: {
        assignedIssues: {
          nodes: LINEAR_ISSUES.map((issue) => ({
            id: `demo-${issue.identifier}`,
            identifier: issue.identifier,
            title: issue.title,
            url: `https://linear.app/kavibay/issue/${issue.identifier}`,
            updatedAt: minutesAgo(issue.ago),
            state: { name: issue.state[0], type: issue.state[1] },
            team: { name: "Engineering", key: "ENG" },
          })),
        },
      },
    },
  };
}

function githubReviewRequests() {
  return {
    total_count: GITHUB_REVIEWS.length,
    items: GITHUB_REVIEWS.map((pull) => ({
      number: pull.number,
      title: pull.title,
      repository_url: "https://api.github.com/repos/kavibay/kavibay",
      html_url: `https://github.com/kavibay/kavibay/pull/${pull.number}`,
      updated_at: minutesAgo(pull.ago),
    })),
  };
}

/** The one response each scripted query needs; anything else is refused. */
function respond(providerId: string, url: string, body: unknown): { status: number; body: unknown } {
  const query = String((body as { query?: unknown } | null)?.query ?? "");
  if (providerId === LINEAR && url.startsWith("https://api.linear.app/graphql") && query.includes("assignedIssues")) {
    return { status: 200, body: linearAssignedIssues() };
  }
  if (providerId === GITHUB && url.startsWith("https://api.github.com/search/issues")) {
    return { status: 200, body: githubReviewRequests() };
  }
  return { status: 404, body: { message: "Not part of this demo" } };
}

export const PROVIDER_ANSWERS: Record<string, (args: Args) => unknown> = {
  extension_provider_is_connected: (args) => CONNECTED.has(String(args.providerId)),
  extension_provider_connection: (args) =>
    CONNECTED.has(String(args.providerId))
      ? {
          owner: args.owner,
          packageId: args.packageId,
          credentialId: `demo:${String(args.providerId)}`,
          available: true,
          revision: 1,
        }
      : null,
  extension_provider_fetch: (args) => respond(String(args.providerId), String(args.url), args.body),
};
