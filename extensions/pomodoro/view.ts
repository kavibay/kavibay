// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { RotateCwFadingClockIcon } from "@sdk/icons";

const PomodoroView = defineAsyncComponent(() => import("./widgets/PomodoroView.vue"));

const views: ExtensionViews = {
  pomodoro: { view: PomodoroView, icon: RotateCwFadingClockIcon },
};

export default views;
