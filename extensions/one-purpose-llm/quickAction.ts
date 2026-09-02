/**
 * The widget's purposes, offered on text selected anywhere (Ctrl+Alt+Q).
 *
 * Headless: no instance, no card, no per-instance settings — so this uses each
 * purpose's *shipped* system prompt, not a prompt edited inside some widget.
 * A quick action that behaved differently depending on which widget happened to
 * be open, and how its prompt was edited weeks ago, would be unpredictable in
 * exactly the moment it is supposed to be quick.
 *
 * The model is the host's, resolved through the reviewed LLM capability rather
 * than from a widget: extensions never import host settings or command names.
 */
import type { TextActionContext, TextActionHandler } from "@sdk/types";
import {
  findPurpose,
  ONE_PURPOSE_PURPOSES,
} from "./onePurposeLlmLogic";

/** Which model quick actions run on, resolved by the host. */
async function resolveModel(ctx: TextActionContext): Promise<string> {
  const model = await ctx.llm?.quickModel<{ selected: string; resolved: string }>();
  if (!model?.resolved) {
    throw new Error("No AI model is set up — add a key in Settings → AI");
  }
  return model.resolved;
}

/**
 * One non-streaming *paste*: collect the chunks, resolve on `llm:done`.
 *
 * Tokens are forwarded through `onChunk` so the popup can render them as they
 * arrive. The selection is still only replaced with the finished text — a
 * partial one must never be pasted.
 */
async function runPrompt(
  systemPrompt: string,
  ctx: TextActionContext,
): Promise<string> {
  if (!ctx.llm) throw new Error("LLM capability unavailable");
  const llm = ctx.llm;
  const model = await resolveModel(ctx);
  const requestId = crypto.randomUUID();

  return new Promise<string>((resolve, reject) => {
    let collected = "";
    let settled = false;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      void llm.cancel(requestId).catch(() => undefined);
      ctx.signal.removeEventListener("abort", onAbort);
      reject(new Error("Cancelled"));
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      ctx.signal.removeEventListener("abort", onAbort);
      settle();
    };

    void llm
      .stream(
        {
          requestId,
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: ctx.text },
          ],
        },
        (event) => {
          if (event.type === "chunk") {
            collected += event.text;
            ctx.onChunk?.(event.text);
          } else if (event.type === "done") {
            finish(() => resolve(collected));
          } else if (event.type === "cancelled") {
            finish(() => reject(new Error("Cancelled")));
          } else {
            finish(() => reject(new Error(event.message || "The request failed")));
          }
        },
      )
      .catch((error) => finish(() => reject(new Error(String(error)))));
  });
}

/** One handler per purpose, built from the same list the widget renders. */
export const quickActionHandlers: Record<string, TextActionHandler> =
  Object.fromEntries(
    ONE_PURPOSE_PURPOSES.map((purpose) => [
      purpose.id,
      (ctx: TextActionContext) =>
        runPrompt(findPurpose(purpose.id).systemPrompt, ctx),
    ]),
  );
