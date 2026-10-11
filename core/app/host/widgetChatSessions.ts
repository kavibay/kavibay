/**
 * Widget chat state: one conversation per card, in memory only.
 *
 * Module state, not component state: an unpinned card unmounts when the
 * overlay closes, and the answer it is waiting for must not die with it.
 * `forgetWidgetChat` runs from the one dispose path every removal takes.
 */
import { reactive } from "vue";
import { extensionHost, instanceConfig, packageDefinitionId } from "../extension-host/cockpit";
import type { Caller } from "../extension-host/runtime";
import { tauriWidgetCapabilityTransport } from "../extension-host/tauriWidgetCapabilityTransport";
import {
  MAX_RESULT_CHARS, buildTools, describeError, fitForModel, promptConfig, runQuestion, systemPrompt,
  toolName, type ChatMessage, type ChatTools, type SnapshotEntry,
} from "../extension-host/widgetChat";
import type { HostExtensionRef } from "../runtime/runtimeTypes";
import { streamRound } from "./widgetChatLlm";

export interface ChatLine {
  role: "user" | "assistant";
  text: string;
  /** Tool calls made for this answer, shown so the person sees what was read. */
  tools: string[];
}

export interface WidgetChat {
  model: string;
  lines: ChatLine[];
  busy: boolean;
  error: string | null;
}

/** What goes over the wire; frozen prompt and tools, append-only history. */
interface Conversation {
  history: ChatMessage[];
  tools: ChatTools;
}

const chats = reactive(new Map<string, WidgetChat>());
const conversations = new Map<string, Conversation>();
const running = new Map<string, { requestId: string | null; stopped: boolean }>();

/** The definition a card's chat reads, or undefined when the card offers none. */
export function chatDefinition(def: HostExtensionRef): string | undefined {
  if (!def.chat || def.origin !== "runtime" || def.packageFormat !== "contract") return undefined;
  const id = packageDefinitionId(def.id);
  const providers = id ? (extensionHost.registry.widget(id)?.widget.requires?.providers ?? []) : [];
  return providers.length > 0 ? id : undefined;
}

/** The accounts the chat would read, by display name, for the consent sentence. */
export function chatSources(definitionId: string): string[] {
  const providers = extensionHost.registry.widget(definitionId)?.widget.requires?.providers ?? [];
  return providers.map((id) => extensionHost.registry.providers.get(id)?.def.displayName ?? id);
}

/** This card's chat, created on first use. Another model starts over. */
export function widgetChat(instanceId: string, model: string): WidgetChat {
  const current = chats.get(instanceId);
  if (current?.model === model) return current;
  dropWidgetChat(instanceId);
  chats.set(instanceId, { model, lines: [], busy: false, error: null });
  return chats.get(instanceId)!;
}

async function startConversation(
  instanceId: string,
  definitionId: string,
  caller: NonNullable<Caller>,
): Promise<Conversation> {
  const found = extensionHost.registry.widget(definitionId);
  if (!found) throw new Error("This widget is not loaded.");
  const tools = buildTools(
    found.widget.requires?.queries ?? {},
    (id) => extensionHost.registry.providers.get(id)?.def.queries,
  );
  const labelOf = (provider: string, query: string) =>
    [...tools.routes].find(([, route]) => route.provider === provider && route.query === query)?.[0] ??
    toolName(provider, query);
  const snapshot = await Promise.all(
    extensionHost.recentReads(instanceId).map(async (read): Promise<SnapshotEntry> => {
      const tool = labelOf(read.provider, read.query);
      try {
        const result = await extensionHost.query(read.provider, read.query, read.args, caller);
        return { tool, args: read.args, result: fitForModel(result, MAX_RESULT_CHARS) };
      } catch (error) {
        return { tool, args: read.args, error: describeError(error) };
      }
    }),
  );
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const system = systemPrompt({
    widgetName: found.widget.displayName,
    widgetDescription: found.widget.description,
    config: promptConfig(found.widget.configuration, instanceConfig(instanceId)),
    // `sv-SE` formats as `2026-10-11 07:30:12`; minutes are enough.
    now: new Date().toLocaleString("sv-SE", { timeZone }).slice(0, 16),
    timeZone,
    snapshot,
  });
  return { history: [{ role: "system", content: system }], tools };
}

export async function askWidget(instanceId: string, definitionId: string, question: string): Promise<void> {
  const chat = chats.get(instanceId);
  // A second Enter while an answer runs is ignored, not interleaved.
  if (!chat || chat.busy) return;
  chat.busy = true;
  chat.error = null;
  chat.lines.push({ role: "user", text: question, tools: [] });
  chat.lines.push({ role: "assistant", text: "", tools: [] });
  const line = chat.lines[chat.lines.length - 1]!;
  const control = { requestId: null as string | null, stopped: false };
  running.set(instanceId, control);
  const caller = { ...extensionHost.callerFor(definitionId, instanceId), chat: true as const };
  try {
    let conversation = conversations.get(instanceId);
    if (!conversation) {
      conversation = await startConversation(instanceId, definitionId, caller);
      conversations.set(instanceId, conversation);
    }
    conversation.history.push({ role: "user", content: question });
    const tools = conversation.tools;
    const outcome = await runQuestion(conversation.history, tools, {
      round: (history, toolChoice) => {
        control.requestId = crypto.randomUUID();
        if (line.text && !line.text.endsWith("\n")) line.text += "\n\n";
        return streamRound({
          instanceId, requestId: control.requestId, model: chat.model, history,
          tools: tools.tools, toolChoice, onText: (text) => { line.text += text; },
        });
      },
      runTool: (route, input) => extensionHost.query(route.provider, route.query, input, caller),
      onToolStart: (call) => { line.tools.push(`${call.name} ${JSON.stringify(call.input)}`); },
      stopped: () => control.stopped,
    });
    if (outcome === "stopped" && !line.text) line.text = "Stopped.";
  } catch (error) {
    chat.error = describeError(error);
  } finally {
    chat.busy = false;
    running.delete(instanceId);
  }
}

export function stopWidgetChat(instanceId: string): void {
  const control = running.get(instanceId);
  if (!control) return;
  control.stopped = true;
  if (control.requestId) void tauriWidgetCapabilityTransport.llmCancel(control.requestId);
}

/** New conversation: the next question builds a fresh prompt and snapshot. */
export function resetWidgetChat(instanceId: string): void {
  stopWidgetChat(instanceId);
  conversations.delete(instanceId);
  const chat = chats.get(instanceId);
  if (!chat) return;
  chat.lines.splice(0);
  chat.error = null;
}

/** The grant was revoked or the model changed: the conversation ends. */
export function dropWidgetChat(instanceId: string): void {
  stopWidgetChat(instanceId);
  conversations.delete(instanceId);
  chats.delete(instanceId);
}

/** The card was removed: the conversation and its read log go. */
export function forgetWidgetChat(instanceId: string): void {
  dropWidgetChat(instanceId);
  extensionHost.forgetReads(instanceId);
}
