/** One model-authored next step: a short chip and the editable request it inserts. */
export interface WizardSuggestion {
  label: string;
  prompt: string;
}

/** Ignore malformed metadata without rejecting an otherwise usable widget. */
export function readWizardSuggestions(value: unknown): WizardSuggestion[] {
  if (!Array.isArray(value)) return [];
  const result: WizardSuggestion[] = [];
  const labels = new Set<string>();
  const prompts = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.label !== "string" || typeof item.prompt !== "string") continue;
    const label = item.label.trim().replace(/\s+/g, " ");
    const prompt = item.prompt.trim().replace(/\s+/g, " ");
    if (!label || label.length > 48 || !prompt || prompt.length > 300) continue;
    const labelKey = label.toLocaleLowerCase();
    const promptKey = prompt.toLocaleLowerCase();
    if (labels.has(labelKey) || prompts.has(promptKey)) continue;
    labels.add(labelKey);
    prompts.add(promptKey);
    result.push({ label, prompt });
    if (result.length === 3) break;
  }
  return result;
}

/** Metadata is optional; JSON errors must not trigger another paid model turn. */
export function parseWizardSuggestions(text: string): WizardSuggestion[] {
  try {
    return readWizardSuggestions(JSON.parse(text));
  } catch {
    return [];
  }
}

/** Never revive an older turn's suggestions after a failed or cancelled request. */
export function currentWizardSuggestions(
  bubbles: readonly { role: string; version?: string; suggestions?: unknown }[],
  currentVersion: string | undefined,
): WizardSuggestion[] {
  if (!currentVersion) return [];
  for (let at = bubbles.length - 1; at >= 0; at -= 1) {
    const bubble = bubbles[at];
    if (bubble.role === "system") continue;
    return bubble.role === "assistant" && bubble.version === currentVersion
      ? readWizardSuggestions(bubble.suggestions)
      : [];
  }
  return [];
}

/** Keep unsent work, and make clicking the same chip twice harmless. */
export function appendWizardSuggestion(draft: string, prompt: string): string {
  if (!draft.trim()) return prompt;
  if (draft.split("\n").some((line) => line.trim() === prompt)) return draft;
  return `${draft}${draft.endsWith("\n") ? "" : "\n"}${prompt}`;
}
