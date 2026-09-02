<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComputedRef,
} from "vue";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches, type WidgetSurface } from "@sdk";
import {
  type Project,
  type Task,
  dayRange,
  formatDuration,
  monthRange,
  runningTaskId,
  sessionOverlapMs,
  sumOverlapMs,
  tasksForProject,
  weekRange,
} from "./timeTrackerLogic";
import type { TimeTrackerModel } from "./widgets/timeTracker";

const props = defineProps<{ model: TimeTrackerModel }>();

const injectedInstanceId = inject<string>("widgetInstanceId");
if (!injectedInstanceId) throw new Error("widgetInstanceId missing");
// Narrowed once: the throw above does not carry into nested function bodies,
// and every listener in here needs a plain string.
const instanceId: string = injectedInstanceId;
const widgetSurface = inject<WidgetSurface>("widgetSurface", "desk");

/** True when WidgetCard ResizeEdges owns width/height. */
const hostSized = inject<ComputedRef<boolean>>("widgetHostSized", computed(() => false));

const {
  state,
  selectProject,
  addProject,
  renameProject,
  removeProject,
  addTask,
  setTaskText,
  setTaskDone,
  removeTask,
  reorderTask,
  reorderProject,
  start,
  pause,
  finish,
  flush,
} = props.model;

const rootEl = ref<HTMLElement | null>(null);

/** Wall-clock ms for open-session overlap and live totals. */
const now = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | undefined;

/** Start/stop 1s tick while a session is open. */
function syncTick() {
  const open = runningTaskId(state.value.sessions) != null;
  if (open && tickTimer == null) {
    now.value = Date.now();
    tickTimer = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  } else if (!open && tickTimer != null) {
    clearInterval(tickTimer);
    tickTimer = undefined;
  }
}

watch(
  () => state.value.sessions,
  () => {
    syncTick();
  },
  { deep: true, immediate: true },
);

/** Fill the host card when sized; otherwise use persisted widget state. */
const rootStyle = computed(() =>
  hostSized.value
    ? { width: "100%", height: "100%" }
    : { width: `${state.value.width}px`, height: `${state.value.height}px` },
);

/** Projects sorted by order for the sidebar. */
const projects = computed(() =>
  state.value.projects
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
);

const selectedProject = computed(
  (): Project | null =>
    projects.value.find((p) => p.id === state.value.selectedProjectId) ?? null,
);

/** Flat tasks for the selected project. */
const projectTasks = computed((): Task[] => {
  const projectId = state.value.selectedProjectId;
  if (!projectId) return [];
  return tasksForProject(state.value.tasks, projectId);
});

const activeTaskId = computed(() => runningTaskId(state.value.sessions));

/** Running task entity (may belong to another project). */
const activeTask = computed((): Task | null => {
  const id = activeTaskId.value;
  if (!id) return null;
  return state.value.tasks.find((t) => t.id === id) ?? null;
});

/** Color of the project that owns the running task. */
const activeProjectColor = computed(() => {
  const task = activeTask.value;
  if (!task) return "rgba(var(--fg-rgb), 0.35)";
  return (
    state.value.projects.find((p) => p.id === task.projectId)?.color ??
    "rgba(var(--fg-rgb), 0.35)"
  );
});

/**
 * Live elapsed for the active strip only — always `H:MM:SS` / `M:SS` with seconds
 * so the ticking display stays useful past 1h (totals still use `formatDuration`).
 */
function formatElapsedLive(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours >= 1) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/** Open-session elapsed for the active strip. */
const activeElapsed = computed(() => {
  const session = state.value.sessions.find((s) => s.endedAt == null);
  if (!session) return "0:00";
  return formatElapsedLive(Math.max(0, now.value - session.startedAt));
});

/** Grand totals across all projects for Today / Week / Month. */
const periodTotals = computed(() => {
  const sessions = state.value.sessions;
  const settings = state.value.settings;
  const nowMs = now.value;
  const at = new Date(nowMs);
  return {
    today: formatDuration(sumOverlapMs(sessions, dayRange(at), nowMs)),
    week: formatDuration(
      sumOverlapMs(sessions, weekRange(at, settings.weekStartsOn), nowMs),
    ),
    month: formatDuration(
      sumOverlapMs(sessions, monthRange(at, settings.monthStartsOn), nowMs),
    ),
  };
});

