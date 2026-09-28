import type { WizardPreviewElement } from "@sdk/wizardPreview";

export type PreviewPick = { type: "selected"; element: WizardPreviewElement } | { type: "cancelled" };

/** Opaque origins cannot identify frames; only the host's window reference can. */
export function readPreviewPick(
  event: { source: unknown; data: unknown },
  frameWindow: unknown,
  activeToken: string | null,
): PreviewPick | null {
  if (!frameWindow || event.source !== frameWindow || !activeToken) return null;
  const data = event.data;
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.token !== activeToken) return null;
  if (message.type === "kavibay.preview.cancelled") return { type: "cancelled" };
  if (message.type !== "kavibay.preview.selected") return null;
  const value = message.element;
  if (!value || typeof value !== "object") return null;
  const element = value as Record<string, unknown>;
  if (typeof element.selector !== "string" || !element.selector.trim() || element.selector.length > 512
    || typeof element.tag !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(element.tag)
    || typeof element.text !== "string" || element.text.length > 200) return null;
  return {
    type: "selected",
    element: { selector: element.selector, tag: element.tag, text: element.text },
  };
}
