// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CloudSunRainIcon } from "@sdk/icons";

const WeatherView = defineAsyncComponent(() => import("./widgets/WeatherWidget.vue"));

const views: ExtensionViews = {
  weather: { view: WeatherView, icon: CloudSunRainIcon },
};

export default views;