/** Today total for the selected project only. */
const projectToday = computed(() => {
  const projectId = state.value.selectedProjectId;
  if (!projectId) return "0:00";
  const taskIds = new Set(
    state.value.tasks.filter((t) => t.projectId === projectId).map((t) => t.id),
  );
  const nowMs = now.value;
  return formatDuration(
    sumOverlapMs(state.value.sessions, dayRange(new Date(nowMs)), nowMs, taskIds),
  );
});

/** Per-task today duration labels for the selected project. */
const taskTodayLabels = computed(() => {
  const nowMs = now.value;
  const range = dayRange(new Date(nowMs));
  const map = new Map<string, string>();
  for (const task of projectTasks.value) {
    let ms = 0;
    for (const session of state.value.sessions) {
      if (session.taskId !== task.id) continue;
      ms += sessionOverlapMs(session, range, nowMs);
    }
    map.set(task.id, formatDuration(ms));
  }
  return map;
});

const DRAG_THRESHOLD_PX = 4;
const dragFromId = ref<string | null>(null);
const dropTargetId = ref<string | null>(null);
const dropPlacement = ref<"before" | "after" | null>(null);

interface GripPress {
  id: string;
  x: number;
  y: number;
  pointerId: number;
  el: HTMLElement;
}

let gripPress: GripPress | null = null;

/** Focus a project name input after DOM updates. */
async function focusProject(id: string, mode: "select" | "end" = "select") {
  await nextTick();
  const input = rootEl.value?.querySelector<HTMLInputElement>(
    `input[data-tt-project="${CSS.escape(id)}"]`,
  );
  if (!input) return;
  input.focus();
  if (mode === "end") {
    const len = input.value.length;
    input.setSelectionRange(len, len);
  } else {
    input.select();
  }
}

/** Focus a task text input after DOM updates. */
async function focusTask(id: string, mode: "select" | "end" = "select") {
  await nextTick();
  const input = rootEl.value?.querySelector<HTMLInputElement>(
    `input[data-tt-task="${CSS.escape(id)}"]`,
  );
  if (!input) return;
  input.focus();
  if (mode === "end") {
    const len = input.value.length;
    input.setSelectionRange(len, len);
  } else {
    input.select();
  }
}

/** Add a project (color cycles via createProject order) and focus its name. */
function onAddProject() {
  const id = addProject("");
  selectProject(id);
  void focusProject(id);
}

/** Add a task under the selected project and focus it. */
function onAddTask() {
  const projectId = state.value.selectedProjectId;
  if (!projectId) return;
  const id = addTask(projectId, "");
  void focusTask(id);
}

/** Select a project from the sidebar. */
function onSelectProject(id: string) {
  selectProject(id);
}

/** Remove empty project names on blur (keep named ones). */
function onProjectBlur(id: string, name: string) {
  if (!name.trim()) {
    // Keep a blank brand-new project until explicitly deleted — only auto-remove
    // if it has no tasks (empty cleanup after abandoning rename).
    const hasTasks = state.value.tasks.some((t) => t.projectId === id);
    if (!hasTasks && projects.value.length > 1) {
      removeProject(id);
    }
  }
}

/** Confirm then delete a project (cascades tasks + time sessions). */
function onDeleteProject(id: string) {
  const name =
    state.value.projects.find((p) => p.id === id)?.name.trim() || "this project";
  const ok = window.confirm(
    `Delete "${name}"? All tasks and tracked time for this project will be removed.`,
  );
  if (ok) removeProject(id);
}

/** Toggle done: finish when open; unmark without starting when done. */
function onToggleDone(task: Task) {
  if (task.done) {
    setTaskDone(task.id, false);
  } else {
    finish(task.id);
  }
}

/** Start or pause depending on whether this task is running. */
function onToggleTimer(task: Task) {
  if (task.done) return;
  if (activeTaskId.value === task.id) {
    pause();
  } else {
    start(task.id);
  }
}

/** Resolve which task row is under the pointer. */
function taskIdAtPoint(x: number, y: number): string | null {
  const nodes = rootEl.value?.querySelectorAll<HTMLElement>("[data-tt-task-row]");
  if (!nodes) return null;
  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return node.dataset.ttTaskRow ?? null;
    }
  }
  return null;
}

/** Before/after placement from Y within the row. */
function placementAtPoint(y: number, targetId: string): "before" | "after" {
  const node = rootEl.value?.querySelector<HTMLElement>(
    `[data-tt-task-row="${CSS.escape(targetId)}"]`,
  );
  if (!node) return "after";
  const r = node.getBoundingClientRect();
  const ratio = r.height > 0 ? (y - r.top) / r.height : 0.5;
  return ratio < 0.5 ? "before" : "after";
}

