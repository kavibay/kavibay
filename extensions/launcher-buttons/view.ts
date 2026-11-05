// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { LayoutGridIcon } from "@sdk/icons";
// Static on purpose: `hugHeight` sizes the card from the first measured
// render, and a lazily mounted view settles at the wrong height.
import AppLauncherWidget from "./AppLauncherWidget.vue";

const views: ExtensionViews = {
  "launcher-buttons": { view: AppLauncherWidget, icon: LayoutGridIcon },
};

export default views;
