// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { LayoutGridIcon } from "@sdk/icons";
import AppLauncherWidget from "./AppLauncherWidget.vue";

const views: ExtensionViews = {
  "launcher-buttons": { view: AppLauncherWidget, icon: LayoutGridIcon },
};

export default views;
