// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ClipboardListIcon } from "@sdk/icons";

const SnippetsWidget = defineAsyncComponent(() => import("./SnippetsWidget.vue"));

const views: ExtensionViews = {
  snippets: { view: SnippetsWidget, icon: ClipboardListIcon },
};

export default views;
