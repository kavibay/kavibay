// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { LayoutPanelTopIcon } from "@sdk/icons";

const GalleryWidget = defineAsyncComponent(() => import("./GalleryWidget.vue"));

const views: ExtensionViews = {
  gallery: { view: GalleryWidget, icon: LayoutPanelTopIcon },
};

export default views;
