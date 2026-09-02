// SPDX-License-Identifier: MIT
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";

export interface GalleryModel {
  readonly instanceId: string;
}

export const galleryWidget = defineWidget({
  name: "gallery",
  displayName: "Widget Gallery",
  description: "Browse widgets with video previews and add them to your desk.",
  defaultSize: { w: 8, h: 5 },
  minSize: { w: 4, h: 3 },
  mode: "expanded",
  component: {
    setup(ctx: WidgetContext): GalleryModel {
      return { instanceId: ctx.instanceId };
    },
  },
});
