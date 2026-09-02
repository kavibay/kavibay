// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ChartLineIcon } from "@sdk/icons";
import StocksWidget from "./StocksWidget.vue";

const views: ExtensionViews = {
  stocks: { view: StocksWidget, icon: ChartLineIcon },
};

export default views;
