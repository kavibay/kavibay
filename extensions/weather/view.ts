// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CloudSunRainIcon } from "@sdk/icons";
import WeatherView from "./widgets/WeatherWidget.vue";

const views: ExtensionViews = {
  weather: { view: WeatherView, icon: CloudSunRainIcon },
};

export default views;