/** Start a potential reorder drag from the grip. */
function onGripPointerDown(e: PointerEvent, id: string) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  gripPress = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, el };
  el.setPointerCapture(e.pointerId);
}

/** After threshold, enter drag mode and track drop target. */
function onGripPointerMove(e: PointerEvent) {
  if (!gripPress || e.pointerId !== gripPress.pointerId) return;
  const dx = e.clientX - gripPress.x;
  const dy = e.clientY - gripPress.y;
  if (dragFromId.value == null) {
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    dragFromId.value = gripPress.id;
  }

  const overId = taskIdAtPoint(e.clientX, e.clientY);
  if (!overId || overId === dragFromId.value) {
    dropTargetId.value = null;
    dropPlacement.value = null;
    return;
  }
  dropTargetId.value = overId;
  dropPlacement.value = placementAtPoint(e.clientY, overId);
}

/** Commit task reorder on release. */
function onGripPointerUp(e: PointerEvent) {
  if (!gripPress || e.pointerId !== gripPress.pointerId) return;
  try {
    gripPress.el.releasePointerCapture(e.pointerId);
  } catch {
    // already released
  }
  const from = dragFromId.value;
  const to = dropTargetId.value;
  const placement = dropPlacement.value;
  gripPress = null;

  if (from != null) {
    const projectId = state.value.selectedProjectId;
    if (projectId && to != null && placement != null && from !== to) {
      const ids = projectTasks.value.map((t) => t.id);
      const fromIdx = ids.indexOf(from);
      const toIdx = ids.indexOf(to);
      if (fromIdx >= 0 && toIdx >= 0) {
        ids.splice(fromIdx, 1);
        let insertAt = ids.indexOf(to);
        if (placement === "after") insertAt += 1;
        ids.splice(insertAt, 0, from);
        reorderTask(projectId, ids);
      }
    }
    dragFromId.value = null;
    dropTargetId.value = null;
    dropPlacement.value = null;
  }
}

/** Keyboard shortcuts while editing a task row. */
function onTaskKeydown(e: KeyboardEvent, id: string) {
  const input = e.target as HTMLInputElement;
  const tasks = projectTasks.value;
  const idx = tasks.findIndex((t) => t.id === id);
  const task = tasks[idx];
  if (!task) return;

  if (e.key === "Enter") {
    e.preventDefault();
    const projectId = state.value.selectedProjectId;
    if (!projectId) return;
    const newId = addTask(projectId, "");
    // New task was appended — move it directly under the current row.
    const ordered = projectTasks.value.map((t) => t.id).filter((x) => x !== newId);
    const at = ordered.indexOf(id);
    ordered.splice(at < 0 ? ordered.length : at + 1, 0, newId);
    reorderTask(projectId, ordered);
    void focusTask(newId);
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    input.blur();
    return;
  }

  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    const nextIdx = e.key === "ArrowUp" ? idx - 1 : idx + 1;
    const target = tasks[nextIdx];
    if (target) void focusTask(target.id, "end");
    return;
  }

  if (e.key === "Backspace" && task.text === "") {
    e.preventDefault();
    const prevId = idx > 0 ? tasks[idx - 1]!.id : null;
    removeTask(id);
    if (prevId) void focusTask(prevId, "end");
    else {
      const first = projectTasks.value[0]?.id;
      if (first) void focusTask(first, "end");
    }
  }
}

/** Keyboard shortcuts while editing a project name (incl. Alt+Arrow reorder). */
function onProjectKeydown(e: KeyboardEvent, id: string) {
  if (e.key === "Enter" || e.key === "Escape") {
    e.preventDefault();
    (e.target as HTMLInputElement).blur();
    return;
  }

  // Alt+ArrowUp/Down moves the focused project among siblings.
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const ids = projects.value.map((p) => p.id);
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    const swapWith = e.key === "ArrowUp" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= ids.length) return;
    const next = [...ids];
    const tmp = next[idx]!;
    next[idx] = next[swapWith]!;
    next[swapWith] = tmp;
    reorderProject(next);
  }
}

