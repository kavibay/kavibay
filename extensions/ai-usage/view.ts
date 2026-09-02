// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ChartLineIcon } from "@sdk/icons";
import AiUsageView from "./AiUsageWidget.vue";

const views: ExtensionViews = {
  "ai-usage": { view: AiUsageView, icon: ChartLineIcon },
};

export default views;
