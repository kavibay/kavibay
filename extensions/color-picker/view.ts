// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { PipetteIcon } from "@sdk/icons";

const ColorPickerWidget = defineAsyncComponent(() => import("./ColorPickerWidget.vue"));

const views: ExtensionViews = {
  "color-picker": { view: ColorPickerWidget, icon: PipetteIcon },
};

export default views;
