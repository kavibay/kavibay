/**
 * One character of a scripted prompt, or a provider the demo picks from the
 * Wizard's own Integrations menu.
 *
 * A mention is not typed as `@Linear` text. The composer turns that into a
 * chip only after the menu commits, and the transcript renderer looks for the
 * display name (`@Linear`), which is a different string from `@linear`. Typing
 * the letters and pressing Send would show the words, not the logos.
 *
 * `query` is what to type after the @ when the name is not good to type —
 * "Weather (Open-Meteo)" is found by "weather"; it defaults to the name.
 */
export type DemoPromptPart = string | { mention: string; query?: string };

export function isMentionPart(part: DemoPromptPart): part is { mention: string; query?: string } {
  return typeof part === "object" && part !== null && "mention" in part;
}

export interface WizardDemoScript {
  /** The landing button's `data-case`. */
  id: string;
  /** Folder the Wizard writes; the desk card's `draft`. */
  draftId: string;
  /** Palette row that opens the finished card. */
  resultRow: string;
  /** What the tour types to find that row. */
  resultQuery: string;
  /** Milestones the transport names, in order. */
  steps: readonly string[];
  prompts: DemoPromptPart[][];
  replies: string[];
  /** Unique substring of the finished widget.js, which the tour waits for. */
  finalMarker: string;
}
