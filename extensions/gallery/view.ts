// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { LayoutPanelTopIcon } from "@sdk/icons";
import GalleryWidget from "./GalleryWidget.vue";

const views: ExtensionViews = {
  gallery: { view: GalleryWidget, icon: LayoutPanelTopIcon },
};

export default views;
