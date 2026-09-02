import { ref } from "vue";

/**
 * Shared cockpit session flag (double tap on Ctrl opens it).
 * Module-level so overlay-slot UI (onboarding coach) does not rely on provide/inject.
 */
export const kavibayCockpitOpen = ref(false);
