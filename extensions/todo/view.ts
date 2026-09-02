// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { ListTodoIcon } from "@sdk/icons";
import TodoMenu from "./widgets/TodoMenu.vue";
import TodoView from "./widgets/TodoView.vue";

const views: ExtensionViews = {
  todo: { view: TodoView, icon: ListTodoIcon, menu: TodoMenu },
};

export default views;
