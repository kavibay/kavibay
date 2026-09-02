// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { GitBranchIcon } from "@sdk/icons";
import GithubActionsWidget from "./widgets/GithubActionsWidget.vue";

const views: ExtensionViews = {
  "github-actions": { view: GithubActionsWidget, icon: GitBranchIcon },
};

export default views;
