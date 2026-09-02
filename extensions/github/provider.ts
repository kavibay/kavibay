// SPDX-License-Identifier: MIT
import { declaredQuery } from "@sdk/contract/declaredQuery";
import { defineProvider } from "@sdk/contract/sdk";

export const PROVIDER_ID = "kavibay.github/github";

export interface GithubRunSummary {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  event: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface GithubStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

export interface GithubJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  steps: GithubStep[];
}

export type GithubRunDetail = GithubRunSummary & {
  jobs: GithubJob[];
  jobsError: string | null;
};

export interface GithubRepoStatus {
  owner: string;
  repo: string;
  spotlight: GithubRunDetail | null;
  recent: GithubRunSummary[];
  fetchedAt: string;
}

interface GithubActionsQueryArgs {
  owner: string;
  repo: string;
}

interface WorkflowRunsResponse {
  workflow_runs?: unknown;
}

interface JobsResponse {
  jobs?: unknown;
}

const API_BASE = "https://api.github.com";
const RUNS_PER_PAGE = 10;
const JOBS_PER_PAGE = 100;
const RECENT_LIMIT = 5;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const optionalString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function requiredNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(message);
  return value;
}

function mapRun(raw: unknown): GithubRunSummary {
  const row = asRecord(raw);
  return {
    id: requiredNumber(row.id, "workflow_run missing id"),
    name: typeof row.name === "string" ? row.name : "",
    status: typeof row.status === "string" ? row.status : "",
    conclusion: optionalString(row.conclusion),
    branch: typeof row.head_branch === "string" ? row.head_branch : "",
    event: typeof row.event === "string" ? row.event : "",
    htmlUrl: typeof row.html_url === "string" ? row.html_url : "",
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

function mapStep(raw: unknown): GithubStep {
  const row = asRecord(raw);
  return {
    name: typeof row.name === "string" ? row.name : "",
    status: typeof row.status === "string" ? row.status : "",
    conclusion: optionalString(row.conclusion),
    number: requiredNumber(row.number, "step missing number"),
  };
}

function mapJob(raw: unknown): GithubJob {
  const row = asRecord(raw);
  const steps = row.steps === undefined || row.steps === null
    ? []
    : Array.isArray(row.steps)
      ? row.steps.map(mapStep)
      : (() => { throw new Error("job steps is not an array"); })();
  return {
    id: requiredNumber(row.id, "job missing id"),
    name: typeof row.name === "string" ? row.name : "",
    status: typeof row.status === "string" ? row.status : "",
    conclusion: optionalString(row.conclusion),
    steps,
  };
}

function mapRuns(raw: WorkflowRunsResponse): GithubRunSummary[] {
  if (!Array.isArray(raw?.workflow_runs)) throw new Error("workflow_runs missing or not an array");
  return raw.workflow_runs.map(mapRun);
}

function mapJobs(raw: JobsResponse): GithubJob[] {
  if (!Array.isArray(raw?.jobs)) throw new Error("jobs missing or not an array");
  return raw.jobs.map(mapJob);
}

function pickSpotlight(runs: GithubRunSummary[]): GithubRunSummary | null {
  return runs.find((run) => run.status === "queued" || run.status === "in_progress") ?? runs[0] ?? null;
}

function errorMessage(cause: unknown): string {
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(cause);
}

function buildRepoStatus(
  owner: string,
  repo: string,
  runs: GithubRunSummary[],
  jobs: GithubJob[],
  jobsError: string | null,
): GithubRepoStatus {
  const spotlight = pickSpotlight(runs);
  return {
    owner,
    repo,
    spotlight: spotlight
      ? { ...spotlight, jobs, jobsError }
      : null,
    recent: runs.slice(0, RECENT_LIMIT),
    fetchedAt: new Date().toISOString(),
  };
}

const summarySchema = {
  type: "object" as const,
  fields: {
    id: { type: "number" as const },
    name: { type: "string" as const },
    status: { type: "string" as const },
    conclusion: { type: "string" as const, nullable: true },
    branch: { type: "string" as const },
    event: { type: "string" as const },
    htmlUrl: { type: "string" as const },
    createdAt: { type: "string" as const },
    updatedAt: { type: "string" as const },
  },
};

const jobSchema = {
  type: "object" as const,
  fields: {
    id: { type: "number" as const },
    name: { type: "string" as const },
    status: { type: "string" as const },
    conclusion: { type: "string" as const, nullable: true },
    steps: {
      type: "list" as const,
      of: {
        type: "object" as const,
        fields: {
          name: { type: "string" as const },
          status: { type: "string" as const },
          conclusion: { type: "string" as const, nullable: true },
          number: { type: "number" as const },
        },
      },
    },
  },
};

const detailSchema = {
  type: "object" as const,
  fields: {
    ...summarySchema.fields,
    jobs: { type: "list" as const, of: jobSchema },
    jobsError: { type: "string" as const, nullable: true },
  },
};

export const githubProvider = defineProvider({
  name: "github",
  displayName: "GitHub",
  requiresCredential: true,
  credentialType: "githubPat",
  hosts: ["api.github.com"],
  queries: {
    /**
     * The query this whole change was about: "show me the pull requests waiting
     * for my review", added without a Rust line, without a `fetch`, and without
     * anything a reviewer has to trace through — a URL, a fixed search term,
     * and which four fields of the answer matter.
     */
    reviewRequests: declaredQuery({
      description: "Pull requests waiting for your review",
      get: "https://api.github.com/search/issues",
      query: {
        // `const`, not an argument: a widget that could write its own search
        // term could read any issue the token can see, which is a different
        // permission from the one the description asks for.
        q: { const: "is:open is:pr review-requested:@me archived:false" },
        per_page: { const: 20 },
        sort: { const: "updated" },
      },
      select: "items",
      result: {
        type: "list",
        of: {
          type: "object",
          fields: {
            title: { type: "string" },
            repository: { type: "string" },
            url: { type: "string" },
            updatedAt: { type: "string" },
          },
        },
      },
      pick: {
        title: "title",
        // The search API returns the repo as an API url; the last two segments
        // are owner/name. Left as the url rather than trimmed, because trimming
        // is logic and this form deliberately has none — a widget that wants a
        // short name can take the tail of it.
        repository: "repository_url",
        url: "html_url",
        updatedAt: "updated_at",
      },
      staleTime: 5 * 60 * 1000,
    }),
    repoStatus: {
      description: "Recent workflow runs and job progress for one repository",
      args: {
        owner: { type: "string", label: "Owner", required: true },
        repo: { type: "string", label: "Repository", required: true },
      },
      result: {
        type: "object",
        fields: {
          owner: { type: "string" },
          repo: { type: "string" },
          spotlight: { ...detailSchema, nullable: true },
          recent: { type: "list", of: summarySchema },
          fetchedAt: { type: "string" },
        },
      },
      key: (args: GithubActionsQueryArgs) => [args.owner.trim(), args.repo.trim()],
      staleTime: 30_000,
      fetch: async (args: GithubActionsQueryArgs, host): Promise<GithubRepoStatus> => {
        const owner = args.owner.trim();
        const repo = args.repo.trim();
        if (!owner || !repo) throw new Error("owner and repo required");
        if (!(await host.credentials.isConnected())) throw { kind: "disconnected", message: "GitHub is not connected" };

        const runsRaw = await host.http.get<WorkflowRunsResponse>(
          `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs`,
          { per_page: RUNS_PER_PAGE },
        );
        const runs = mapRuns(runsRaw);
        const spotlight = pickSpotlight(runs);
        if (!spotlight) return buildRepoStatus(owner, repo, runs, [], null);

        try {
          const jobsRaw = await host.http.get<JobsResponse>(
            `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${spotlight.id}/jobs`,
            { per_page: JOBS_PER_PAGE },
          );
          return buildRepoStatus(owner, repo, runs, mapJobs(jobsRaw), null);
        } catch (cause) {
          // A run list is still useful when the jobs endpoint is unavailable.
          // Keep this partial failure in the normalized result instead of
          // making the whole widget disappear.
          return buildRepoStatus(owner, repo, runs, [], errorMessage(cause));
        }
      },
    },
  },
  actions: {},
});

export default githubProvider;
