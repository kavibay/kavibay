/**
 * Quick checks for time-tracker pure helpers
 * (run: npx tsx src/extensions/time-tracker/timeTrackerLogic.assert.ts).
 */
import {
  type Session,
  type TimeTrackerState,
  createProject,
  createTask,
  dayRange,
  finishTask,
  formatDuration,
  monthRange,
  normalizeState,
  pauseActive,
  removeProject,
  runningTaskId,
  sessionOverlapMs,
  startTask,
  stateForDuplicate,
  sumOverlapMs,
  weekRange,
} from "./timeTrackerLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function baseState(): TimeTrackerState {
  const p = createProject("Alpha", "#3b82f6", 0);
  p.id = "p1";
  const t1 = createTask("p1", "Task A", 0);
  t1.id = "t1";
  const t2 = createTask("p1", "Task B", 1);
  t2.id = "t2";
  return {
    projects: [p],
    tasks: [t1, t2],
    sessions: [],
    settings: { weekStartsOn: 1, monthStartsOn: 1 },
    selectedProjectId: "p1",
    width: 340,
    height: 320,
  };
}

// --- normalize: single-open invariant ---
const normalized = normalizeState({
  projects: [{ id: "p1", name: "P", color: "#3b82f6", order: 0 }],
  tasks: [
    { id: "t1", projectId: "p1", text: "A", done: false, order: 0 },
    { id: "t2", projectId: "p1", text: "B", done: false, order: 1 },
    { id: "orphan", projectId: "missing", text: "gone", done: false, order: 0 },
  ],
  sessions: [
    { id: "s-old", taskId: "t1", startedAt: 1000, endedAt: null },
    { id: "s-new", taskId: "t2", startedAt: 5000, endedAt: null },
    { id: "s-bad", taskId: "missing-task", startedAt: 2000, endedAt: 3000 },
  ],
  settings: { weekStartsOn: 9, monthStartsOn: 40 },
  selectedProjectId: "gone",
  width: 9999,
  height: 10,
});
assert(normalized.tasks.every((t) => t.projectId === "p1"), "orphan tasks dropped");
assert(!normalized.sessions.some((s) => s.taskId === "missing-task"), "invalid sessions dropped");
assert(normalized.sessions.filter((s) => s.endedAt == null).length === 1, "one open session");
assert(normalized.sessions.find((s) => s.endedAt == null)?.id === "s-new", "keep newest open");
const closedOld = normalized.sessions.find((s) => s.id === "s-old");
assert(closedOld?.endedAt === 5000, "close others at keeper startedAt");
assert(normalized.settings.weekStartsOn === 6, "clamp weekStartsOn");
assert(normalized.settings.monthStartsOn === 28, "clamp monthStartsOn");
assert(normalized.width <= 560 && normalized.height >= 200, "clamp size");
assert(normalized.selectedProjectId === "p1", "repair selected project");

// --- day / week / month bounds ---
// Wednesday 2026-07-15 12:00 local
const wed = new Date(2026, 6, 15, 12, 0, 0, 0);
const day = dayRange(wed);
assert(new Date(day.start).getDate() === 15, "day start date");
assert(day.end - day.start === 24 * 60 * 60 * 1000, "day length");

const weekMon = weekRange(wed, 1);
assert(new Date(weekMon.start).getDay() === 1, "week starts Monday");
assert(new Date(weekMon.start).getDate() === 13, "Monday Jul 13");
assert(weekMon.end - weekMon.start === 7 * 24 * 60 * 60 * 1000, "week length");

const weekSun = weekRange(wed, 0);
assert(new Date(weekSun.start).getDay() === 0, "week starts Sunday");
assert(new Date(weekSun.start).getDate() === 12, "Sunday Jul 12");

const month1 = monthRange(wed, 1);
assert(new Date(month1.start).getDate() === 1, "month day 1 start");
assert(new Date(month1.start).getMonth() === 6, "July");
assert(new Date(month1.end).getMonth() === 7 && new Date(month1.end).getDate() === 1, "Aug 1 end");

// monthStartsOn=15: Jul 15 12:00 is inside [Jul 15, Aug 15)
const month15 = monthRange(wed, 15);
assert(new Date(month15.start).getFullYear() === 2026, "m15 year");
assert(new Date(month15.start).getMonth() === 6 && new Date(month15.start).getDate() === 15, "m15 Jul 15");
assert(new Date(month15.end).getMonth() === 7 && new Date(month15.end).getDate() === 15, "m15 Aug 15");

// Before the 15th → previous period
const jul10 = new Date(2026, 6, 10, 8, 0, 0, 0);
const month15early = monthRange(jul10, 15);
assert(new Date(month15early.start).getMonth() === 5 && new Date(month15early.start).getDate() === 15, "m15 Jun 15");
assert(new Date(month15early.end).getMonth() === 6 && new Date(month15early.end).getDate() === 15, "m15 ends Jul 15");

