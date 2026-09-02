// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { SparklesIcon } from "@sdk/icons";
import WidgetWizardWidget from "./WidgetWizardWidget.vue";

const views: ExtensionViews = {
  "widget-wizard": { view: WidgetWizardWidget, icon: SparklesIcon },
};

export default views;
