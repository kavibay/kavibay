import { computed, ref, shallowRef, type ComputedRef, type Ref } from "vue";

/**
 * One scripted demo's state: what it is doing, how far it has got, and the two
 * levers a visitor has over it.
 *
 * WHY THIS IS A FACTORY AND NOT A MODULE OF REFS:
 *
 * It used to be a singleton, on the argument that a page holds one demo and
 * two would fight over the values. That held for exactly as long as the page
 * had one. The landing page now runs the Wizard tour in one section and the
 * launcher script in another, and they must not share a Pause button, a
 * progress bar or — least visibly and most damaging — a clock: pausing the
 * tour would have held every `beat` in the launcher script two screens down,
 * mid-word, for reasons nothing on screen explains.
 *
 * So each script owns a run, and the runs are addressed by name. The name is
 * what lets parties that are not in one component tree find the same one: the
 * director (`tour.ts`, `launcherScript.ts`), code running inside a widget the
 * director does not own (`wizardAutoplay.ts`), and the transport element the
 * page places wherever it likes (`DemoControls.ce.vue`, `run="tour"`).
 *
 * Adding a third demo is `demoRun("my-demo", MY_STEPS)` in its director and
 * `<kavibay-demo-controls run="my-demo">` in the markup. Nothing central to
 * edit.
 */
export type DemoPhase = "idle" | "running" | "paused" | "finished" | "stopped";

/** What the transport offers right now. */
export type DemoControl = "play" | "pause" | "replay";

export interface DemoRun {
  readonly name: string;
  /**
   * The milestones the bar fills to, set by whoever defines the run.
   *
   * Named beats, not a clock. A timed bar would have to guess how long a step
   * takes, and that varies by an order of magnitude — a background tab
   * throttles rendering to about a frame a second. Each of these is reached by
   * something actually happening, so the bar can be behind but never wrong.
   */
  readonly steps: Ref<readonly string[]>;
  readonly phase: Ref<DemoPhase>;
  /** Milestones passed, 0…steps.length. */
  readonly step: Ref<number>;
  readonly progress: ComputedRef<number>;
  readonly control: ComputedRef<DemoControl>;
  /** True once a director has claimed this run; a transport hides until then. */
  readonly present: ComputedRef<boolean>;

  /** The run's unit of time: wait, then hold while somebody has it paused. */
  beat(ms: number): Promise<void>;
  /** Resolves once this run is not paused. Immediate when it never was. */
  whileRunning(): Promise<void>;
  /** A clock that stops while this run is paused. */
  now(): number;

  begin(): void;
  reachStep(index: number): void;
  finish(): void;
  stop(): void;
  pause(): void;
  resume(): void;

  onReplay(handler: () => void): void;
  replay(): void;
  markPresent(): void;
}

