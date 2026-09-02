import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { TimerIcon } from "@sdk/icons";
import TimerView from "./TimerWidget.vue";

const views: ExtensionViews = {
  timer: { view: TimerView, icon: TimerIcon },
};

export default views;
