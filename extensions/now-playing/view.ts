// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CirclePlayIcon } from "@sdk/icons";

const NowPlayingView = defineAsyncComponent(() => import("./NowPlayingWidget.vue"));

const views: ExtensionViews = {
  "now-playing": { view: NowPlayingView, icon: CirclePlayIcon },
};

export default views;