function createRun(name: string): DemoRun {
  // Shallow: the labels are replaced wholesale, never edited in place, and a
  // deep ref would hand out a proxy of the array a director passed in.
  const steps = shallowRef<readonly string[]>([]);
  const phase = ref<DemoPhase>("idle");
  const step = ref(0);
  const replayReady = ref(false);

  /**
   * Everything holding at a `beat`, waiting for the pause to lift.
   *
   * A set of resolvers rather than a flag the loops poll: a paused demo should
   * cost nothing, and a poll would keep every loop awake for as long as
   * somebody leaves the page paused.
   */
  const waiting = new Set<() => void>();
  const release = () => {
    for (const resolve of waiting) resolve();
    waiting.clear();
  };

  /*
   * WHY THIS RUN CANNOT USE `Date.now()`:
   *
   * Loops give up after a deadline — the Wizard's mount wait (8s), a turn's
   * answer (20s), the finished package (180s). Measured against the wall clock
   * they keep expiring while somebody has the demo paused: pause for half a
   * minute to read the transcript, press Play, and the wait had already run
   * out. That is the "resume sometimes does nothing", and how long the pause
   * was decided it. Paused time is subtracted here instead.
   */
  let pausedSince = 0;
  let pausedTotal = 0;

  const closePause = () => {
    if (pausedSince === 0) return;
    pausedTotal += Date.now() - pausedSince;
    pausedSince = 0;
  };

  let replayHandler: (() => void) | null = null;

  const run: DemoRun = {
    name,
    steps,
    phase,
    step,
    // An empty run has no bar to fill; guarding here keeps a transport that
    // renders before its director has defined the steps from dividing by zero.
    progress: computed(() => (steps.value.length === 0 ? 0 : step.value / steps.value.length)),
    control: computed<DemoControl>(() => {
      if (phase.value === "running") return "pause";
      if (phase.value === "paused") return "play";
      return "replay";
    }),
    present: computed(() => replayReady.value),

    async beat(ms: number) {
      /*
       * Waiting *then* checking rather than the other way round keeps it to one
       * timer per beat; the visible effect is that a pause lands at the end of
       * the character being typed, which is where a person expects it anyway.
       */
      await new Promise((resolve) => setTimeout(resolve, ms));
      await run.whileRunning();
    },

    whileRunning() {
      if (phase.value !== "paused") return Promise.resolve();
      return new Promise<void>((resolve) => waiting.add(resolve));
    },

    now() {
      const openPause = pausedSince === 0 ? 0 : Date.now() - pausedSince;
      return Date.now() - pausedTotal - openPause;
    },

    begin() {
      step.value = 0;
      phase.value = "running";
      closePause();
      release();
    },

    /** Monotonic: a late report cannot pull the bar back. */
    reachStep(index: number) {
      step.value = Math.min(steps.value.length, Math.max(step.value, index));
    },

    finish() {
      step.value = steps.value.length;
      phase.value = "finished";
      closePause();
      release();
    },

    /**
     * The visitor took over — clicked something, typed something.
     *
     * A separate phase from "finished" because it means something different to
     * the person: the demo stopped because *they* did something, and Replay is
     * an offer rather than a repeat. Both show the same button, and that is
     * fine.
     */
    stop() {
      if (phase.value === "idle" || phase.value === "finished") return;
      phase.value = "stopped";
      closePause();
      release();
    },

    pause() {
      if (phase.value !== "running") return;
      phase.value = "paused";
      pausedSince = Date.now();
    },

    resume() {
      if (phase.value !== "paused") return;
      phase.value = "running";
      closePause();
      release();
    },

    /**
     * How a replay actually happens, registered by whoever can perform one.
     *
     * The run knows when to offer it and nothing about how: a director has to
     * reset its fixture, close its cards and clear its palette, and none of
     * that belongs here.
     */
    onReplay(handler: () => void) {
      replayHandler = handler;
    },

    replay() {
      replayHandler?.();
    },

    markPresent() {
      replayReady.value = true;
    },
  };

  return run;
}

/**
 * Runs by name, created on first ask.
 *
 * Created rather than looked up, because the order the parties arrive in is
 * not fixed: the transport element may upgrade before the palette that starts
 * the demo, or after it. Whoever asks first gets an idle, stepless run and
 * everyone else gets that same object — `present` stays false until a director
 * claims it, and a transport for a demo that never plays renders nothing.
 */
const runs = new Map<string, DemoRun>();

export function demoRun(name: string, steps?: readonly string[]): DemoRun {
  let run = runs.get(name);
  if (!run) {
    run = createRun(name);
    runs.set(name, run);
  }
  if (steps) run.steps.value = steps;
  return run;
}

/**
 * The demo that is in progress, if one is.
 *
 * For code that belongs to no particular script and still has to answer "did
 * the visitor just interrupt something?" — a widget card, which is placed by a
 * page and driven by whatever script that page runs.
 *
 * Paused counts as in progress: the run is unfinished and its transport is
 * standing there offering Play, so a keystroke has something to stop. What
 * does not count is idle, finished or stopped — nothing is waiting to be
 * interrupted, and the caller is then free to treat the gesture as its own.
 */
export function demoInProgress(): DemoRun | null {
  for (const run of runs.values()) {
    if (run.phase.value === "running" || run.phase.value === "paused") return run;
  }
  return null;
}
