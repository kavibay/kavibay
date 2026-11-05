// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CalendarDaysIcon } from "@sdk/icons";

const CalendarWidget = defineAsyncComponent(() => import("./widgets/CalendarWidget.vue"));
const CalendarMenu = defineAsyncComponent(() => import("./CalendarMenu.vue"));

const views: ExtensionViews = {
  calendar: { view: CalendarWidget, icon: CalendarDaysIcon, menu: CalendarMenu },
};

export default views;
