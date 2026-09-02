// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { WormIcon } from "@sdk/icons";
import SnakeWidget from "./SnakeWidget.vue";

const views: ExtensionViews = {
  snake: { view: SnakeWidget, icon: WormIcon },
};

export default views;
