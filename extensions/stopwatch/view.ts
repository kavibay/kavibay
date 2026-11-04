import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ClockFadingIcon } from "@sdk/icons";

const StopwatchView = defineAsyncComponent(() => import("./widgets/StopwatchView.vue"));

const views: ExtensionViews = {
  stopwatch: { view: StopwatchView, icon: ClockFadingIcon },
};

export default views;

