// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { SlidersHorizontalIcon } from "@sdk/icons";

const MoodistWidget = defineAsyncComponent(() => import("./MoodistWidget.vue"));

const views: ExtensionViews = {
  moodist: { view: MoodistWidget, icon: SlidersHorizontalIcon },
};

export default views;
