/**
 * Pure time-tracker helpers: projects, flat tasks, sessions, periods, persist.
 */

export interface Project {
  id: string;
  name: string;
  /** CSS color from PROJECT_COLORS (or any valid color string). */
  color: string;
  order: number;
}

export interface Task {
  id: string;
  projectId: string;
  text: string;
  done: boolean;
  order: number;
}

export interface Session {
  id: string;
  taskId: string;
  /** Epoch ms when the session started. */
  startedAt: number;
  /** Epoch ms when closed; null means currently running. */
  endedAt: number | null;
}

export interface TimeTrackerSettings {
  /** 0 = Sunday … 6 = Saturday. Default Monday = 1. */
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Day of month (1–28) when the custom month period starts. */
  monthStartsOn: number;
}

export interface TimeTrackerState {
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
  settings: TimeTrackerSettings;
  selectedProjectId: string | null;
  width: number;
  height: number;
}

/** Half-open local period window [start, end) in epoch ms. */
export interface TimeRange {
  start: number;
  end: number;
}

/** Small fixed project color palette (blue / amber / teal / rose / violet / lime). */
export const PROJECT_COLORS: string[] = [
  "#3b82f6",
  "#f59e0b",
  "#14b8a6",
  "#f43f5e",
  "#8b5cf6",
  "#84cc16",
];

export const DEFAULT_WIDTH = 340;
export const DEFAULT_HEIGHT = 320;
export const MIN_WIDTH = 280;
export const MIN_HEIGHT = 200;
export const MAX_WIDTH = 560;
export const MAX_HEIGHT = 800;

/** Default week/month start settings (Monday, calendar day 1). */
export function defaultSettings(): TimeTrackerSettings {
  return { weekStartsOn: 1, monthStartsOn: 1 };
}

