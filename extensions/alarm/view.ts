// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { AlarmClockIcon } from "@sdk/icons";
import AlarmWidget from "./AlarmWidget.vue";

const views: ExtensionViews = {
  alarm: { view: AlarmWidget, icon: AlarmClockIcon },
};

export default views;
