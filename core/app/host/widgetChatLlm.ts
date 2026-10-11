/**
 * One widget-chat round over Tauri: `llm_chat_stream` with tools, answered by
 * `llm:chunk` text, `llm:turn` (the assistant turn to send back) and
 * `llm:done`. Kept apart from the widget LLM capability on purpose: that
 * surface belongs to first-party widgets and has no tools.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChatMessage, RoundResult, ToolCall, ToolDef } from "../extension-host/widgetChat";

interface Ids {
  instanceId: string;
  requestId: string;
}

export async function streamRound(request: {
  instanceId: string;
  requestId: string;
  model: string;
  history: readonly ChatMessage[];
  tools: ToolDef[];
  toolChoice: "auto" | "none";
  onText: (text: string) => void;
}): Promise<RoundResult> {
  const mine = (payload: Ids) =>
    payload.instanceId === request.instanceId && payload.requestId === request.requestId;
  let text = "";
  let turn: { assistant: unknown; toolCalls: ToolCall[] } | null = null;
  let unlisten: UnlistenFn[] = [];
  try {
    return await new Promise<RoundResult>((resolve, reject) => {
      Promise.all([
        listen<Ids & { text: string }>("llm:chunk", ({ payload }) => {
          if (!mine(payload)) return;
          text += payload.text;
          request.onText(payload.text);
        }),
        listen<Ids & { assistant: unknown; toolCalls: ToolCall[] }>("llm:turn", ({ payload }) => {
          if (mine(payload)) turn = { assistant: payload.assistant, toolCalls: payload.toolCalls };
        }),
        listen<Ids>("llm:done", ({ payload }) => {
          if (!mine(payload)) return;
          if (turn) resolve({ kind: "turn", text, ...turn });
          else reject(new Error("The model finished without a turn."));
        }),
        listen<Ids>("llm:cancelled", ({ payload }) => {
          if (mine(payload)) resolve({ kind: "cancelled" });
        }),
        listen<Ids & { message: string }>("llm:error", ({ payload }) => {
          if (mine(payload)) reject(new Error(payload.message));
        }),
      ])
        .then((listeners) => {
          unlisten = listeners;
          return invoke("llm_chat_stream", {
            instanceId: request.instanceId,
            owner: `widget:${request.instanceId}`,
            requestId: request.requestId,
            model: request.model,
            messages: request.history,
            tools: request.tools,
            toolChoice: request.toolChoice,
          });
        })
        .catch(reject);
    });
  } finally {
    unlisten.forEach((stop) => stop());
  }
}
