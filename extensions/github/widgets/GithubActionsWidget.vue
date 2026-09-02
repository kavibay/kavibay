<script setup lang="ts">
// SPDX-License-Identifier: MIT
import type { GithubActionsModel } from "./githubActions";
import { formatRelativeTime, statusLabel, statusTone } from "../githubActionsLogic";

const props = defineProps<{ model: GithubActionsModel }>();
const model = props.model;
const spotlight = model.spotlight;
const recent = model.recent;
const progress = model.progress;
const progressPct = model.progressPct;
const title = model.title;
</script>

<template>
  <div class="gha" data-interactive @pointerdown.stop>
    <p class="gha-title">{{ title }}</p>

    <template v-if="!spotlight">
      <p class="gha-status">No workflow runs yet.</p>
    </template>

    <template v-else>
      <div class="gha-content">
        <section class="gha-spotlight">
          <button
            type="button"
            class="gha-spotlight-open"
            :title="spotlight.htmlUrl"
            @click="model.openRun(spotlight.htmlUrl)"
          >
            <span class="gha-pill" :class="`gha-pill--${statusTone(spotlight.status, spotlight.conclusion)}`">
              {{ statusLabel(spotlight.status, spotlight.conclusion) }}
            </span>
            <span class="gha-spotlight-name">{{ spotlight.name }}</span>
            <span class="gha-spotlight-meta">
              <span>{{ spotlight.branch }}</span>
              <span class="gha-dot">·</span>
              <span>{{ formatRelativeTime(spotlight.updatedAt) }}</span>
            </span>

            <div v-if="progress.total > 0" class="gha-progress-row" aria-hidden="true">
              <span class="gha-progress-label">{{ progress.done }}/{{ progress.total }}</span>
              <div class="gha-progress"><div class="gha-progress-bar" :style="{ width: `${progressPct}%` }" /></div>
            </div>
          </button>

          <ul v-if="spotlight.jobs.length" class="gha-jobs">
            <li v-for="job in spotlight.jobs" :key="job.id" class="gha-job">
              <button
                type="button"
                class="gha-job-head"
                :aria-expanded="model.jobExpanded(job)"
                :aria-controls="`gha-job-steps-${job.id}`"
                @click="model.toggleJob(job)"
              >
                <span class="gha-job-mark" :class="`gha-tone--${statusTone(job.status, job.conclusion)}`">
                  {{ model.recentMark(job) }}
                </span>
                <span class="gha-job-name">{{ job.name }}</span>
                <span class="gha-job-status">{{ statusLabel(job.status, job.conclusion) }}</span>
                <span class="gha-job-chevron" :class="{ 'gha-job-chevron--open': model.jobExpanded(job) }">›</span>
              </button>
              <ul v-if="model.jobExpanded(job) && job.steps.length" :id="`gha-job-steps-${job.id}`" class="gha-steps">
                <li v-for="step in job.steps" :key="step.number" class="gha-step" :class="{ 'gha-step--pulse': step.status === 'in_progress' }">
                  <span class="gha-step-mark" :class="`gha-tone--${statusTone(step.status, step.conclusion)}`">
                    {{ model.recentMark(step) }}
                  </span>
                  <span class="gha-step-name">{{ step.name }}</span>
                </li>
              </ul>
            </li>
          </ul>
          <p v-else-if="spotlight.jobsError" class="gha-jobs-miss">Jobs unavailable</p>
        </section>

        <ul v-if="recent.length" class="gha-recent">
          <li v-for="run in recent" :key="run.id">
            <button type="button" class="gha-recent-row" :title="run.htmlUrl" @click="model.openRun(run.htmlUrl)">
              <span class="gha-recent-mark" :class="`gha-tone--${statusTone(run.status, run.conclusion)}`">
                {{ model.recentMark(run) }}
              </span>
              <span class="gha-recent-name">{{ run.name }}</span>
              <span class="gha-recent-branch">{{ run.branch }}</span>
              <span class="gha-recent-age">{{ formatRelativeTime(run.updatedAt) }}</span>
            </button>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.gha { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; padding: 12px; box-sizing: border-box; overflow: hidden; container-type: inline-size; }
