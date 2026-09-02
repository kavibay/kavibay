// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ClipboardListIcon } from "@sdk/icons";
import ClipboardWidget from "./ClipboardWidget.vue";

const views: ExtensionViews = {
  clipboard: { view: ClipboardWidget, icon: ClipboardListIcon },
};

export default views;