/** Focus first empty task (or project) when palette selects this instance. */
function onKavibayFocusWidget(event: Event) {
  // Surface check keeps the desk card from stealing the caret from the inline view.
  if (!widgetFocusRequestMatches(event, instanceId, widgetSurface)) return;
  if (!selectedProject.value) {
    if (projects.value.length === 0) onAddProject();
    else void focusProject(projects.value[0]!.id);
    return;
  }
  const empty = projectTasks.value.find((t) => !t.text.trim());
  if (empty) void focusTask(empty.id);
  else if (projectTasks.value[0]) void focusTask(projectTasks.value[0].id, "end");
  else onAddTask();
}

onMounted(() => {
  window.addEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
});

onBeforeUnmount(() => {
  window.removeEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
  if (tickTimer != null) {
    clearInterval(tickTimer);
    tickTimer = undefined;
  }
  void flush();
});
</script>

<template>
  <div
    ref="rootEl"
    class="tt-widget"
    :style="rootStyle"
    data-interactive
    @pointerdown.stop
  >
    <div class="tt-body">
      <!-- Project sidebar -->
      <aside class="tt-sidebar" aria-label="Projects">
        <div v-if="projects.length === 0" class="tt-empty tt-empty--sidebar">
          <p class="tt-empty-text">No projects yet</p>
          <button type="button" class="tt-empty-cta" @click="onAddProject">
            Add project
          </button>
        </div>

        <ul v-else class="tt-projects" @wheel.stop>
          <li
            v-for="project in projects"
            :key="project.id"
            class="tt-project"
            :class="{ 'tt-project--selected': project.id === state.selectedProjectId }"
            @click="onSelectProject(project.id)"
          >
            <span
              class="tt-swatch"
              :style="{ background: project.color }"
              aria-hidden="true"
            />
            <input
              class="tt-project-name"
              type="text"
              :data-tt-project="project.id"
              :value="project.name"
              placeholder="Project"
              spellcheck="false"
              @click.stop
              @focus="onSelectProject(project.id)"
              @input="renameProject(project.id, ($event.target as HTMLInputElement).value)"
              @blur="onProjectBlur(project.id, ($event.target as HTMLInputElement).value)"
              @keydown="onProjectKeydown($event, project.id)"
              v-tip="'Alt+↑/↓ to reorder'"
            />
            <button
              type="button"
              class="tt-project-delete"
              aria-label="Delete project"
              v-tip="'Delete project'"
              @click.stop="onDeleteProject(project.id)"
            >
              ×
            </button>
          </li>
        </ul>

        <button
          v-if="projects.length > 0"
          type="button"
          class="tt-add"
          @click="onAddProject"
        >
          + Project
        </button>
      </aside>

      <!-- Task pane -->
      <section class="tt-pane" aria-label="Tasks">
        <header class="tt-totals" aria-label="Period totals">
          <div class="tt-total">
            <span class="tt-total-label">Today</span>
            <span class="tt-total-value">{{ periodTotals.today }}</span>
          </div>
          <div class="tt-total">
            <span class="tt-total-label">Week</span>
            <span class="tt-total-value">{{ periodTotals.week }}</span>
          </div>
          <div class="tt-total">
            <span class="tt-total-label">Month</span>
            <span class="tt-total-value">{{ periodTotals.month }}</span>
          </div>
        </header>

        <div
          v-if="activeTask"
          class="tt-active"
          :style="{ '--tt-active-color': activeProjectColor }"
        >
          <span class="tt-active-dot" aria-hidden="true" />
          <span class="tt-active-name">{{ activeTask.text.trim() || "Untitled task" }}</span>
          <span class="tt-active-time">{{ activeElapsed }}</span>
          <button
            type="button"
            class="tt-timer-btn tt-active-pause"
            aria-label="Pause"
            v-tip="'Pause'"
            @click="pause()"
          >
            <span aria-hidden="true">❚❚</span>
          </button>
        </div>

        <div v-if="selectedProject" class="tt-project-sub">
          <span class="tt-project-sub-name">{{ selectedProject.name.trim() || "Project" }}</span>
          <span class="tt-project-sub-time">{{ projectToday }} today</span>
        </div>

        <div v-if="!selectedProject" class="tt-empty tt-empty--pane">
          <p class="tt-empty-text">Select or add a project to track time</p>
        </div>

        <template v-else>
          <ul v-if="projectTasks.length > 0" class="tt-tasks" @wheel.stop>
            <li
              v-for="task in projectTasks"
              :key="task.id"
              class="tt-task"
              :class="{
                'tt-task--done': task.done,
                'tt-task--running': activeTaskId === task.id,
                'tt-task--dragging': dragFromId === task.id,
                'tt-task--drop-before': dropTargetId === task.id && dropPlacement === 'before',
                'tt-task--drop-after': dropTargetId === task.id && dropPlacement === 'after',
              }"
              :data-tt-task-row="task.id"
            >
              <button
                type="button"
                class="tt-grip"
                v-tip="'Drag to reorder'"
                aria-label="Drag to reorder"
                @pointerdown="onGripPointerDown($event, task.id)"
                @pointermove="onGripPointerMove"
                @pointerup="onGripPointerUp"
                @pointercancel="onGripPointerUp"
              >
                <svg viewBox="0 0 12 16" width="10" height="14" aria-hidden="true">
                  <circle cx="3.5" cy="3" r="1.35" fill="currentColor" />
                  <circle cx="8.5" cy="3" r="1.35" fill="currentColor" />
                  <circle cx="3.5" cy="8" r="1.35" fill="currentColor" />
                  <circle cx="8.5" cy="8" r="1.35" fill="currentColor" />
                  <circle cx="3.5" cy="13" r="1.35" fill="currentColor" />
                  <circle cx="8.5" cy="13" r="1.35" fill="currentColor" />
                </svg>
              </button>

              <button
                type="button"
                class="tt-timer-btn"
                :disabled="task.done"
                :aria-label="activeTaskId === task.id ? 'Pause' : 'Start'"
                v-tip="activeTaskId === task.id ? 'Pause' : 'Start'"
                @click="onToggleTimer(task)"
              >
                <span v-if="activeTaskId === task.id" aria-hidden="true">❚❚</span>
                <span v-else aria-hidden="true">▶</span>
              </button>

              <input
                class="tt-task-input"
                type="text"
                :data-tt-task="task.id"
                :value="task.text"
                placeholder="Task"
                spellcheck="false"
                @input="setTaskText(task.id, ($event.target as HTMLInputElement).value)"
                @keydown="onTaskKeydown($event, task.id)"
              />

              <span class="tt-task-time">{{ taskTodayLabels.get(task.id) ?? "0:00" }}</span>

              <button
                type="button"
                class="tt-done"
                :aria-pressed="task.done"
                :aria-label="task.done ? 'Mark incomplete' : 'Done'"
                v-tip="task.done ? 'Mark incomplete' : 'Done'"
                @click="onToggleDone(task)"
              >
                <span class="tt-done-box" :class="{ checked: task.done }" />
              </button>

              <button
                type="button"
                class="tt-task-delete"
                aria-label="Delete task"
                v-tip="'Delete'"
                @click="removeTask(task.id)"
              >
                ×
              </button>
            </li>
          </ul>

          <div v-else class="tt-empty tt-empty--tasks">
            <p class="tt-empty-text">No tasks yet</p>
          </div>

          <button type="button" class="tt-add" @click="onAddTask">
            + Add task
          </button>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tt-widget {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  cursor: default;
}

