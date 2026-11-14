/**
 * The frontend's half of the dev-only opening stopwatch (`src-tauri/src/open_timing.rs`).
 *
 * Rust sends `timingOriginMs` with `palette:hotkey` only in debug builds and only
 * when it revealed the window, so a release build never starts a trace here.
 * The stages are wall-clock times; Rust subtracts its trigger and prints one
 * line to the `pnpm run tauri dev` terminal:
 *
 *   event         the `palette:hotkey` listener runs
 *   search-focus  the palette is rendered and the search field has the focus
 *   frame         first animation frame after it — the first chance to paint
 *   resumed       the same frame, after the host's own callback (widget onResume)
 *   painted       the frame after that, i.e. the opening is on screen
 *
 * Rust sends the event before it shows the window, so `event` and
 * `search-focus` normally land while the window is still hidden; the frames
 * cannot, because a hidden page gets no animation frames.
 */
import { invoke } from "@tauri-apps/api/core";

/** Give up on a stage that never comes rather than holding the report forever. */
const REPORT_TIMEOUT_MS = 1500;

type Mark = [stage: string, atEpochMs: number];

let trace: { marks: Mark[]; waiting: Set<string>; timer: ReturnType<typeof setTimeout> } | null =
  null;

const nowEpochMs = () => performance.timeOrigin + performance.now();

function report() {
  if (!trace) return;
  clearTimeout(trace.timer);
  const marks = trace.marks;
  trace = null;
  void invoke("open_timing_report", { marks }).catch(() => undefined);
}

/** Record a stage of the current opening, if one is being measured. */
export function markOpenTiming(stage: string): void {
  if (!trace) return;
  trace.marks.push([stage, nowEpochMs()]);
  trace.waiting.delete(stage);
  if (trace.waiting.size === 0) report();
}

/**
 * Start a trace for an opening Rust measured, before the host handles it.
 *
 * Call `afterHostHandled()` on the result once the hotkey has been handled, so
 * the `resumed` frame callback is queued behind the host's own.
 */
export function beginOpenTiming(originMs: number | undefined): { afterHostHandled(): void } {
  const idle = { afterHostHandled() {} };
  if (typeof originMs !== "number") return idle;
  if (trace) report(); // an unfinished older trace goes out as it is

  trace = {
    marks: [],
    waiting: new Set(["search-focus", "frame", "resumed", "painted"]),
    timer: setTimeout(report, REPORT_TIMEOUT_MS),
  };
  markOpenTiming("event");
  requestAnimationFrame(() => markOpenTiming("frame"));
  return {
    afterHostHandled() {
      requestAnimationFrame(() => {
        markOpenTiming("resumed");
        requestAnimationFrame(() => markOpenTiming("painted"));
      });
    },
  };
}
