// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CirclePlayIcon } from "@sdk/icons";
import NowPlayingView from "./NowPlayingWidget.vue";

const views: ExtensionViews = {
  "now-playing": { view: NowPlayingView, icon: CirclePlayIcon },
};

export default views;
