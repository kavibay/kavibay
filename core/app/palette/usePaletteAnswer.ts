import { computed, shallowRef } from "vue";
import type { LlmChatRequest, LlmStreamEvent } from "@sdk/contract/sdk";
import type { LlmWebCitation, LlmWebSearch } from "../extension-host/widgetCapabilityTransport";

export interface PaletteAiModel {
  id: string;
  label: string;
  credentialType: string;
  note?: string;
  capabilities?: readonly string[];
}

export interface PaletteAnswer {
  phase: "loading" | "streaming" | "done" | "stopped" | "error";
  text: string;
  webSearch?: boolean;
  citations?: LlmWebCitation[];
  error?: string;
  needsSetup?: boolean;
}

export interface PaletteMessage {
  role: "user" | "assistant";
  content: string;
  citations?: LlmWebCitation[];
}

interface PaletteAiModels {
  defaultId: string;
  choices: PaletteAiModel[];
}

interface PaletteAi {
  loadModels(): Promise<PaletteAiModels>;
  stream(request: LlmChatRequest, onEvent: (event: LlmStreamEvent) => void, webSearch?: LlmWebSearch): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

/** One transient conversation; replacing the query invalidates older callbacks. */
export function usePaletteAnswer(ai: PaletteAi) {
  const models = shallowRef<PaletteAiModels>({ defaultId: "", choices: [] });
  const selectedModelId = shallowRef("");
  const model = computed(() => models.value.choices.find((item) => item.id === models.value.defaultId) ?? null);
  const modelChoices = computed(() => models.value.choices);
  const chatModel = computed(() => selectedModelId.value
    ? modelChoices.value.find((item) => item.id === selectedModelId.value) ?? null
    : model.value);
  const answer = shallowRef<PaletteAnswer | null>(null);
  const messages = shallowRef<PaletteMessage[]>([]);
  const busy = computed(() => answer.value?.phase === "loading" || answer.value?.phase === "streaming");
  const webSearchAvailable = computed(() => chatModel.value?.capabilities?.includes("webSearch") ?? false);
  const webSearchEnabled = shallowRef(true);
  const webSearch = computed(() => webSearchEnabled.value && webSearchAvailable.value);
  let modelLoad = 0;
  let active: { id: string; started: boolean; cancelled: boolean } | null = null;

  /** Refresh the icon without letting an older settings read replace a newer one. */
  async function refreshModel() {
    const version = ++modelLoad;
    try {
      const next = await ai.loadModels();
      if (version === modelLoad) models.value = next;
      return next;
    } catch (error) {
      if (version === modelLoad) models.value = { defaultId: "", choices: [] };
      throw error;
    }
  }

  function selectModel(modelId: string | number) {
    if (!answer.value || busy.value) return;
    const selected = modelChoices.value.find((item) => item.id === modelId);
    if (!selected) return;
    selectedModelId.value = selected.id;
  }

  function toggleWebSearch() {
    if (answer.value && !busy.value && webSearchAvailable.value) webSearchEnabled.value = !webSearchEnabled.value;
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
    selectedModelId.value = "";
    webSearchEnabled.value = true;
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
    if (!term || busy.value || !answer.value || !chatModel.value) return;
    const previous: PaletteMessage[] = answer.value.text.trim()
      ? [{ role: "assistant", content: answer.value.text, citations: answer.value.citations }]
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
    answer.value = { phase: "loading", text: "" };
    try {
      const { defaultId, choices } = await refreshModel();
      if (active !== run) return;
      const selected = choices.find((item) => item.id === (selectedModelId.value || defaultId));
      if (!selected) {
        active = null;
        const needsSetup = choices.length === 0;
        answer.value = {
          phase: "error", text: "", needsSetup,
          error: needsSetup
            ? "Choose an AI model in Settings to ask a question."
            : "This model is no longer available. Choose a model to try again.",
        };
        return;
      }
      selectedModelId.value = selected.id;
      const search = webSearchEnabled.value && (selected.capabilities?.includes("webSearch") ?? false);
      answer.value = { phase: "loading", text: "", webSearch: search };
      run.started = true;
      await ai.stream({
        requestId: run.id,
        model: selected.id,
        messages: [
          { role: "system", content: "Answer the user's question concisely in their language. Use plain text and be clear about uncertainty. " + (search
            ? "Search the web for this question and cite the sources you use."
            : "Do not claim to have searched the web or verified current facts.") },
          ...messages.value.map(({ role, content }) => ({ role, content })),
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
      }, search ? {
        onCitations(citations) {
          if (active !== run || !answer.value) return;
          answer.value = { ...answer.value, citations: [...(answer.value.citations ?? []), ...citations] };
        },
      } : undefined);
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

  return { model, modelChoices, chatModel, answer, messages, busy, webSearch, webSearchAvailable, toggleWebSearch, refreshModel, selectModel, ask, followUp, retry, stop, reset };
}
