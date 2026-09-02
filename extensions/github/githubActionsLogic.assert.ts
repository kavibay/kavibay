// SPDX-License-Identifier: MIT
import {
  classifyFetchError,
  formatRelativeTime,
  isRepoConfigured,
  normalizeSettings,
  pickSpotlight,
  pollIntervalMs,
  shouldExpandJob,
  statusTone,
  stepProgress,
  POLL_INTERVAL_ACTIVE_MS,
  POLL_INTERVAL_IDLE_MS,
  type RunDetail,
  type RunSummary,
} from "./githubActionsLogic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(normalizeSettings({ owner: "  octo  ", repo: " hello-world " }).owner === "octo", "normalize trims owner");
assert(normalizeSettings({ owner: "  octo  ", repo: " hello-world " }).repo === "hello-world", "normalize trims repo");
assert(normalizeSettings(null).owner === "", "normalize null owner");
assert(normalizeSettings(null).repo === "", "normalize null repo");
assert(isRepoConfigured({ owner: "octo", repo: "repo" }), "configured when owner+repo set");
assert(!isRepoConfigured({ owner: "octo", repo: "" }), "not configured without repo");

const completedRun: RunSummary = {
  id: 1, name: "CI", status: "completed", conclusion: "success", branch: "main", event: "push",
  htmlUrl: "https://github.com/o/r/actions/runs/1", createdAt: "2026-07-22T10:00:00Z", updatedAt: "2026-07-22T10:05:00Z",
};
const inProgressRun: RunSummary = {
  id: 2, name: "Deploy", status: "in_progress", conclusion: null, branch: "main", event: "push",
  htmlUrl: "https://github.com/o/r/actions/runs/2", createdAt: "2026-07-22T11:00:00Z", updatedAt: "2026-07-22T11:01:00Z",
};

assert(pickSpotlight([completedRun, inProgressRun])?.id === 2, "pickSpotlight prefers in_progress");
assert(pickSpotlight([completedRun])?.id === 1, "pickSpotlight falls back to newest");
assert(pickSpotlight([]) === null, "pickSpotlight empty list");

const detail: RunDetail = {
  ...inProgressRun,
  jobsError: null,
  jobs: [{
    id: 10, name: "build", status: "in_progress", conclusion: null,
    steps: [
      { name: "Checkout", status: "completed", conclusion: "success", number: 1 },
      { name: "Build", status: "in_progress", conclusion: null, number: 2 },
    ],
  }],
};
assert(stepProgress(detail).done === 1 && stepProgress(detail).total === 2, "stepProgress counts steps");
assert(pollIntervalMs(inProgressRun) === POLL_INTERVAL_ACTIVE_MS, "poll fast when in_progress");
assert(pollIntervalMs(completedRun) === POLL_INTERVAL_IDLE_MS, "poll slow when completed");
assert(classifyFetchError("unauthorized") === "unauthorized", "classify unauthorized");
assert(classifyFetchError({ kind: "rate-limited", message: "wait" }) === "rate_limited", "classify rate limit");
assert(formatRelativeTime("2026-07-22T12:00:00Z", Date.parse("2026-07-22T12:05:00Z")) === "5m ago", "relative minutes");
assert(shouldExpandJob(detail.jobs[0]!), "expand in_progress job");
assert(!shouldExpandJob({ id: 2, name: "y", status: "completed", conclusion: "success", steps: [] }), "do not expand success job");
assert(statusTone("completed", "success") === "success", "tone success");

console.log("githubActionsLogic.assert: ok");
