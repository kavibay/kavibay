// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, watch, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import {
  type TimeTrackerSettings,
  type TimeTrackerState,
  createProject,
  createTask,
  defaultSettings,
  finishTask,
  normalizeState,
  pauseActive,
  removeProject as removeProjectLogic,
  removeTask as removeTaskLogic,
  renameProject as renameProjectLogic,
  reorderProjects,
  reorderTasks,
  setTaskDone as setTaskDoneLogic,
  setTaskText as setTaskTextLogic,
  startTask,
  stateForDuplicate,
  tasksForProject,
} from "../timeTrackerLogic";

export const TIME_TRACKER_STATE_KEY = "state";
const DEBOUNCE_MS = 300;

export type TimeTrackerConfig = TimeTrackerSettings;
export type TimeTrackerData = Omit<TimeTrackerState, "settings">;

export interface TimeTrackerModel {
  state: Ref<TimeTrackerState>;
  selectProject(projectId: string | null): void;
  addProject(name?: string): string;
  renameProject(id: string, name: string): void;
  removeProject(projectId: string): void;
  addTask(projectId: string, text?: string): string;
  setTaskText(id: string, text: string): void;
  setTaskDone(id: string, done: boolean): void;
  removeTask(taskId: string): void;
  reorderTask(projectId: string, orderedIds: string[]): void;
  reorderProject(orderedIds: string[]): void;
  start(taskId: string, nowMs?: number): void;
  pause(nowMs?: number): void;
  finish(taskId: string, nowMs?: number): void;
  flush(): Promise<void>;
}

const liveStates = new Map<string, Ref<TimeTrackerState>>();

export function normalizeTimeTrackerConfig(raw: unknown): TimeTrackerConfig {
  return normalizeState({ settings: raw }).settings;
}

export function toStoredTimeTrackerState(state: TimeTrackerState): TimeTrackerData {
  const normalized = normalizeState(state);
  const { settings: _settings, ...data } = normalized;
  return data;
}

export function fromStoredTimeTrackerState(raw: unknown, config: TimeTrackerConfig): TimeTrackerState {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return normalizeState({ ...value, settings: config });
}

/** Drop only an active session when the host duplicates an instance. */
export function duplicateTimeTrackerData(key: string, value: unknown): unknown {
  if (key !== TIME_TRACKER_STATE_KEY) return value;
  const state = normalizeState({
    ...(value && typeof value === "object" ? value : {}),
    settings: defaultSettings(),
  });
  return toStoredTimeTrackerState(stateForDuplicate(state));
}

function stateToSearchText(state: TimeTrackerState): string {
  return [
    ...state.projects.map((project) => project.name.trim()),
    ...state.tasks.map((task) => task.text.trim()),
  ]
    .filter(Boolean)
    .join(" ");
}

export function timeTrackerSearchText(instanceId: string): string {
  return stateToSearchText(liveStates.get(instanceId)?.value ?? normalizeState(undefined));
}

