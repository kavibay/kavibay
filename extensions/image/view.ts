// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ImageIcon } from "@sdk/icons";

const ImageWidget = defineAsyncComponent(() => import("./ImageWidget.vue"));

const views: ExtensionViews = {
  image: { view: ImageWidget, icon: ImageIcon },
};

export default views;
