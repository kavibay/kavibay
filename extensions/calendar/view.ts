// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CalendarDaysIcon } from "@sdk/icons";
import CalendarWidget from "./widgets/CalendarWidget.vue";
import CalendarMenu from "./CalendarMenu.vue";

const views: ExtensionViews = {
  calendar: { view: CalendarWidget, icon: CalendarDaysIcon, menu: CalendarMenu },
};

export default views;
