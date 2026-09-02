import { ref } from "vue";

/**
 * True while any Color Picker instance is in Pick mode.
 * Host hides the fullscreen dismiss-catcher so click-through / over-UI
 * checks see real widget rects instead of a viewport-sized catcher.
 */
export const colorPickerPicking = ref(false);
