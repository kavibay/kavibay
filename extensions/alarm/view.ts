// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { AlarmClockIcon } from "@sdk/icons";

const AlarmWidget = defineAsyncComponent(() => import("./AlarmWidget.vue"));

const views: ExtensionViews = {
  alarm: { view: AlarmWidget, icon: AlarmClockIcon },
};

export default views;
