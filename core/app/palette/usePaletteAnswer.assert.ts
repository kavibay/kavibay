import type { LlmChatRequest, LlmStreamEvent } from "@sdk/contract/sdk";
import { usePaletteAnswer, type PaletteAiModel } from "./usePaletteAnswer";

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const selected = { id: "test-model", label: "Test model", credentialType: "openaiApi" };
let load: () => Promise<PaletteAiModel | null> = async () => selected;
let submit: () => Promise<void> = async () => {};
const requests: Array<{ request: LlmChatRequest; emit: (event: LlmStreamEvent) => void }> = [];
const cancelled: string[] = [];
const palette = usePaletteAnswer({
  loadModel: () => load(),
  stream: async (request, emit) => { requests.push({ request, emit }); await submit(); },
  cancel: async (id) => { cancelled.push(id); },
});

await palette.refreshModel();
equal(palette.model.value?.credentialType, "openaiApi", "icon follows configured provider");
equal(requests.length, 0, "model discovery does not send a question");
await palette.ask("  What is a widget?  ");
equal(requests[0].request.model, selected.id, "uses the resolved model");
equal(requests[0].request.messages[1].content, "What is a widget?", "sends the complete trimmed query");
requests[0].emit({ type: "chunk", text: "A small " });
requests[0].emit({ type: "chunk", text: "tool." });
equal(palette.answer.value?.text, "A small tool.", "renders chunks as they arrive");
await palette.ask("Repeated Enter");
equal(requests.length, 1, "does not start duplicate paid requests while busy");
requests[0].emit({ type: "done" });
equal(palette.busy.value, false, "done clears busy state");
requests[0].emit({ type: "error", message: "late error" });
equal(palette.answer.value?.phase, "done", "completed request cannot be replaced by a late event");

await palette.ask("Next query");
requests[1].emit({ type: "chunk", text: "Partial answer" });
palette.stop();
equal(cancelled.includes(requests[1].request.requestId), true, "Stop cancels the backend request");
equal(palette.answer.value?.text, "Partial answer", "Stop preserves readable output");
equal(palette.answer.value?.phase, "stopped", "Stop has an explicit state");
palette.reset();
await palette.ask("A different query");
requests[1].emit({ type: "chunk", text: "stale output" });
equal(palette.answer.value?.text, "", "old chunks cannot contaminate the new answer");
requests[2].emit({ type: "error", message: "Provider unavailable" });
equal(palette.answer.value?.error, "Provider unavailable", "provider failures are visible");

const loading = deferred<PaletteAiModel | null>();
load = () => loading.promise;
const waiting = palette.ask("Cleared before model discovery finishes");
palette.reset();
loading.resolve(selected);
await waiting;
equal(requests.length, 3, "editing while loading prevents submission entirely");
equal(palette.answer.value, null, "late model discovery cannot reopen the answer");

load = async () => null;
await palette.ask("No provider configured");
equal(palette.answer.value?.needsSetup, true, "offers settings when no model is configured");
equal(requests.length, 3, "missing configuration never invokes chat");
load = async () => { throw new Error("Settings could not be loaded"); };
await palette.ask("Model lookup failed");
equal(palette.answer.value?.error, "Settings could not be loaded", "model lookup errors are visible");

load = async () => selected;
const submitting = deferred<void>();
submit = () => submitting.promise;
const starting = palette.ask("First request still setting up listeners");
await Promise.resolve();
await Promise.resolve();
const pendingId = requests[requests.length - 1].request.requestId;
palette.reset();
submit = async () => {};
await palette.ask("Replacement request");
submitting.resolve();
await starting;
equal(cancelled[cancelled.length - 1], pendingId, "late submission is cancelled even after a replacement starts");
requests[requests.length - 1].emit({ type: "done" });
equal(palette.answer.value?.phase, "error", "an empty provider reply offers retry instead of a blank panel");

const oldModel = deferred<PaletteAiModel | null>();
load = () => oldModel.promise;
const oldRefresh = palette.refreshModel();
load = async () => ({ ...selected, id: "new", credentialType: "anthropicApi" });
await palette.refreshModel();
oldModel.resolve(selected);
await oldRefresh;
equal(palette.model.value?.credentialType, "anthropicApi", "slow reads cannot restore an old provider logo");

const chatRequests: typeof requests = [];
const chat = usePaletteAnswer({
  loadModel: async () => selected,
  stream: async (request, emit) => { chatRequests.push({ request, emit }); },
  cancel: async () => {},
});
await chat.ask("Tell me about Berlin");
chatRequests[0].emit({ type: "chunk", text: "Berlin is Germany's capital." });
chatRequests[0].emit({ type: "done" });
await chat.followUp("  And Potsdam?  ");
equal(JSON.stringify(chatRequests[1].request.messages.slice(1)), JSON.stringify([
  { role: "user", content: "Tell me about Berlin" },
  { role: "assistant", content: "Berlin is Germany's capital." },
  { role: "user", content: "And Potsdam?" },
]), "follow-up includes both sides of the conversation in order");
equal(chat.messages.value.length, 3, "previous turns stay visible while the next answer streams");
await chat.followUp("Repeated Enter");
equal(chatRequests.length, 2, "follow-ups cannot overlap active requests");
chatRequests[1].emit({ type: "chunk", text: "An incomplete reply" });
chatRequests[1].emit({ type: "error", message: "Connection interrupted" });
await chat.retry();
equal(JSON.stringify(chatRequests[2].request.messages), JSON.stringify(chatRequests[1].request.messages),
  "retry resends the failed follow-up with its original context and no duplicate question");
equal(chat.answer.value?.text, "", "retry replaces the incomplete answer");
chatRequests[1].emit({ type: "chunk", text: "Late failed output" });
equal(chat.answer.value?.text, "", "the failed request cannot alter its replacement");
chatRequests[2].emit({ type: "chunk", text: "Potsdam is nearby." });
chat.stop();
await chat.followUp("How far?");
equal(chatRequests[3].request.messages[4].content, "Potsdam is nearby.",
  "a stopped partial answer remains available as conversation context");
equal(chatRequests[3].request.messages[5].content, "How far?", "a third turn extends the conversation");
chatRequests[3].emit({ type: "done" });
await chat.followUp("   ");
equal(chatRequests.length, 4, "blank follow-ups are ignored");
chat.reset();
equal(chat.messages.value.length, 0, "closing the conversation clears history");
await chat.ask("Unrelated search");
equal(chatRequests[4].request.messages.length, 2, "a new search never sends old conversation history");
chatRequests[3].emit({ type: "chunk", text: "Late old conversation" });
equal(chat.answer.value?.text, "", "old conversations cannot reopen after reset");

console.log("usePaletteAnswer.assert: ok");
