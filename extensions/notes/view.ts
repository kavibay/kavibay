// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { NotebookPenIcon } from "@sdk/icons";

const views: ExtensionViews = {
  notes: {
    view: defineAsyncComponent(() => import("./widgets/NotesView.vue")),
    menu: defineAsyncComponent(() => import("./widgets/NotesMenu.vue")),
    icon: NotebookPenIcon,
  },
};

export default views;
