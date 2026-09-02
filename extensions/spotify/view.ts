// SPDX-License-Identifier: MIT
import type { ExtensionViews } from "@sdk/contract/sdk-vue";
import { CirclePlayIcon } from "@sdk/icons";
import PlaylistsWidget from "./widgets/PlaylistsWidget.vue";

const views: ExtensionViews = {
  playlists: { view: PlaylistsWidget, icon: CirclePlayIcon },
};

export default views;