.tt-body {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.tt-sidebar {
  display: flex;
  flex-direction: column;
  width: 118px;
  flex-shrink: 0;
  min-height: 0;
  padding: 8px 6px 8px 8px;
  border-right: 1px solid rgba(var(--fg-rgb), 0.08);
  box-sizing: border-box;
}

.tt-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 8px 10px 8px 10px;
  box-sizing: border-box;
}

.tt-totals {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  flex-shrink: 0;
  margin-bottom: 8px;
}

.tt-total {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.tt-total-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.45);
}

.tt-total-value {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.92);
}

.tt-active {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.05);
  border: 1px solid rgba(var(--fg-rgb), 0.08);
  flex-shrink: 0;
  min-width: 0;
}

.tt-active-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tt-active-color);
  flex-shrink: 0;
}

.tt-active-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.88);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tt-active-time {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.7);
  flex-shrink: 0;
}

.tt-active-pause {
  color: rgba(var(--fg-rgb), 0.85);
}

.tt-project-sub {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  padding: 0 2px;
  flex-shrink: 0;
}

.tt-project-sub-name {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tt-project-sub-time {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.45);
  flex-shrink: 0;
}

.tt-projects,
.tt-tasks {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tt-project {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 4px 6px;
  border-radius: 6px;
  min-width: 0;
  cursor: pointer;
}

.tt-project:hover,
.tt-project:focus-within {
  background: rgba(var(--fg-rgb), 0.04);
}

.tt-project--selected {
  background: rgba(var(--fg-rgb), 0.08);
}

.tt-swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tt-project-name {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.9);
  font: inherit;
  font-size: 12px;
  line-height: 1.3;
  padding: 2px 0;
  outline: none;
}

