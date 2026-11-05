// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { BrainIcon } from "@sdk/icons";

const OnePurposeLlmMenu = defineAsyncComponent(() => import("./OnePurposeLlmMenu.vue"));
const OnePurposeLlmWidget = defineAsyncComponent(() => import("./OnePurposeLlmWidget.vue"));

const views: ExtensionViews = {
  "one-purpose-llm": {
    view: OnePurposeLlmWidget,
    icon: BrainIcon,
    menu: OnePurposeLlmMenu,
  },
};

export default views;