export const timeTrackerWidget = defineWidget<TimeTrackerConfig>({
  name: "time-tracker",
  displayName: "Time Tracker",
  description: "Track time on projects and tasks with day, week, and month totals.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  mode: "both",
  duplicateData: true,
  duplicateDataTransform: duplicateTimeTrackerData,
  palette: { searchText: timeTrackerSearchText },
  configuration: {
    weekStartsOn: {
      type: "select",
      label: "Week starts on",
      default: 1,
      options: [
        { value: 0, label: "Sunday" },
        { value: 1, label: "Monday" },
        { value: 2, label: "Tuesday" },
        { value: 3, label: "Wednesday" },
        { value: 4, label: "Thursday" },
        { value: 5, label: "Friday" },
        { value: 6, label: "Saturday" },
      ],
    },
    monthStartsOn: { type: "number", label: "Month starts on", default: 1 },
  },
  component: {
    async setup(ctx: WidgetContext<TimeTrackerConfig>): Promise<TimeTrackerModel> {
      const config = normalizeTimeTrackerConfig(ctx.config);
      const state = ref<TimeTrackerState>(normalizeState({ settings: config }));
      liveStates.set(ctx.instanceId, state);
      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      let hydrated = false;
      let persistence = Promise.resolve();

      const persistNow = (): Promise<void> => {
        if (!hydrated) return Promise.resolve();
        if (saveTimer !== undefined) {
          clearTimeout(saveTimer);
          saveTimer = undefined;
        }
        persistence = persistence
          .catch(() => undefined)
          .then(() => ctx.data.set(TIME_TRACKER_STATE_KEY, toStoredTimeTrackerState(state.value)));
        return persistence;
      };

      const schedulePersist = () => {
        if (!hydrated) return;
        if (saveTimer !== undefined) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = undefined;
          void persistNow();
        }, DEBOUNCE_MS);
      };

      const patchNow = (next: TimeTrackerState) => {
        state.value = normalizeState(next);
        void persistNow();
      };

      const patchDebounced = (next: TimeTrackerState) => {
        state.value = normalizeState(next);
        schedulePersist();
      };

      watch(
        () => [ctx.config.weekStartsOn, ctx.config.monthStartsOn],
        ([weekStartsOn, monthStartsOn]) => {
          if (!hydrated) return;
          const settings = normalizeTimeTrackerConfig({ weekStartsOn, monthStartsOn });
          if (
            settings.weekStartsOn === state.value.settings.weekStartsOn &&
            settings.monthStartsOn === state.value.settings.monthStartsOn
          ) return;
          patchNow({ ...state.value, settings });
        },
      );

      const selectProject = (projectId: string | null) =>
        patchNow({ ...state.value, selectedProjectId: projectId });
      const addProject = (name = ""): string => {
        const project = createProject(name, undefined, state.value.projects.length);
        patchNow({
          ...state.value,
          projects: [...state.value.projects, project],
          selectedProjectId: state.value.selectedProjectId ?? project.id,
        });
        return project.id;
      };
      const renameProject = (id: string, name: string) =>
        patchDebounced({ ...state.value, projects: renameProjectLogic(state.value.projects, id, name) });
      const removeProject = (projectId: string) =>
        patchNow(removeProjectLogic(state.value, projectId));
      const addTask = (projectId: string, text = ""): string => {
        const task = createTask(projectId, text, tasksForProject(state.value.tasks, projectId).length);
        patchNow({ ...state.value, tasks: [...state.value.tasks, task] });
        return task.id;
      };
      const setTaskText = (id: string, text: string) =>
        patchDebounced({ ...state.value, tasks: setTaskTextLogic(state.value.tasks, id, text) });
      const setTaskDone = (id: string, done: boolean) =>
        patchNow({ ...state.value, tasks: setTaskDoneLogic(state.value.tasks, id, done) });
      const removeTask = (taskId: string) => patchNow(removeTaskLogic(state.value, taskId));
      const reorderTask = (projectId: string, orderedIds: string[]) =>
        patchNow({ ...state.value, tasks: reorderTasks(state.value.tasks, projectId, orderedIds) });
      const reorderProject = (orderedIds: string[]) =>
        patchNow({ ...state.value, projects: reorderProjects(state.value.projects, orderedIds) });
      const start = (taskId: string, nowMs = Date.now()) =>
        patchNow(startTask(state.value, taskId, nowMs));
      const pause = (nowMs = Date.now()) => patchNow(pauseActive(state.value, nowMs));
      const finish = (taskId: string, nowMs = Date.now()) =>
        patchNow(finishTask(state.value, taskId, nowMs));

      onScopeDispose(() => {
        if (saveTimer !== undefined) clearTimeout(saveTimer);
        void persistNow();
      });

      state.value = fromStoredTimeTrackerState(
        await ctx.data.get<TimeTrackerData>(TIME_TRACKER_STATE_KEY),
        config,
      );
      hydrated = true;

      return {
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
        flush: persistNow,
      };
    },
  },
});
