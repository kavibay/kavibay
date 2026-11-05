// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ListIcon } from "@sdk/icons";

const FocusTrackerSettings = defineAsyncComponent(() => import("./FocusTrackerSettings.vue"));
const FocusTrackerWidget = defineAsyncComponent(() => import("./FocusTrackerWidget.vue"));

const views: ExtensionViews = {
  "focus-tracker": {
    view: FocusTrackerWidget,
    icon: ListIcon,
    settings: FocusTrackerSettings,
  },
};

export default views;
