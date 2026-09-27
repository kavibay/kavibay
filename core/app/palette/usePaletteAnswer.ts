import { computed, shallowRef } from "vue";
import type { LlmChatRequest, LlmStreamEvent } from "@sdk/contract/sdk";

export interface PaletteAiModel {
  id: string;
  label: string;
  credentialType: string;
}

export interface PaletteAnswer {
  phase: "loading" | "streaming" | "done" | "stopped" | "error";
  text: string;
  modelLabel: string;
  error?: string;
  needsSetup?: boolean;
}

export interface PaletteMessage {
  role: "user" | "assistant";
  content: string;
}

interface PaletteAi {
  loadModel(): Promise<PaletteAiModel | null>;
  stream(request: LlmChatRequest, onEvent: (event: LlmStreamEvent) => void): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

/** One transient conversation; replacing the query invalidates older callbacks. */
export function usePaletteAnswer(ai: PaletteAi) {
  const model = shallowRef<PaletteAiModel | null>(null);
  const answer = shallowRef<PaletteAnswer | null>(null);
  const messages = shallowRef<PaletteMessage[]>([]);
  const busy = computed(() => answer.value?.phase === "loading" || answer.value?.phase === "streaming");
  let modelLoad = 0;
  let active: { id: string; started: boolean; cancelled: boolean } | null = null;

  /** Refresh the icon without letting an older settings read replace a newer one. */
  async function refreshModel() {
    const version = ++modelLoad;
    try {
      const next = await ai.loadModel();
      if (version === modelLoad) model.value = next;
      return next;
    } catch (error) {
      if (version === modelLoad) model.value = null;
      throw error;
    }
  }

  /** Detach the view first: even a late cancellation/error cannot revive it. */
  function stop() {
    const previous = active;
    active = null;
    if (previous) previous.cancelled = true;
    if (previous?.started) void ai.cancel(previous.id).catch(() => {});
    if (busy.value && answer.value) answer.value = { ...answer.value, phase: "stopped" };
  }

  function reset() {
    stop();
    answer.value = null;
    messages.value = [];
  }

  /** Only an explicit action starts a paid request, never typing or model discovery. */
  async function ask(query: string) {
    const term = query.trim();
    if (!term || busy.value) return;
    reset();
    messages.value = [{ role: "user", content: term }];
    await requestAnswer();
  }

  async function followUp(query: string) {
    const term = query.trim();
    if (!term || busy.value || !answer.value || answer.value.needsSetup) return;
    const previous: PaletteMessage[] = answer.value.text.trim()
      ? [{ role: "assistant", content: answer.value.text }]
      : [];
    messages.value = [...messages.value, ...previous, { role: "user", content: term }];
    await requestAnswer();
  }

  async function retry() {
    if (busy.value || messages.value.length === 0) return;
    // The pending user message is already in history; retry only its answer.
    await requestAnswer();
  }

  async function requestAnswer() {
    stop();
    const run = { id: crypto.randomUUID(), started: false, cancelled: false };
    active = run;
    answer.value = { phase: "loading", text: "", modelLabel: "" };
    try {
      const selected = await refreshModel();
      if (active !== run) return;
      if (!selected) {
        active = null;
        answer.value = {
          phase: "error", text: "", modelLabel: "", needsSetup: true,
          error: "Choose an AI model in Settings to ask a question.",
        };
        return;
      }
      answer.value = { phase: "loading", text: "", modelLabel: selected.label };
      run.started = true;
      await ai.stream({
        requestId: run.id,
        model: selected.id,
        messages: [
          { role: "system", content: "Answer the user's question concisely in their language. Use plain text. Be clear about uncertainty; do not claim to have searched the web or verified current facts." },
          ...messages.value,
        ],
      }, (event) => {
        if (active !== run || !answer.value) return;
        if (event.type === "chunk") {
          answer.value = { ...answer.value, phase: "streaming", text: answer.value.text + event.text };
          return;
        }
        active = null;
        const empty = event.type === "done" && !answer.value.text.trim();
        answer.value = {
          ...answer.value,
          phase: empty ? "error" : event.type === "done" ? "done" : event.type === "cancelled" ? "stopped" : "error",
          ...(event.type === "error" ? { error: event.message } : {}),
          ...(empty ? { error: "The provider returned an empty answer. Try again." } : {}),
        };
      });
      // Closing while the transport is installing its listeners must still
      // cancel once the request has actually been submitted.
      if (run.cancelled) {
        void ai.cancel(run.id).catch(() => {});
      }
    } catch (error) {
      if (active !== run) return;
      active = null;
      answer.value = {
        ...answer.value!, phase: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { model, answer, messages, busy, refreshModel, ask, followUp, retry, stop, reset };
}
