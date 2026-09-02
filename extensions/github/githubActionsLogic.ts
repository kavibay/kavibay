// SPDX-License-Identifier: MIT
import type { GithubJob, GithubRepoStatus, GithubRunDetail, GithubRunSummary, GithubStep } from "./provider";

export interface GithubActionsSettings {
  owner: string;
  repo: string;
}

export type RunSummary = GithubRunSummary;
export type Job = GithubJob;
export type RunDetail = GithubRunDetail;
export type RepoStatus = GithubRepoStatus;

export const POLL_INTERVAL_ACTIVE_MS = 8000;
export const POLL_INTERVAL_IDLE_MS = 30000;
export const RATE_LIMIT_BACKOFF_MS = 60_000;

export type FetchErrorKind =
  | "unauthorized"
  | "rate_limited"
  | "forbidden"
  | "not_found"
  | "no_token"
  | "other";

export function normalizeSettings(raw: unknown): GithubActionsSettings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    owner: typeof value.owner === "string" ? value.owner.trim() : "",
    repo: typeof value.repo === "string" ? value.repo.trim() : "",
  };
}

export function pickSpotlight(runs: RunSummary[]): RunSummary | null {
  return runs.find((run) => run.status === "queued" || run.status === "in_progress") ?? runs[0] ?? null;
}

function isStepCompleted(step: GithubStep): boolean {
  return step.status === "completed" || step.conclusion != null;
}

export function stepProgress(detail: RunDetail | null): { done: number; total: number } {
  if (!detail?.jobs?.length) return { done: 0, total: 0 };
  let done = 0;
  let total = 0;
  for (const job of detail.jobs) {
    for (const step of job.steps ?? []) {
      total += 1;
      if (isStepCompleted(step)) done += 1;
    }
  }
  return { done, total };
}

export function statusLabel(status: string, conclusion: string | null): string {
  if (status === "queued") return "Queued";
  if (status === "in_progress") return "In progress";
  if (status === "waiting") return "Waiting";
  if (status === "requested") return "Requested";
  if (status === "pending") return "Pending";
  if (status === "completed") {
    switch (conclusion) {
      case "success": return "Success";
      case "failure": return "Failed";
      case "cancelled": return "Cancelled";
      case "skipped": return "Skipped";
      case "neutral": return "Neutral";
      case "timed_out": return "Timed out";
      case "action_required": return "Action required";
      case "stale": return "Stale";
      default: return "Completed";
    }
  }
  return status.replace(/_/g, " ");
}

export function pollIntervalMs(spotlight: RunSummary | null): number {
  return spotlight?.status === "queued" || spotlight?.status === "in_progress"
    ? POLL_INTERVAL_ACTIVE_MS
    : POLL_INTERVAL_IDLE_MS;
}

export function isRepoConfigured(settings: GithubActionsSettings): boolean {
  const normalized = normalizeSettings(settings);
  return Boolean(normalized.owner && normalized.repo);
}

export function displayTitle(settings: GithubActionsSettings): string {
  return normalizeSettings(settings).repo || "GitHub Actions";
}

export function classifyFetchError(cause: unknown): FetchErrorKind {
  const record = cause && typeof cause === "object" ? cause as Record<string, unknown> : {};
  const m = `${typeof record.kind === "string" ? record.kind : ""} ${typeof record.message === "string" ? record.message : String(cause)}`.toLowerCase();
  if (m.includes("unauthorized") || m.includes("auth-expired")) return "unauthorized";
  if (m.includes("rate_limited") || m.includes("rate-limited")) return "rate_limited";
  if (m.includes("forbidden") || m.includes("permission-denied")) return "forbidden";
  if (m.includes("not_found") || m.includes("not-found")) return "not_found";
  if (m.includes("no_token")) return "no_token";
  return "other";
}

export function formatRelativeTime(iso: string, nowMs = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.round((nowMs - time) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function shouldExpandJob(job: Job): boolean {
  if (job.status === "in_progress" || job.status === "queued") return true;
  return job.conclusion === "failure" || job.conclusion === "timed_out";
}

export function statusTone(status: string, conclusion: string | null): string {
  if (["queued", "waiting", "pending", "requested"].includes(status)) return "queued";
  if (status === "in_progress") return "progress";
  if (status === "completed") {
    if (conclusion === "success") return "success";
    if (conclusion === "failure" || conclusion === "timed_out") return "failure";
    if (conclusion === "cancelled") return "cancelled";
  }
  return "neutral";
}