.tt-project-name::placeholder {
  color: rgba(var(--fg-rgb), 0.28);
}

.tt-project-delete,
.tt-task-delete {
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.35);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  flex-shrink: 0;
  font-size: 14px;
  line-height: 1;
}

.tt-project:hover .tt-project-delete,
.tt-project:focus-within .tt-project-delete,
.tt-task:hover .tt-task-delete,
.tt-task:focus-within .tt-task-delete {
  opacity: 1;
}

.tt-project-delete:hover,
.tt-task-delete:hover {
  color: rgba(var(--fg-rgb), 0.85);
  background: rgba(var(--fg-rgb), 0.08);
}

.tt-task {
  position: relative;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 2px;
  border-radius: 6px;
  min-width: 0;
}

.tt-task:hover,
.tt-task:focus-within {
  background: rgba(var(--fg-rgb), 0.04);
}

.tt-task--dragging {
  opacity: 0.45;
}

.tt-task--running {
  background: rgba(var(--fg-rgb), 0.06);
}

.tt-task--done .tt-task-input {
  color: rgba(var(--fg-rgb), 0.4);
  text-decoration: line-through;
}

.tt-task--drop-before::before,
.tt-task--drop-after::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  background: rgba(var(--fg-rgb), 0.55);
  border-radius: 1px;
  pointer-events: none;
}

.tt-task--drop-before::before {
  top: 0;
}

.tt-task--drop-after::after {
  bottom: 0;
}

.tt-grip {
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.4);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 1px;
  cursor: grab;
  flex-shrink: 0;
  border-radius: 4px;
  opacity: 0;
}

.tt-task:hover .tt-grip,
.tt-task:focus-within .tt-grip,
.tt-task--dragging .tt-grip {
  opacity: 1;
}

.tt-grip:hover {
  color: rgba(var(--fg-rgb), 0.7);
  background: rgba(var(--fg-rgb), 0.06);
}

.tt-grip:active {
  cursor: grabbing;
}

.tt-timer-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.7);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 5px;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 9px;
  letter-spacing: -0.5px;
  line-height: 1;
}

.tt-timer-btn:hover:not(:disabled) {
  color: rgba(var(--fg-rgb), 0.95);
  background: rgba(var(--fg-rgb), 0.08);
}

.tt-timer-btn:disabled {
  opacity: 0.28;
  cursor: default;
}

.tt-task--running .tt-timer-btn {
  color: rgba(var(--fg-rgb), 0.92);
}

.tt-task-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
  line-height: 1.35;
  padding: 3px 2px;
  outline: none;
}

.tt-task-input::placeholder {
  color: rgba(var(--fg-rgb), 0.28);
}

.tt-task-time {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.42);
  flex-shrink: 0;
  min-width: 2.4em;
  text-align: right;
  padding-right: 2px;
}

.tt-done {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 2px;
  cursor: pointer;
  flex-shrink: 0;
  border-radius: 4px;
}

.tt-done:hover {
  background: rgba(var(--fg-rgb), 0.06);
}

.tt-done-box {
  display: block;
  width: 13px;
  height: 13px;
  border-radius: 4px;
  border: 1.5px solid rgba(var(--fg-rgb), 0.35);
  box-sizing: border-box;
}

.tt-done-box.checked {
  background: rgba(var(--fg-rgb), 0.75);
  border-color: rgba(var(--fg-rgb), 0.75);
  box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.35);
}

.tt-add {
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.45);
  font: inherit;
  font-size: 12px;
  text-align: left;
  padding: 6px 6px 2px;
  cursor: pointer;
  border-radius: 6px;
  flex-shrink: 0;
}

.tt-add:hover {
  color: rgba(var(--fg-rgb), 0.8);
  background: rgba(var(--fg-rgb), 0.05);
}

.tt-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 6px;
}

.tt-empty--pane,
.tt-empty--tasks {
  flex: 1;
  justify-content: center;
}

.tt-empty--sidebar {
  flex: 1;
  justify-content: center;
}

.tt-empty-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.42);
}

.tt-empty-cta {
  appearance: none;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: rgba(var(--fg-rgb), 0.05);
  color: rgba(var(--fg-rgb), 0.8);
  font: inherit;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.tt-empty-cta:hover {
  background: rgba(var(--fg-rgb), 0.09);
  border-color: rgba(var(--fg-rgb), 0.22);
}
</style>
