/**
 * Checks for timer duration parsing (widget input + "set timer" palette action).
 * Run: npx tsx extensions/timer/timerLogic.assert.ts
 */
import {
  MIN_DURATION_MS,
  parseCustomDuration,
  timerInlineActions,
  timerInlineView,
} from "./timerLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const MIN = 60_000;
const HOUR = 3_600_000;

// Plain numbers stay minutes (unchanged widget behavior).
assert(parseCustomDuration("25") === 25 * MIN, "bare number is minutes");
assert(parseCustomDuration(" 5 ") === 5 * MIN, "trims");

// MM:SS (unchanged).
assert(parseCustomDuration("5:30") === 5 * MIN + 30_000, "mm:ss");
assert(parseCustomDuration("0:45") === 45_000, "seconds only via mm:ss");
assert(parseCustomDuration("5:60") === null, "60 seconds is not a valid mm:ss");

// Unit forms — what the palette action needs.
assert(parseCustomDuration("1h") === HOUR, "hours");
assert(parseCustomDuration("25m") === 25 * MIN, "minutes");
assert(parseCustomDuration("90s") === 90_000, "seconds");
assert(parseCustomDuration("1h30") === HOUR + 30 * MIN, "bare tail inherits the smaller unit");
assert(parseCustomDuration("1h30m") === HOUR + 30 * MIN, "explicit tail unit");
assert(parseCustomDuration("1h 30m") === HOUR + 30 * MIN, "spaces allowed");
assert(parseCustomDuration("2m30") === 2 * MIN + 30_000, "minutes then seconds");
assert(parseCustomDuration("1H") === HOUR, "case-insensitive");

// Junk stays rejected.
assert(parseCustomDuration("") === null, "empty");
assert(parseCustomDuration("   ") === null, "blank");
assert(parseCustomDuration("abc") === null, "letters");
assert(parseCustomDuration("1x30") === null, "unknown unit");
assert(parseCustomDuration("30 minutes") === null, "spelled-out units are not supported");

// Clamping still applies.
assert(parseCustomDuration("0s") === MIN_DURATION_MS, "clamps up to the minimum");
assert(parseCustomDuration("0") === MIN_DURATION_MS, "zero minutes clamps too");

// --- palette inline view ------------------------------------------------------------
const FIVE_MIN = 5 * MIN;

{
  const view = timerInlineView({
    remainingMs: FIVE_MIN,
    durationMs: FIVE_MIN,
    running: false,
    ringing: false,
  });
  assert(view.value === "05:00", "untouched timer shows its full duration");
  assert(view.label === "Ready", "untouched timer reads Ready");
  assert(view.tone === "neutral", "Ready is not accented");
}

{
  const view = timerInlineView({
    remainingMs: 578_000,
    durationMs: 600_000,
    running: true,
    ringing: false,
  });
  assert(view.value === "09:38", "running timer shows the countdown");
  assert(view.label === "Running", "running timer reads Running");
  assert(view.placement === "detail", "timer reading stays below the title");
  assert(view.tone === "active", "running is accented as active");
}

{
  // The state the user asked for by name: stopped part-way through.
  const view = timerInlineView({
    remainingMs: 90_000,
    durationMs: FIVE_MIN,
    running: false,
    ringing: false,
  });
  assert(view.value === "01:30", "paused timer keeps its remaining time");
  assert(view.label === "Paused", "a countdown below its duration reads Paused");
  assert(view.tone === "warn", "paused is accented as warn");
}

{
  const view = timerInlineView({
    remainingMs: 0,
    durationMs: FIVE_MIN,
    running: false,
    ringing: true,
  });
  assert(view.label === "Done", "a ringing timer reads Done");
  assert(view.tone === "done", "done is accented as done");
}

{
  // Ringing wins over the below-duration test that would otherwise say Paused.
  const view = timerInlineView({
    remainingMs: 0,
    durationMs: FIVE_MIN,
    running: true,
    ringing: true,
  });
  assert(view.label === "Done", "ringing outranks running");
}

{
  const view = timerInlineView({
    remainingMs: 2 * HOUR,
    durationMs: 2 * HOUR,
    running: false,
    ringing: false,
  });
  assert(view.value === "2:00:00", "long timers keep the hour segment");
}

// --- state-dependent row actions ------------------------------------------------------
const ids = (s: Parameters<typeof timerInlineActions>[0]) =>
  timerInlineActions(s).map((a) => a.id).join(",");

const READY = { remainingMs: FIVE_MIN, durationMs: FIVE_MIN, running: false, ringing: false };
const RUNNING = { remainingMs: 90_000, durationMs: FIVE_MIN, running: true, ringing: false };
const PAUSED = { remainingMs: 90_000, durationMs: FIVE_MIN, running: false, ringing: false };
const RINGING = { remainingMs: 0, durationMs: FIVE_MIN, running: false, ringing: true };

assert(ids(READY) === "start,set", "a Ready timer offers Start, then Set");
assert(ids(RUNNING) === "pause,restart,set", "a running timer offers Pause, Restart, Set");
assert(ids(PAUSED) === "resume,reset,set", "a paused timer offers Resume, Reset, Set");
assert(ids(RINGING) === "dismiss,restart,set", "a ringing timer offers Dismiss, Restart, Set");
assert(
  ids({ remainingMs: 0, durationMs: FIVE_MIN, running: true, ringing: true }) ===
    "dismiss,restart,set",
  "ringing outranks running for actions too",
);

// Re-timing an existing timer must be reachable from every state, and never
// ahead of the one-press actions — it is the only one that needs typing.
for (const [name, snapshot] of Object.entries({ READY, RUNNING, PAUSED, RINGING })) {
  const list = timerInlineActions(snapshot);
  assert(list[list.length - 1]!.id === "set", `${name} keeps Set last`);
  assert(list.filter((a) => a.id === "set").length === 1, `${name} offers Set once`);
}
assert(
  timerInlineActions({
    remainingMs: 90_000,
    durationMs: FIVE_MIN,
    running: true,
    ringing: false,
  })[0]!.title === "Pause",
  "the leading action carries a human label",
);
// The view and the buttons must never disagree about what state we are in.
for (const snapshot of [
  { remainingMs: FIVE_MIN, durationMs: FIVE_MIN, running: false, ringing: false },
  { remainingMs: 90_000, durationMs: FIVE_MIN, running: true, ringing: false },
  { remainingMs: 90_000, durationMs: FIVE_MIN, running: false, ringing: false },
  { remainingMs: 0, durationMs: FIVE_MIN, running: false, ringing: true },
]) {
  const label = timerInlineView(snapshot).label;
  const first = timerInlineActions(snapshot)[0]!.id;
  const expected: Record<string, string> = {
    Ready: "start",
    Running: "pause",
    Paused: "resume",
    Done: "dismiss",
  };
  assert(expected[label!] === first, `${label} leads with ${expected[label!]}`);
}

console.log("timerLogic.assert.ts: ok");
