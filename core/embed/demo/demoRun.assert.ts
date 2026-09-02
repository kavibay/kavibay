/**
 * A demo's transport: which button is offered, that pause actually holds, and
 * that two demos on one page cannot reach into each other.
 * Run: npx tsx core/embed/demo/demoRun.assert.ts
 *
 * Every failure here looks like nothing at all. A button showing the wrong
 * verb is a control that does the opposite of what it says; a `beat` that
 * resolves while paused is a demo that keeps typing under a pressed Pause; and
 * a run that shares a clock with its neighbour freezes a section two screens
 * away for reasons nothing on screen explains. None of them throws, and none
 * is visible in a diff.
 */
import { demoInProgress, demoRun } from "./demoRun";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const STEPS = ["One", "Two", "Three", "Four", "Five"] as const;
const run = demoRun("assert-tour", STEPS);

/*
 * Read through functions rather than touching the refs directly.
 *
 * `assert` is a type guard, so `assert(now() === "idle", …)` narrows
 * `phase.value` to that literal for the rest of the file — and TypeScript has
 * no way to know `begin()` changed it, so every later comparison was reported
 * as impossible. Going through a call resets the narrowing each time.
 */
const now = () => run.phase.value;
const offer = () => run.control.value;
const at = () => run.step.value;
const bar = () => run.progress.value;
const claimed = () => run.present.value;

/** The same name is the same run — that is what makes a name an address. */
assert(demoRun("assert-tour") === run, "asking again returns the same run");
assert(demoRun("assert-other") !== run, "a different name is a different run");
assert(run.steps.value === STEPS, "a run carries the milestones it was defined with");

/** Before anything runs there is nothing to pause, so Replay is the offer. */
assert(now() === "idle", "a page starts with the demo not yet running");
assert(offer() === "replay", "idle offers a way to start it");
assert(claimed() === false, "and a transport stays hidden until a director claims it");

run.begin();
assert(now() === "running" && offer() === "pause", "a running demo offers Pause");
assert(at() === 0 && bar() === 0, "and starts at the beginning of the bar");

/** Milestones only ever move forward — a late report cannot pull the bar back. */
run.reachStep(2);
run.reachStep(1);
assert(at() === 2, "a milestone reported out of order does not rewind the bar");
assert(Math.abs(bar() - 2 / STEPS.length) < 1e-9, "the bar is the fraction of milestones passed");

run.reachStep(99);
assert(at() === STEPS.length, "and never runs past the end");

/**
 * The heart of it: a beat taken while paused must not resolve until play.
 *
 * Written as a race against a longer timer, because the bug this catches is a
 * beat that resolves *early* — a plain `await` would pass whether the pause
 * held or not.
 */
const settled: string[] = [];
run.begin();
run.pause();
assert(offer() === "play", "a paused demo offers Play");

const held = run.beat(1).then(() => settled.push("beat"));
const marker = new Promise<void>((resolve) => setTimeout(resolve, 60)).then(() =>
  settled.push("marker"),
);

await marker;
assert(settled.join(",") === "marker", "a beat taken under Pause is still waiting 60ms later");

run.resume();
await held;
assert(settled.join(",") === "marker,beat", "and resolves once Play is pressed");
assert(now() === "running", "which puts the demo back to running");

/**
 * Two runs, two Pause buttons.
 *
 * The reason this file replaced a module of shared refs: the landing page runs
 * the Wizard tour in one section and the launcher script in another. Pausing
 * one used to hold every beat in the other, mid-word.
 */
const other = demoRun("assert-other", ["Only step"]);
other.begin();
run.begin();
run.pause();
assert(other.phase.value === "running", "pausing one run leaves the other running");

const neighbour: string[] = [];
const neighbourBeat = other.beat(1).then(() => neighbour.push("beat"));
await new Promise<void>((resolve) => setTimeout(resolve, 40));
assert(neighbour.join(",") === "beat", "and its beats resolve while the first one is paused");
await neighbourBeat;

/** A paused run still counts as in progress: its transport is offering Play. */
assert(demoInProgress() !== null, "a paused run is something a keystroke can still stop");

run.resume();
other.stop();

/** A visitor taking over ends the run, and the offer becomes Replay. */
run.stop();
assert(now() === "stopped" && offer() === "replay", "taking over offers Replay");
assert(demoInProgress() === null, "and nothing is left in progress");

/** Finishing does the same, from the other direction. */
run.begin();
run.finish();
assert(now() === "finished" && offer() === "replay", "so does finishing");
assert(at() === STEPS.length, "and the bar is full");

/**
 * Replay is performed by whoever registered a handler — the run knows when to
 * offer it and nothing about how to do it.
 */
let replays = 0;
run.markPresent();
run.onReplay(() => {
  replays += 1;
});
run.replay();
assert(replays === 1, "Replay calls the handler the director registered");
assert(claimed() === true, "a claimed run shows its transport");

/**
 * Paused time does not count against a deadline.
 *
 * Loops in the demo give up after one — the Wizard's mount wait, the answer
 * wait, the director's wait for the finished package. Measured against the
 * wall clock they expired while somebody had the demo paused, and Play then
 * resumed a run whose next step immediately gave up. It looked like "resume
 * sometimes does nothing", and how long the pause was decided it.
 */
run.begin();
const runningBefore = run.now();
run.pause();
await new Promise<void>((resolve) => setTimeout(resolve, 120));
const runningDuringPause = run.now();
assert(
  runningDuringPause - runningBefore < 40,
  "the demo clock barely moves across 120ms of pause",
);

run.resume();
await new Promise<void>((resolve) => setTimeout(resolve, 60));
const runningAfter = run.now();
assert(runningAfter > runningDuringPause, "and starts moving again on Play");
assert(runningAfter - runningBefore < 140, "the total still excludes the paused stretch");

/** A paused run that is stopped or finished must not leave a beat hanging. */
run.begin();
run.pause();
const orphan = run.beat(1);
run.stop();
await orphan;
assert(true, "a beat waiting under Pause is released when the run ends");

console.log("core/embed/demo/demoRun.assert.ts: ok");
