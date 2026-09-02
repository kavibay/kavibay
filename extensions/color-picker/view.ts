// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { PipetteIcon } from "@sdk/icons";
import ColorPickerWidget from "./ColorPickerWidget.vue";

const views: ExtensionViews = {
  "color-picker": { view: ColorPickerWidget, icon: PipetteIcon },
};

export default views;
