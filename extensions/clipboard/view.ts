// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ClipboardListIcon } from "@sdk/icons";

const ClipboardWidget = defineAsyncComponent(() => import("./ClipboardWidget.vue"));

const views: ExtensionViews = {
  clipboard: { view: ClipboardWidget, icon: ClipboardListIcon },
};

export default views;