/** Empty widget state with no projects/tasks/sessions. */
export function emptyState(): TimeTrackerState {
  return {
    projects: [],
    tasks: [],
    sessions: [],
    settings: defaultSettings(),
    selectedProjectId: null,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
}

/** Clamp width/height into allowed bounds. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  const w = Number.isFinite(width) ? width : DEFAULT_WIDTH;
  const h = Number.isFinite(height) ? height : DEFAULT_HEIGHT;
  return {
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w))),
    height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h))),
  };
}

/** Normalize raw persisted JSON into a safe state. */
export function normalizeState(raw: unknown): TimeTrackerState {
  if (!raw || typeof raw !== "object") return emptyState();
  const o = raw as Record<string, unknown>;
  const size = clampSize(
    typeof o.width === "number" ? o.width : DEFAULT_WIDTH,
    typeof o.height === "number" ? o.height : DEFAULT_HEIGHT,
  );
  const settings = normalizeSettings(o.settings);
  const projects = normalizeProjects(Array.isArray(o.projects) ? o.projects : []);
  const projectIds = new Set(projects.map((p) => p.id));
  const tasks = normalizeTasks(Array.isArray(o.tasks) ? o.tasks : [], projectIds);
  const taskIds = new Set(tasks.map((t) => t.id));
  const sessions = enforceSingleOpen(
    normalizeSessions(Array.isArray(o.sessions) ? o.sessions : [], taskIds),
  );

  let selectedProjectId: string | null =
    typeof o.selectedProjectId === "string" ? o.selectedProjectId : null;
  if (selectedProjectId && !projectIds.has(selectedProjectId)) {
    selectedProjectId = null;
  }
  if (!selectedProjectId && projects.length) {
    selectedProjectId = projects[0]!.id;
  }

  return {
    projects,
    tasks,
    sessions,
    settings,
    selectedProjectId,
    ...size,
  };
}

/** Local calendar day as half-open [midnight, next midnight). */
export function dayRange(now: Date): TimeRange {
  const start = startOfLocalDay(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

/**
 * Local week containing `now`, starting on `weekStartsOn` (0=Sun … 6=Sat).
 * Half-open [weekStart, weekStart+7d).
 */
export function weekRange(now: Date, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6): TimeRange {
  const startOn = clampWeekStartsOn(weekStartsOn);
  const start = startOfLocalDay(now);
  const dow = start.getDay();
  const diff = (dow - startOn + 7) % 7;
  start.setDate(start.getDate() - diff);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.getTime(), end: end.getTime() };
}

/**
 * Custom month period containing `now`: [monthStartsOn, next monthStartsOn).
 * `monthStartsOn` is clamped to 1–28.
 */
export function monthRange(now: Date, monthStartsOn: number): TimeRange {
  const day = clampMonthStartsOn(monthStartsOn);
  let y = now.getFullYear();
  let m = now.getMonth();
  if (now.getDate() < day) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  const start = new Date(y, m, day, 0, 0, 0, 0);
  const end = new Date(y, m + 1, day, 0, 0, 0, 0);
  return { start: start.getTime(), end: end.getTime() };
}

/**
 * Milliseconds of `session` that overlap `range` (half-open).
 * Open sessions use `nowMs` as their end.
 */
export function sessionOverlapMs(session: Session, range: TimeRange, nowMs: number): number {
  const sessStart = session.startedAt;
  const sessEnd = session.endedAt == null ? nowMs : session.endedAt;
  if (!(Number.isFinite(sessStart) && Number.isFinite(sessEnd))) return 0;
  if (sessEnd <= sessStart) return 0;
  const lo = Math.max(sessStart, range.start);
  const hi = Math.min(sessEnd, range.end);
  return Math.max(0, hi - lo);
}

/** Sum session overlaps with a range; optionally filter by task ids. */
export function sumOverlapMs(
  sessions: Session[],
  range: TimeRange,
  nowMs: number,
  taskIds?: Set<string>,
): number {
  let total = 0;
  for (const session of sessions) {
    if (taskIds && !taskIds.has(session.taskId)) continue;
    total += sessionOverlapMs(session, range, nowMs);
  }
  return total;
}

/**
 * Format elapsed ms for UI totals.
 * Under 1 hour → `M:SS` (hours omitted). At/above 1 hour → `H:MM` (no seconds).
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  if (hours >= 1) {
    const minutes = Math.floor((totalSec % 3600) / 60);
    return `${hours}:${pad2(minutes)}`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${pad2(seconds)}`;
}

/** Create a new project entity (caller inserts into state). */
export function createProject(name = "", color?: string, order = 0): Project {
  return {
    id: newId("proj"),
    name,
    color: color && color.trim() ? color : PROJECT_COLORS[order % PROJECT_COLORS.length]!,
    order,
  };
}

/** Rename one project by id. */
export function renameProject(projects: Project[], id: string, name: string): Project[] {
  return projects.map((p) => (p.id === id ? { ...p, name } : p));
}

/** Remove a project and cascade-delete its tasks and sessions. */
export function removeProject(state: TimeTrackerState, projectId: string): TimeTrackerState {
  const projects = reindexProjectOrders(state.projects.filter((p) => p.id !== projectId));
  const dropTasks = new Set(state.tasks.filter((t) => t.projectId === projectId).map((t) => t.id));
  const tasks = state.tasks.filter((t) => t.projectId !== projectId);
  const sessions = state.sessions.filter((s) => !dropTasks.has(s.taskId));
  let selectedProjectId = state.selectedProjectId;
  if (selectedProjectId === projectId) {
    selectedProjectId = projects[0]?.id ?? null;
  }
  return { ...state, projects, tasks, sessions, selectedProjectId };
}

/** Reorder projects to match `orderedIds` (unknown ids appended in prior order). */
export function reorderProjects(projects: Project[], orderedIds: string[]): Project[] {
  return reorderByIds(projects, orderedIds);
}

/** Set a project's color. */
export function setProjectColor(projects: Project[], id: string, color: string): Project[] {
  return projects.map((p) => (p.id === id ? { ...p, color } : p));
}

/** Create a new task entity under a project (caller inserts into state). */
export function createTask(projectId: string, text = "", order = 0): Task {
  return {
    id: newId("task"),
    projectId,
    text,
    done: false,
    order,
  };
}

/** Set text on one task. */
export function setTaskText(tasks: Task[], id: string, text: string): Task[] {
  return tasks.map((t) => (t.id === id ? { ...t, text } : t));
}

/** Set done flag on one task (does not start/stop sessions). */
export function setTaskDone(tasks: Task[], id: string, done: boolean): Task[] {
  return tasks.map((t) => (t.id === id ? { ...t, done } : t));
}

/** Remove a task and cascade-delete its sessions. */
export function removeTask(state: TimeTrackerState, taskId: string): TimeTrackerState {
  const task = state.tasks.find((t) => t.id === taskId);
  const tasks = reindexTaskOrders(
    state.tasks.filter((t) => t.id !== taskId),
    task?.projectId,
  );
  const sessions = state.sessions.filter((s) => s.taskId !== taskId);
  return { ...state, tasks, sessions };
}

/** Reorder tasks within one project to match `orderedIds`. */
export function reorderTasks(
  tasks: Task[],
  projectId: string,
  orderedIds: string[],
): Task[] {
  const inProject = tasks.filter((t) => t.projectId === projectId);
  const others = tasks.filter((t) => t.projectId !== projectId);
  return [...others, ...reorderByIds(inProject, orderedIds)];
}

/** Tasks for a project, sorted by order. */
export function tasksForProject(tasks: Task[], projectId: string): Task[] {
  return tasks
    .filter((t) => t.projectId === projectId)
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * Start timing `taskId` at `nowMs`. Ends any other open session first.
 * No-op when the task is missing, done, or already the running task.
 */
export function startTask(state: TimeTrackerState, taskId: string, nowMs: number): TimeTrackerState {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || task.done) return state;
  if (runningTaskId(state.sessions) === taskId) return state;

  const sessions = [
    ...state.sessions.map((s) => (s.endedAt == null ? { ...s, endedAt: nowMs } : s)),
    {
      id: newId("sess"),
      taskId,
      startedAt: nowMs,
      endedAt: null,
    },
  ];
  return { ...state, sessions };
}

/** Pause the currently running session at `nowMs` (no-op if idle). */
export function pauseActive(state: TimeTrackerState, nowMs: number): TimeTrackerState {
  const active = activeSession(state.sessions);
  if (!active) return state;
  return {
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === active.id ? { ...s, endedAt: nowMs } : s,
    ),
  };
}

/**
 * Mark `taskId` done and end its open session at `nowMs` if it is running.
 * Does not affect a session belonging to a different task.
 */
export function finishTask(state: TimeTrackerState, taskId: string, nowMs: number): TimeTrackerState {
  if (!state.tasks.some((t) => t.id === taskId)) return state;
  const tasks = setTaskDone(state.tasks, taskId, true);
  const sessions = state.sessions.map((s) =>
    s.taskId === taskId && s.endedAt == null ? { ...s, endedAt: nowMs } : s,
  );
  return { ...state, tasks, sessions };
}

/** The single open session, if any. */
export function activeSession(sessions: Session[]): Session | null {
  return sessions.find((s) => s.endedAt == null) ?? null;
}

/** Task id of the open session, or null when idle. */
export function runningTaskId(sessions: Session[]): string | null {
  return activeSession(sessions)?.taskId ?? null;
}

/**
 * Clone state for widget duplicate: keep closed sessions, drop any open session.
 */
export function stateForDuplicate(state: TimeTrackerState): TimeTrackerState {
  const normalized = normalizeState(state);
  return {
    ...normalized,
    projects: normalized.projects.map((p) => ({ ...p })),
    tasks: normalized.tasks.map((t) => ({ ...t })),
    sessions: normalized.sessions
      .filter((s) => s.endedAt != null)
      .map((s) => ({ ...s })),
    settings: { ...normalized.settings },
  };
}

// --- internals ---

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function clampWeekStartsOn(value: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  if (!Number.isFinite(value)) return 1;
  const n = Math.round(value);
  if (n < 0) return 0;
  if (n > 6) return 6;
  return n as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

function clampMonthStartsOn(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(28, Math.max(1, Math.round(value)));
}

function normalizeSettings(raw: unknown): TimeTrackerSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    weekStartsOn: clampWeekStartsOn(
      typeof o.weekStartsOn === "number" ? o.weekStartsOn : base.weekStartsOn,
    ),
    monthStartsOn: clampMonthStartsOn(
      typeof o.monthStartsOn === "number" ? o.monthStartsOn : base.monthStartsOn,
    ),
  };
}

