// SPDX-License-Identifier: MIT
import { defineWidget, type WizardCapability, type WidgetContext } from "@sdk/contract/sdk";
import { useWizardConversations } from "../useWizardConversations";
import { formatWizardTranscript } from "../widgetWizardLogic";

export interface WidgetWizardModel {
  wizard: WizardCapability;
  conversations: ReturnType<typeof useWizardConversations>;
  copyTranscript(): Promise<void>;
  /**
   * The instance's own store, for chrome the person arranges.
   *
   * Column widths are not conversation state — they belong to this copy of the
   * Wizard on this desk, and `ctx.data` is where a widget keeps what is its
   * own (CLAUDE.md: widget persistence is `ctx.data`).
   */
  data: WidgetContext<Record<string, never>>["data"];
  /**
   * Extension-scoped store, for what belongs to the *workspace*.
   *
   * The order of the project list is not this card's chrome the way its column
   * widths are: a person arranges their projects once, and a second Wizard on
   * another desk showing a different order would be two answers to a question
   * with one. `ctx.sharedData` is scoped to the extension rather than the
   * instance, which is exactly that distinction.
   */
  shared?: WidgetContext<Record<string, never>>["sharedData"];
  /** This card, so the view can tell its own focus events from other cards'. */
  instanceId: string;
}

/** The catalog id this widget answers to; `replaces` in manifest.json. */
const WIZARD_TYPE_ID = "widget-wizard";

/**
 * How long a request stays good after the palette makes one.
 *
 * The request is handed to the host and comes back through a focus event. If
 * that never arrives — the widget is disabled, the desk refuses the card — the
 * flag must not sit there and turn somebody's next deliberate open into a new
 * project instead of the one they wanted.
 */
const REQUEST_TTL_MS = 5000;

let requestedAt = 0;

/** Consumed by the view when the host hands it the focus this request asked for. */
export function takeNewProjectRequest(now = Date.now()): boolean {
  const fresh = requestedAt > 0 && now - requestedAt < REQUEST_TTL_MS;
  requestedAt = 0;
  return fresh;
}

/**
 * Palette action: open the Wizard on a new project.
 *
 * Declared `needsInstance: false`, which is what gives it a row of its own. A
 * widget action with an instance looks like the right thing and is not
 * reachable: the palette runs a *type* row by opening the widget, and the
 * action attached to it only feeds that row's keywords — so the handler would
 * never run and the Wizard would open exactly as it always does.
 *
 * Opening the card is therefore this handler's job, and it delegates it: the
 * host reveals a hidden card, focuses a visible one, or makes a new one, then
 * dispatches its focus event at that instance. The request is left where that
 * instance will pick it up, so it lands on the card the host chose rather than
 * on whichever one this code guessed at.
 */
export async function runNewWidgetAction(): Promise<void> {
  requestedAt = Date.now();
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("kavibay:run-runtime-widget", { detail: { typeId: WIZARD_TYPE_ID } }),
  );
}

export const widgetWizardWidget = defineWidget<Record<string, never>>({
  name: "widget-wizard",
  displayName: "Widget Wizard",
  description: "Describe a widget in plain language and watch it get built.",
  defaultSize: { w: 8, h: 6 },
  minSize: { w: 5, h: 4 },
  mode: "expanded",
  capabilities: { wizard: true, clipboard: true },
  actions: { "new-widget": runNewWidgetAction },
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>): Promise<WidgetWizardModel> {
      if (!ctx.wizard) throw new Error("Widget Wizard capability unavailable");
      const conversations = useWizardConversations(ctx.wizard, ctx.data);
      await conversations.hydrate();
      return {
        wizard: ctx.wizard,
        conversations,
        /** Copy the active conversation through the host's clipboard capability. */
        async copyTranscript() {
          if (!ctx.clipboard) throw new Error("Clipboard capability unavailable");
          const text = formatWizardTranscript(conversations.active.value.bubbles);
          if (text) await ctx.clipboard.writeText(text);
        },
        data: ctx.data,
        shared: ctx.sharedData,
        instanceId: ctx.instanceId,
      };
    },
  },
});
