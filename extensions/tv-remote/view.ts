// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { MonitorIcon } from "@sdk/icons";

const TvRemoteView = defineAsyncComponent(() => import("./TvRemoteWidget.vue"));

const views: ExtensionViews = {
  "tv-remote": { view: TvRemoteView, icon: MonitorIcon },
};

export default views;
