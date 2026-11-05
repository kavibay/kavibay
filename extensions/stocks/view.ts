// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ChartLineIcon } from "@sdk/icons";

const StocksWidget = defineAsyncComponent(() => import("./StocksWidget.vue"));

const views: ExtensionViews = {
  stocks: { view: StocksWidget, icon: ChartLineIcon },
};

export default views;