// --- overlap split across midnight ---
const dayRangeMs = dayRange(new Date(2026, 6, 16, 10, 0, 0, 0)); // Jul 16
const cross: Session = {
  id: "cross",
  taskId: "t1",
  startedAt: new Date(2026, 6, 15, 23, 0, 0, 0).getTime(),
  endedAt: new Date(2026, 6, 16, 1, 0, 0, 0).getTime(),
};
const overlap = sessionOverlapMs(cross, dayRangeMs, Date.now());
assert(overlap === 60 * 60 * 1000, "1h overlap after midnight");

const day15 = dayRange(new Date(2026, 6, 15, 10, 0, 0, 0));
assert(sessionOverlapMs(cross, day15, Date.now()) === 60 * 60 * 1000, "1h before midnight");
assert(
  sumOverlapMs([cross], day15, Date.now()) + sumOverlapMs([cross], dayRangeMs, Date.now()) ===
    2 * 60 * 60 * 1000,
  "split sums to full session",
);

// Open session uses nowMs as end
const openSess: Session = {
  id: "open",
  taskId: "t1",
  startedAt: dayRangeMs.start + 1000,
  endedAt: null,
};
const nowMs = dayRangeMs.start + 1000 + 30_000;
assert(sessionOverlapMs(openSess, dayRangeMs, nowMs) === 30_000, "open uses nowMs");

// --- start switches active task; pause / finish ---
let state = baseState();
state = startTask(state, "t1", 10_000);
assert(runningTaskId(state.sessions) === "t1", "start t1");
state = startTask(state, "t2", 20_000);
assert(runningTaskId(state.sessions) === "t2", "switch to t2");
const t1Sess = state.sessions.find((s) => s.taskId === "t1");
assert(t1Sess?.endedAt === 20_000, "prior session closed on switch");
state = pauseActive(state, 25_000);
assert(runningTaskId(state.sessions) === null, "paused");
assert(state.sessions.find((s) => s.taskId === "t2")?.endedAt === 25_000, "pause end time");

state = startTask(state, "t1", 30_000);
state = finishTask(state, "t1", 40_000);
assert(state.tasks.find((t) => t.id === "t1")?.done === true, "finish marks done");
assert(runningTaskId(state.sessions) === null, "finish ends session");
assert(state.sessions.find((s) => s.taskId === "t1" && s.startedAt === 30_000)?.endedAt === 40_000, "finish end");

// start on done task is no-op
const before = state.sessions.length;
state = startTask(state, "t1", 50_000);
assert(state.sessions.length === before && runningTaskId(state.sessions) === null, "no start when done");

// --- remove project cascades ---
state = baseState();
state = {
  ...state,
  sessions: [
    { id: "s1", taskId: "t1", startedAt: 1, endedAt: 2 },
    { id: "s2", taskId: "t2", startedAt: 3, endedAt: 4 },
  ],
};
const p2 = createProject("Beta", "#f59e0b", 1);
p2.id = "p2";
const tOther = createTask("p2", "Other", 0);
tOther.id = "t3";
state = {
  ...state,
  projects: [...state.projects, p2],
  tasks: [...state.tasks, tOther],
  sessions: [
    ...state.sessions,
    { id: "s3", taskId: "t3", startedAt: 5, endedAt: 6 },
  ],
};
state = removeProject(state, "p1");
assert(!state.projects.some((p) => p.id === "p1"), "project removed");
assert(!state.tasks.some((t) => t.projectId === "p1"), "tasks cascaded");
assert(!state.sessions.some((s) => s.taskId === "t1" || s.taskId === "t2"), "sessions cascaded");
assert(state.tasks.some((t) => t.id === "t3") && state.sessions.some((s) => s.id === "s3"), "other project kept");
assert(state.selectedProjectId === "p2", "selection repaired");

// --- stateForDuplicate drops open session ---
state = baseState();
state = startTask(state, "t1", 100);
state = {
  ...state,
  sessions: [
    ...state.sessions,
    { id: "closed", taskId: "t2", startedAt: 1, endedAt: 50 },
  ],
};
const dup = stateForDuplicate(state);
assert(dup.sessions.every((s) => s.endedAt != null), "duplicate has no open");
assert(dup.sessions.some((s) => s.id === "closed"), "closed kept");
assert(!dup.sessions.some((s) => s.endedAt == null), "open dropped");

// --- formatDuration ---
assert(formatDuration(0) === "0:00", "zero");
assert(formatDuration(5_000) === "0:05", "seconds");
assert(formatDuration(65_000) === "1:05", "M:SS under 1h");
assert(formatDuration(3_599_000) === "59:59", "just under 1h");
assert(formatDuration(3_600_000) === "1:00", "H:MM at 1h");
assert(formatDuration(7_380_000) === "2:03", "H:MM hours");

console.log("ok");
