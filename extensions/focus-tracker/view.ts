// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ListIcon } from "@sdk/icons";
import FocusTrackerSettings from "./FocusTrackerSettings.vue";
import FocusTrackerWidget from "./FocusTrackerWidget.vue";

const views: ExtensionViews = {
  "focus-tracker": {
    view: FocusTrackerWidget,
    icon: ListIcon,
    settings: FocusTrackerSettings,
  },
};

export default views;
