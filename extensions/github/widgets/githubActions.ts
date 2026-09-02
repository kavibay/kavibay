// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, type ComputedRef } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import {
  displayTitle,
  shouldExpandJob,
  statusTone,
  stepProgress,
  type Job,
} from "../githubActionsLogic";
import { PROVIDER_ID, type GithubRepoStatus } from "../provider";

export interface GithubActionsConfig {
  owner: string;
  repo: string;
}

export interface GithubActionsModel {
  title: ComputedRef<string>;
  spotlight: ComputedRef<GithubRepoStatus["spotlight"]>;
  recent: ComputedRef<GithubRepoStatus["recent"]>;
  progress: ComputedRef<{ done: number; total: number }>;
  progressPct: ComputedRef<number>;
  jobExpanded(job: Job): boolean;
  toggleJob(job: Job): void;
  recentMark(item: { status: string; conclusion: string | null }): string;
  openRun(url: string): Promise<void>;
}

export const githubActionsWidget = defineWidget<GithubActionsConfig>({
  name: "github-actions",
  displayName: "GitHub Actions",
  description: "Spotlight workflow run with job and step progress for one repository.",
  defaultSize: { w: 3, h: 4 },
  minSize: { w: 2, h: 3 },
  mode: "both",
  requires: { providers: [PROVIDER_ID] },
  capabilities: { openExternal: true },
  configuration: {
    owner: { type: "string", label: "Owner", required: true },
    repo: { type: "string", label: "Repository", required: true },
  },
  component: {
    async setup(ctx: WidgetContext<GithubActionsConfig>): Promise<GithubActionsModel> {
      const owner = String(ctx.config.owner ?? "").trim();
      const repo = String(ctx.config.repo ?? "").trim();
      if (!owner || !repo) throw { kind: "unconfigured", message: "Owner and repository are required" };

      const status = ref<GithubRepoStatus | null>(null);
      const jobExpansionOverrides = ref<Map<number, boolean>>(new Map());
      const provider = ctx.providers![PROVIDER_ID]!;
      const subscription = await provider.subscribe<GithubRepoStatus>(
        "repoStatus",
        { owner, repo },
        (state) => {
          if (state.status === "success") status.value = state.data;
        },
      );
      onScopeDispose(() => subscription.unsubscribe());

      const spotlight = computed(() => status.value?.spotlight ?? null);
      const recent = computed(() => status.value?.recent ?? []);
      const progress = computed(() => stepProgress(spotlight.value));
      const progressPct = computed(() => {
        const { done, total } = progress.value;
        return total > 0 ? Math.round((done / total) * 100) : 0;
      });

      const jobExpanded = (job: Job) =>
        jobExpansionOverrides.value.get(job.id) ?? shouldExpandJob(job);
      const toggleJob = (job: Job) => {
        const next = new Map(jobExpansionOverrides.value);
        next.set(job.id, !jobExpanded(job));
        jobExpansionOverrides.value = next;
      };
      const recentMark = (item: { status: string; conclusion: string | null }): string => {
        const tone = statusTone(item.status, item.conclusion);
        if (tone === "success") return "✓";
        if (tone === "failure") return "✕";
        if (tone === "progress") return "●";
        if (tone === "queued") return "○";
        if (tone === "cancelled") return "–";
        return "·";
      };
      const openRun = async (url: string) => {
        if (url) await ctx.openExternal!.open(url);
      };

      return {
        title: computed(() => displayTitle({ owner, repo })),
        spotlight,
        recent,
        progress,
        progressPct,
        jobExpanded,
        toggleJob,
        recentMark,
        openRun,
      };
    },
  },
});