function normalizeProjects(raw: unknown[]): Project[] {
  const ids = new Set<string>();
  const projects: Project[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id ? o.id : newId("proj");
    if (ids.has(id)) continue;
    ids.add(id);
    const order =
      typeof o.order === "number" && Number.isFinite(o.order) ? o.order : projects.length;
    projects.push({
      id,
      name: typeof o.name === "string" ? o.name : "",
      color:
        typeof o.color === "string" && o.color
          ? o.color
          : PROJECT_COLORS[projects.length % PROJECT_COLORS.length]!,
      order,
    });
  }
  return reindexProjectOrders(projects);
}

function normalizeTasks(raw: unknown[], projectIds: Set<string>): Task[] {
  const ids = new Set<string>();
  const tasks: Task[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const projectId = typeof o.projectId === "string" ? o.projectId : "";
    // Repair orphans: drop tasks whose project is missing.
    if (!projectId || !projectIds.has(projectId)) continue;
    const id = typeof o.id === "string" && o.id ? o.id : newId("task");
    if (ids.has(id)) continue;
    ids.add(id);
    tasks.push({
      id,
      projectId,
      text: typeof o.text === "string" ? o.text : "",
      done: o.done === true,
      order: typeof o.order === "number" && Number.isFinite(o.order) ? o.order : tasks.length,
    });
  }
  return reindexAllTaskOrders(tasks);
}

