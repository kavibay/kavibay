import { ref, shallowRef } from "vue";
import type { HostUi } from "./runtime";
import type { PromptSpec } from "./ui/CommandDialog.vue";

/**
 * PHASE 5 — `HostUi` as a promise bridge to one dialog.
 *
 * `runCommand` is synchronous prose: resolve the options, ask, confirm, execute.
 * It awaits `ui.prompt(...)` and does not care what draws it. So the adapter
 * lives here: a request goes into a ref the dialog renders, and the answer
 * resolves the promise the command is sitting on.
 *
 * One dialog and one pending request at a time, deliberately. A command asks
 * its arguments in sequence, and two overlapping prompts would leave the user
 * guessing which command they are answering.
 */

type Pending =
  | { kind: "prompt"; spec: PromptSpec }
  | { kind: "confirm"; message: string }
  | null;

export interface CommandUi {
  ui: HostUi;
  /** What the dialog should render, or null. */
  request: Readonly<{ value: Pending }>;
  /** Latest notification, for whatever surface shows it. */
  notice: Readonly<{ value: string | null }>;
  answer(value: string | number | boolean | undefined): void;
  confirm(ok: boolean): void;
  dismissNotice(): void;
}

export function createCommandUi(): CommandUi {
  const request = shallowRef<Pending>(null);
  const notice = ref<string | null>(null);

  let resolveAnswer: ((value: string | number | boolean | undefined) => void) | undefined;
  let resolveConfirm: ((ok: boolean) => void) | undefined;

  /**
   * A second request while one is open cancels the first rather than queueing.
   * Queueing would make a command the user walked away from reappear later,
   * attached to a title they no longer have in mind.
   */
  function settleOutstanding() {
    resolveAnswer?.(undefined);
    resolveConfirm?.(false);
    resolveAnswer = undefined;
    resolveConfirm = undefined;
  }

  const ui: HostUi = {
    prompt(spec) {
      settleOutstanding();
      request.value = { kind: "prompt", spec: spec as PromptSpec };
      return new Promise((resolve) => {
        resolveAnswer = resolve;
      });
    },

    confirm(message) {
      settleOutstanding();
      request.value = { kind: "confirm", message };
      return new Promise((resolve) => {
        resolveConfirm = resolve;
      });
    },

    notify(message) {
      notice.value = message;
    },
  };

  return {
    ui,
    request,
    notice,
    answer(value) {
      request.value = null;
      const resolve = resolveAnswer;
      resolveAnswer = undefined;
      resolve?.(value);
    },
    confirm(ok) {
      request.value = null;
      const resolve = resolveConfirm;
      resolveConfirm = undefined;
      resolve?.(ok);
    },
    dismissNotice() {
      notice.value = null;
    },
  };
}
