import { computed, effectScope } from "vue";
import type { WidgetContext } from "@sdk/contract/sdk";
import timeTrackerExtension from "../extension";
import {
  TIME_TRACKER_STATE_KEY,
  duplicateTimeTrackerData,
  timeTrackerSearchText,
  timeTrackerWidget,
  type TimeTrackerData,
  type TimeTrackerModel,
} from "./timeTracker";
import { normalizeState } from "../timeTrackerLogic";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(timeTrackerExtension.name === "time-tracker", "the port keeps the time-tracker extension id");
const cells = new Map<string, unknown>();
const data = {
  get: async <T>(key: string) => cells.get(key) as T | undefined,
  set: async <T>(key: string, value: T) => { cells.set(key, value); },
  delete: async (key: string) => { cells.delete(key); },
};
const context = {
  instanceId: "time-tracker-assert",
  config: { weekStartsOn: 1, monthStartsOn: 1 },
  data,
} satisfies WidgetContext<{ weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6; monthStartsOn: number }>;

const searchText = computed(() => timeTrackerSearchText(context.instanceId));
assert(searchText.value === "", "unmounted tracker starts with no search text");
const scope = effectScope();
const model = await scope.run(() => timeTrackerWidget.component.setup(context)) as TimeTrackerModel;
const projectId = model.addProject("Alpha");
const taskId = model.addTask(projectId, "Write report");
assert(searchText.value === "Alpha Write report", "cached search text follows the first mount and new tasks");
model.start(taskId, 1_000);
await model.flush();

const saved = await data.get<TimeTrackerData>(TIME_TRACKER_STATE_KEY);
assert(saved?.projects[0]?.name === "Alpha", "projects persist through ctx.data");
assert(saved?.tasks[0]?.text === "Write report", "tasks persist through ctx.data");
assert(saved?.sessions.some((session) => session.endedAt === null) === true, "active session persists");

const duplicate = duplicateTimeTrackerData(TIME_TRACKER_STATE_KEY, saved) as TimeTrackerData;
assert(!duplicate.sessions.some((session) => session.endedAt === null), "duplicate drops active sessions");

model.finish(taskId, 2_000);
await model.flush();
const closed = await data.get<TimeTrackerData>(TIME_TRACKER_STATE_KEY);
assert(closed?.sessions[0]?.endedAt === 2_000, "finishing a task closes its session");
assert(normalizeState({ ...closed, settings: context.config }).tasks[0]?.done === true, "finish marks task done");
scope.stop();
assert(searchText.value === "Alpha Write report", "hidden tracker keeps its searchable snapshot");

const reopenedScope = effectScope();
const reopened = await reopenedScope.run(() => timeTrackerWidget.component.setup(context)) as TimeTrackerModel;
assert(searchText.value === "Alpha Write report", "cached search text follows restored tracker data");
reopened.renameProject(projectId, "Beta");
reopened.setTaskText(taskId, "Review report");
assert(searchText.value === "Beta Review report", "cached search text subscribes to the replacement state");
await reopened.flush();
reopenedScope.stop();

console.log("time-tracker contract assertions passed");
