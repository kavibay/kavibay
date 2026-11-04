// SPDX-License-Identifier: MIT
import { defineAsyncComponent } from "vue";
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CirclePlayIcon } from "@sdk/icons";

const PlaylistsWidget = defineAsyncComponent(() => import("./widgets/PlaylistsWidget.vue"));

const views: ExtensionViews = {
  playlists: { view: PlaylistsWidget, icon: CirclePlayIcon },
};

export default views;
