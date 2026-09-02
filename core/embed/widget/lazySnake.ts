import extension from "../../../extensions/snake/extension";
import views from "../../../extensions/snake/view";
import manifest from "../../../extensions/snake/manifest.json";

/**
 * Snake, behind one dynamic import.
 *
 * 160 KB of source for a game most pages will not show. It declares
 * `openExternal`, which a browser can answer — the capability was never the
 * reason to hold it back; the bundle was.
 */
export default { extension, views, manifest };
