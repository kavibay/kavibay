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

/** The panel owns this live instance; background cards must not mount a second copy. */
export const inlineWidgetInstanceId = ref<string | null>(null);

/** Ask the palette to take this instance into its panel. */
export function requestInlineWidget(instanceId: string, typeId: string): void {
  inlineWidgetRequest.value = { instanceId, typeId };
}

/**
 * True while a card is being dragged over the palette, which drops it into the
 * panel, or a widget archive is being dragged in from the OS. Lives here so the
 * palette can light up as a drop target — a drag that changes meaning halfway
 * needs to say so before the pointer is released.
 */
export const paletteDropActive = ref(false);

/** Type of the card being dragged over the palette; null for no drag or an OS file drag. */
export const paletteDropTypeId = ref<string | null>(null);

/** The palette's "add as shortcut" slot, shown during a card drag, so the host can hit-test it. */
export const paletteShortcutSlotEl = ref<HTMLElement | null>(null);

/** True while the dragged card is over that slot: releasing adds a shortcut instead of moving the card. */
export const paletteShortcutDropActive = ref(false);
