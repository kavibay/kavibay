import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ClockIcon } from "@sdk/icons";
import ClockView from "./widgets/ClockView.vue";

/**
 * The Vue half of this extension, keyed by the widget name `extension.ts`
 * contributes. The widget definitions themselves import no SFC on purpose —
 * see `ExtensionViews`.
 */
const views: ExtensionViews = {
  clock: { view: ClockView, icon: ClockIcon },
};

export default views;
