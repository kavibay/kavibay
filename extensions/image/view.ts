// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ImageIcon } from "@sdk/icons";
import ImageWidget from "./ImageWidget.vue";

const views: ExtensionViews = {
  image: { view: ImageWidget, icon: ImageIcon },
};

export default views;
