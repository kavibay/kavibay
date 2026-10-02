/**
 * Which Wizard story the landing page is playing.
 *
 * Buttons sit above the desk, one per case. They do not each own a tour: there is one
 * director (`tour.ts`) and one fixture, and this name is what both read to
 * decide which prompt, which package and which palette row belong to the run.
 *
 * Kept as a module of functions rather than a Vue ref so the typing loop
 * inside the Wizard — a different component tree, addressed by name — can
 * ask the same question the director asks.
 */

export const DEMO_CASE_IDS = ["water-tracker", "linear-github-todos", "lisbon-countdown", "tado-room-climate", "linear-quick-issue", "screenshot-status", "point-and-prompt", "service-health"] as const;

export type DemoCaseId = (typeof DEMO_CASE_IDS)[number];

const DEFAULT_CASE: DemoCaseId = "water-tracker";

let current: DemoCaseId = DEFAULT_CASE;

export function isDemoCaseId(value: string | undefined | null): value is DemoCaseId {
  return (DEMO_CASE_IDS as readonly string[]).includes(value ?? "");
}

export function demoCase(): DemoCaseId {
  return current;
}

export function setDemoCase(id: DemoCaseId): void {
  current = id;
}

/** Tests, and nothing in the page: a run should not leak its choice into the next. */
export function resetDemoCase(): void {
  current = DEFAULT_CASE;
}
