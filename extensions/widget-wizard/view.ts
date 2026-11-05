// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { SparklesIcon } from "@sdk/icons";

const WidgetWizardWidget = defineAsyncComponent(() => import("./WidgetWizardWidget.vue"));

const views: ExtensionViews = {
  "widget-wizard": { view: WidgetWizardWidget, icon: SparklesIcon },
};

export default views;