.gha-title { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: rgba(var(--fg-rgb), 0.92); }
.gha-content { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; gap: 10px; overflow-y: auto; overscroll-behavior: contain; padding-right: 4px; }
.gha-status, .gha-jobs-miss { margin: 0; font-size: 13px; line-height: 1.4; color: rgba(var(--fg-rgb), 0.6); }
.gha-spotlight { display: flex; flex-direction: column; align-items: stretch; gap: 6px; width: 100%; margin: 0; padding: 10px; border: 1px solid rgba(var(--fg-rgb), 0.08); border-radius: 10px; background: rgba(var(--fg-rgb), 0.04); box-sizing: border-box; }
.gha-spotlight-open { display: flex; flex-direction: column; align-items: stretch; gap: 6px; width: 100%; margin: 0; padding: 0; border: none; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.gha-spotlight-open:hover .gha-spotlight-name { color: rgba(var(--fg-rgb), 0.98); }
.gha-pill { align-self: flex-start; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; background: rgba(var(--fg-rgb), 0.1); color: rgba(var(--fg-rgb), 0.75); }
.gha-pill--success { background: rgba(90, 180, 120, 0.18); color: rgba(140, 230, 170, 0.95); }
.gha-pill--failure { background: rgba(200, 80, 80, 0.2); color: rgba(255, 150, 150, 0.95); }
.gha-pill--progress { background: rgba(100, 160, 200, 0.2); color: rgba(160, 210, 240, 0.95); }
.gha-pill--queued, .gha-pill--cancelled, .gha-pill--neutral { background: rgba(var(--fg-rgb), 0.08); color: rgba(var(--fg-rgb), 0.6); }
.gha-spotlight-name, .gha-job-name, .gha-recent-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gha-spotlight-name { font-size: 13px; font-weight: 600; color: rgba(var(--fg-rgb), 0.92); }
.gha-spotlight-meta { display: flex; align-items: center; gap: 4px; font-size: 11px; color: rgba(var(--fg-rgb), 0.5); }
.gha-dot { opacity: 0.6; }
.gha-progress-row { display: flex; flex-direction: column; gap: 4px; margin-top: 2px; }
.gha-progress { height: 4px; border-radius: 999px; background: rgba(var(--fg-rgb), 0.08); overflow: hidden; }
.gha-progress-bar { height: 100%; border-radius: inherit; background: rgba(140, 190, 220, 0.75); transition: width 0.25s ease; }
.gha-progress-label { align-self: flex-end; font-size: 10px; color: rgba(var(--fg-rgb), 0.4); font-variant-numeric: tabular-nums; }
.gha-jobs, .gha-recent, .gha-steps { list-style: none; margin: 0; padding: 0; }
.gha-jobs { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.gha-job-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 6px; width: 100%; padding: 4px 5px; border: none; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.gha-job-head:hover, .gha-job-head:focus-visible, .gha-recent-row:hover { background: rgba(var(--fg-rgb), 0.07); outline: none; }
.gha-job-chevron { color: rgba(var(--fg-rgb), 0.45); font-size: 16px; line-height: 1; transform: rotate(0deg); transition: transform 0.15s ease; }
.gha-job-chevron--open { transform: rotate(90deg); }
.gha-job-name { font-size: 12px; font-weight: 550; color: rgba(var(--fg-rgb), 0.85); }
.gha-job-status { font-size: 10px; color: rgba(var(--fg-rgb), 0.45); }
.gha-steps { display: flex; flex-direction: column; gap: 2px; margin: 4px 0 0 14px; }
.gha-step { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 6px; padding: 2px 0; font-size: 11px; color: rgba(var(--fg-rgb), 0.65); }
.gha-step-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gha-step--pulse .gha-step-mark { animation: gha-pulse 1.2s ease-in-out infinite; }
@keyframes gha-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
.gha-job-mark, .gha-step-mark, .gha-recent-mark { width: 12px; text-align: center; font-size: 11px; font-variant-numeric: tabular-nums; color: rgba(var(--fg-rgb), 0.45); }
.gha-tone--success { color: rgba(120, 220, 160, 0.95); }
.gha-tone--failure { color: rgba(255, 130, 130, 0.95); }
.gha-tone--progress { color: rgba(160, 210, 240, 0.95); }
.gha-tone--queued { color: rgba(var(--fg-rgb), 0.5); }
.gha-tone--cancelled, .gha-tone--neutral { color: rgba(var(--fg-rgb), 0.4); }
.gha-recent { display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow-y: auto; }
.gha-recent-row { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 6px; width: 100%; margin: 0; padding: 6px 8px; border: none; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.gha-recent-name { font-size: 12px; font-weight: 550; color: rgba(var(--fg-rgb), 0.88); }
.gha-recent-branch { max-width: 72px; overflow: hidden; color: rgba(var(--fg-rgb), 0.45); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.gha-recent-age { min-width: 48px; color: rgba(var(--fg-rgb), 0.4); font-size: 11px; font-variant-numeric: tabular-nums; text-align: right; }
@container (max-width: 280px) { .gha-recent-row { grid-template-columns: auto minmax(0, 1fr) auto; } .gha-recent-branch { display: none; } }
</style>
