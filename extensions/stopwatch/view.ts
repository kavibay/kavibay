import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ClockFadingIcon } from "@sdk/icons";
import StopwatchView from "./widgets/StopwatchView.vue";

const views: ExtensionViews = {
  stopwatch: { view: StopwatchView, icon: ClockFadingIcon },
};

export default views;

