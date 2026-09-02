// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { BrainIcon } from "@sdk/icons";
import OnePurposeLlmMenu from "./OnePurposeLlmMenu.vue";
import OnePurposeLlmWidget from "./OnePurposeLlmWidget.vue";

const views: ExtensionViews = {
  "one-purpose-llm": {
    view: OnePurposeLlmWidget,
    icon: BrainIcon,
    menu: OnePurposeLlmMenu,
  },
};

export default views;
