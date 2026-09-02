// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CpuIcon } from "@sdk/icons";
import SystemInfoView from "./SystemInfoWidget.vue";

const views: ExtensionViews = {
  "system-info": { view: SystemInfoView, icon: CpuIcon },
};

export default views;
