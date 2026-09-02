// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ClipboardClockIcon } from "@sdk/icons";

const views: ExtensionViews = {
  "time-tracker": {
    view: defineAsyncComponent(() => import("./TimeTrackerWidget.vue")),
    icon: ClipboardClockIcon,
  },
};

export default views;
