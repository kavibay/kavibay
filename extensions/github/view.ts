// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { GitBranchIcon } from "@sdk/icons";

const GithubActionsWidget = defineAsyncComponent(() => import("./widgets/GithubActionsWidget.vue"));

const views: ExtensionViews = {
  "github-actions": { view: GithubActionsWidget, icon: GitBranchIcon },
};

export default views;
