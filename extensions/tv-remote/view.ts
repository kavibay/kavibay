// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { MonitorIcon } from "@sdk/icons";
import TvRemoteView from "./TvRemoteWidget.vue";

const views: ExtensionViews = {
  "tv-remote": { view: TvRemoteView, icon: MonitorIcon },
};

export default views;
