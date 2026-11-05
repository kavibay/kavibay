// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { SnakeIcon } from "@sdk/icons";

const SnakeWidget = defineAsyncComponent(() => import("./SnakeWidget.vue"));

const views: ExtensionViews = {
  snake: { view: SnakeWidget, icon: SnakeIcon },
};

export default views;
