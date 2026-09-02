// SPDX-License-Identifier: MIT
import { extensionIdFromIntroPath } from "./galleryLogic";

const modules = import.meta.glob("/extensions/*/intro.mp4", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** extension id → resolved asset URL */
export const introVideoById: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const id = extensionIdFromIntroPath(path);
  if (id) introVideoById[id] = url;
}
