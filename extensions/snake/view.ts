// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { SnakeIcon } from "@sdk/icons";
import SnakeWidget from "./SnakeWidget.vue";

const views: ExtensionViews = {
  snake: { view: SnakeWidget, icon: SnakeIcon },
};

export default views;
