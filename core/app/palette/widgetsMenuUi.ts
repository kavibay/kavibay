import { ref } from "vue";

/**
 * True while the status-bar Widgets menu is open.
 * WidgetHost uses this to keep the fullscreen dismiss catcher hittable
 * (click-through off) even in pinned-only mode.
 */
export const widgetsMenuOpen = ref(false);
