// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ListTodoIcon } from "@sdk/icons";

const TodoMenu = defineAsyncComponent(() => import("./widgets/TodoMenu.vue"));
const TodoView = defineAsyncComponent(() => import("./widgets/TodoView.vue"));

const views: ExtensionViews = {
  todo: { view: TodoView, icon: ListTodoIcon, menu: TodoMenu },
};

export default views;
