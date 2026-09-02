import type { ProviderError, QueryState } from "@sdk/contract/sdk";

/**
 * What a widget's body is doing, once the gate has said "ready".
 *
 * Pulled out of `useWidgetRuntime` because there are now two ways to run a
 * widget — in this document, or inside a sandboxed frame — and they must not
 * disagree about when a skeleton shows. In a transparent overlay two widgets
 * inventing two loading states is exactly the breakage the runtime owns this to
 * prevent, and "the same rules, written twice" is how that starts.
 */
export type WidgetBodyPhase = "loading" | "error" | "ready";

export interface WidgetBodyInput {
  /** Setup has been asked for and has not finished. */
  mounting: boolean;
  /** Setup threw. In the sandbox this is what the guest reported. */
  setupFailure?: ProviderError;
  /**
   * One entry per query the widget opened, in the order it opened them.
   *
   * An array rather than an `Iterable` on purpose. The first version took an
   * iterable and the caller handed it `map.values()`, which is consumed once —
   * so `resolveBodyPhase` drained it and `resolveBodyError` saw an empty
   * sequence, and a pending query rendered as ready. The type is the fix; the
   * call site was only where it happened to surface.
   */
  queryStates: readonly QueryState<unknown>[];
}

/**
 * Worst state wins, and the tie-break is the order the widget opened them.
 *
 * Error outranks loading deliberately: a failure has already happened, a
 * pending query only might, and letting the maybe win hides the fact. Taking
 * the first error rather than the newest keeps the message stable while the
 * other queries settle around it.
 */
export function aggregateQueryState(
  states: readonly QueryState<unknown>[],
): QueryState<unknown> | undefined {
  return (
    states.find((s) => s.status === "error") ??
    states.find((s) => s.status === "loading") ??
    states[states.length - 1]
  );
}

export function resolveBodyPhase(input: WidgetBodyInput): WidgetBodyPhase {
  if (input.setupFailure) return "error";
  if (input.mounting) return "loading";

  const q = aggregateQueryState(input.queryStates);
  // No query at all is the Todo and Clock case: nothing to wait for.
  if (!q) return "ready";
  if (q.status === "loading") return "loading";
  if (q.status === "error") return "error";
  return "ready";
}

/** The error to show, matching whatever `resolveBodyPhase` decided. */
export function resolveBodyError(input: WidgetBodyInput): ProviderError | undefined {
  if (input.setupFailure) return input.setupFailure;
  const q = aggregateQueryState(input.queryStates);
  return q?.status === "error" ? q.error : undefined;
}
