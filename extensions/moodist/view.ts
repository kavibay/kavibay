// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { SlidersHorizontalIcon } from "@sdk/icons";
import MoodistWidget from "./MoodistWidget.vue";

const views: ExtensionViews = {
  moodist: { view: MoodistWidget, icon: SlidersHorizontalIcon },
};

export default views;
