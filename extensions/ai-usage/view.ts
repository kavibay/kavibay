// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ChartLineIcon } from "@sdk/icons";

const AiUsageView = defineAsyncComponent(() => import("./AiUsageWidget.vue"));

const views: ExtensionViews = {
  "ai-usage": { view: AiUsageView, icon: ChartLineIcon },
};

export default views;