function normalizeSessions(raw: unknown[], taskIds: Set<string>): Session[] {
  const ids = new Set<string>();
  const sessions: Session[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const taskId = typeof o.taskId === "string" ? o.taskId : "";
    if (!taskId || !taskIds.has(taskId)) continue;
    const startedAt = typeof o.startedAt === "number" && Number.isFinite(o.startedAt) ? o.startedAt : NaN;
    if (!Number.isFinite(startedAt)) continue;
    let endedAt: number | null = null;
    if (o.endedAt === null || o.endedAt === undefined) {
      endedAt = null;
    } else if (typeof o.endedAt === "number" && Number.isFinite(o.endedAt)) {
      endedAt = o.endedAt;
    } else {
      continue;
    }
    if (endedAt != null && endedAt < startedAt) continue;
    const id = typeof o.id === "string" && o.id ? o.id : newId("sess");
    if (ids.has(id)) continue;
    ids.add(id);
    sessions.push({ id, taskId, startedAt, endedAt });
  }
  return sessions;
}

/**
 * Enforce ≤1 open session: keep newest `startedAt` open;
 * close others at that start time. Zero-length leftovers are dropped.
 */
function enforceSingleOpen(sessions: Session[]): Session[] {
  const open = sessions
    .filter((s) => s.endedAt == null)
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id));
  if (open.length <= 1) return sessions;

  const keeperId = open[0]!.id;
  const closeAt = open[0]!.startedAt;
  const closedIds = new Set(open.slice(1).map((s) => s.id));

  return sessions
    .map((s) => {
      if (s.id === keeperId) return s;
      if (closedIds.has(s.id)) return { ...s, endedAt: closeAt };
      return s;
    })
    .filter((s) => !(closedIds.has(s.id) && s.endedAt != null && s.endedAt <= s.startedAt));
}

function reindexProjectOrders(projects: Project[]): Project[] {
  const sorted = projects
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const orderById = new Map(sorted.map((p, i) => [p.id, i]));
  return projects.map((p) => ({ ...p, order: orderById.get(p.id) ?? p.order }));
}

function reindexAllTaskOrders(tasks: Task[]): Task[] {
  const byProject = new Map<string, Task[]>();
  for (const t of tasks) {
    const list = byProject.get(t.projectId) ?? [];
    list.push(t);
    byProject.set(t.projectId, list);
  }
  const orderById = new Map<string, number>();
  for (const [, list] of byProject) {
    list
      .slice()
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .forEach((t, i) => orderById.set(t.id, i));
  }
  return tasks.map((t) => ({ ...t, order: orderById.get(t.id) ?? t.order }));
}

function reindexTaskOrders(tasks: Task[], projectId?: string): Task[] {
  if (!projectId) return reindexAllTaskOrders(tasks);
  const inProject = tasks
    .filter((t) => t.projectId === projectId)
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const orderById = new Map(inProject.map((t, i) => [t.id, i]));
  return tasks.map((t) =>
    t.projectId === projectId ? { ...t, order: orderById.get(t.id) ?? t.order } : t,
  );
}

function reorderByIds<T extends { id: string; order: number }>(
  items: T[],
  orderedIds: string[],
): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const next: T[] = [];
  for (const id of orderedIds) {
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    seen.add(id);
    next.push(item);
  }
  for (const item of items
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    if (!seen.has(item.id)) next.push(item);
  }
  return next.map((item, order) => ({ ...item, order }));
}

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
