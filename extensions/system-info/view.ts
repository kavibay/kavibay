// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CpuIcon } from "@sdk/icons";

const SystemInfoView = defineAsyncComponent(() => import("./SystemInfoWidget.vue"));

const views: ExtensionViews = {
  "system-info": { view: SystemInfoView, icon: CpuIcon },
};

export default views;
