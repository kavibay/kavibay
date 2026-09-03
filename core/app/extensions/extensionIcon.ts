/**
 * Validate manifest.icon paths used for palette / Widgets list.
 * Same traversal rules as package-relative paths; only .svg / .png.
 */

import { assertSafePackageRelativePath } from "../runtime/manifestValidate";

/** True when `icon` is a safe relative .svg/.png path for an extension folder. */
export function isSafeExtensionIconPath(icon: string): boolean {
  if (typeof icon !== "string" || icon.length === 0) return false;
  if (assertSafePackageRelativePath(icon) !== null) return false;
  return /\.(svg|png)$/i.test(icon);
}
