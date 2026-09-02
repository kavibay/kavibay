// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ClipboardListIcon } from "@sdk/icons";
import SnippetsWidget from "./SnippetsWidget.vue";

const views: ExtensionViews = {
  snippets: { view: SnippetsWidget, icon: ClipboardListIcon },
};

export default views;
