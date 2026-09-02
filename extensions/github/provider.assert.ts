// SPDX-License-Identifier: MIT
import type { ProviderHostContext } from "@sdk/contract/sdk";
import { githubProvider, type GithubRepoStatus } from "./provider";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hostFor(
  runs: unknown,
  jobs: unknown | Error,
): ProviderHostContext {
  return {
    credentials: { isConnected: async () => true },
    http: {
      get: async <T>(url: string): Promise<T> => {
        if (url.endsWith("/jobs")) {
          if (jobs instanceof Error) throw jobs;
          return jobs as T;
        }
        return runs as T;
      },
      post: async () => undefined as never,
      put: async () => undefined as never,
    },
  };
}

const fetchRepoStatus = githubProvider.queries.repoStatus.fetch;

const runs = {
  workflow_runs: [
    {
      id: 10,
      name: "CI",
      status: "completed",
      conclusion: "success",
      head_branch: "main",
      event: "push",
      html_url: "https://github.com/o/r/actions/runs/10",
      created_at: "2026-08-20T08:00:00Z",
      updated_at: "2026-08-20T08:05:00Z",
    },
    {
      id: 11,
      name: "Deploy",
      status: "in_progress",
      conclusion: null,
      head_branch: "release",
      event: "workflow_dispatch",
      html_url: "https://github.com/o/r/actions/runs/11",
      created_at: "2026-08-20T09:00:00Z",
      updated_at: "2026-08-20T09:01:00Z",
    },
  ],
};

const jobs = {
  jobs: [{
    id: 100,
    name: "build",
    status: "in_progress",
    conclusion: null,
    steps: [
      { name: "Checkout", status: "completed", conclusion: "success", number: 1 },
      { name: "Test", status: "in_progress", conclusion: null, number: 2 },
    ],
  }],
};

const result = await fetchRepoStatus(
  { owner: " octo ", repo: " hello-world " },
  hostFor(runs, jobs),
) as GithubRepoStatus;

assert(result.owner === "octo", "provider trims the owner before building the API path");
assert(result.repo === "hello-world", "provider trims the repository before building the API path");
assert(result.spotlight?.id === 11, "active run is the spotlight");
assert(result.spotlight?.jobs[0]?.steps[1]?.name === "Test", "nested jobs and steps are normalized");
assert(result.spotlight?.jobsError === null, "successful jobs fetch has no error");
assert(result.recent.length === 2 && result.fetchedAt.length > 0, "recent and fetch timestamp are present");

const partial = await fetchRepoStatus(
  { owner: "octo", repo: "hello-world" },
  hostFor(runs, new Error("jobs offline")),
) as GithubRepoStatus;
assert(partial.spotlight?.jobs.length === 0, "partial jobs failure keeps the run snapshot");
assert(partial.spotlight?.jobsError === "jobs offline", "partial jobs failure is visible in the DTO");

const empty = await fetchRepoStatus(
  { owner: "octo", repo: "empty" },
  hostFor({ workflow_runs: [] }, jobs),
) as GithubRepoStatus;
assert(empty.spotlight === null && empty.recent.length === 0, "empty repositories have no spotlight");

console.log("github provider.assert: ok");
