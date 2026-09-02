// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { RotateCwFadingClockIcon } from "@sdk/icons";
import PomodoroView from "./widgets/PomodoroView.vue";

const views: ExtensionViews = {
  pomodoro: { view: PomodoroView, icon: RotateCwFadingClockIcon },
};

export default views;
