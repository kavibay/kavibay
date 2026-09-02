import { ref } from "vue";

/**
 * A widget asking to be shown in the palette panel instead of on its own card
 * ("Move to main panel" in the card menu), or null when nothing is pending.
 *
 * A shared ref rather than a window event, following `widgetsMenuUi`: host and
 * palette are both core, so the payload can stay typed instead of travelling as
 * a `CustomEvent` detail nobody checks.
 *
 * The palette clears it the moment it takes the request, which is what lets the
 * same widget be moved over again after it has been sent back to the desk.
 */
export interface InlineWidgetRequest {
  instanceId: string;
  typeId: string;
}

export const inlineWidgetRequest = ref<InlineWidgetRequest | null>(null);

/** Ask the palette to take this instance into its panel. */
export function requestInlineWidget(instanceId: string, typeId: string): void {
  inlineWidgetRequest.value = { instanceId, typeId };
}

/**
 * True while a card is being dragged over the palette, which drops it into the
 * panel. Lives here so the palette can light up as a drop target — a drag that
 * changes meaning halfway needs to say so before the pointer is released.
 */
export const paletteDropActive = ref(false);
