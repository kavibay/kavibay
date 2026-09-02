import extension from "../../../extensions/gallery/extension";
import views from "../../../extensions/gallery/view";
import manifest from "../../../extensions/gallery/manifest.json";

/**
 * The Widget Gallery, behind one dynamic import.
 *
 * Two reasons, and the second is the surprising one. It is 720x480 and opens
 * on demand rather than sitting on a desk — but it also globs every
 * `manifest.json` to list the catalog, and each extension's `intro.mp4` with
 * it. Eagerly imported it put roughly a megabyte of video into the build's
 * asset set and every manifest into the entry.
 *
 * None of that is wrong for a gallery. It just belongs to the page that shows
 * one.
 */
export default { extension, views, manifest };
