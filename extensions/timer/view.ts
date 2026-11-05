import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { TimerIcon } from "@sdk/icons";

const TimerView = defineAsyncComponent(() => import("./TimerWidget.vue"));

const views: ExtensionViews = {
  timer: { view: TimerView, icon: TimerIcon },
};

export default views;
