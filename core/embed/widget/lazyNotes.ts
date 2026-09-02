import extension from "../../../extensions/notes/extension";
import views from "../../../extensions/notes/view";
import manifest from "../../../extensions/notes/manifest.json";

/**
 * Notes, behind one dynamic import.
 *
 * It declares no capability and no provider, so by the catalog's admission
 * rule it belongs in the browser — the only thing keeping it out was weight:
 * its editor is Tiptap and ProseMirror, about 440 KB of source, which is more
 * than everything else in the base bundle put together.
 *
 * That was a reason to split it, not to leave it out. A page that shows Notes
 * fetches this chunk; a page that does not never hears of it.
 */
export default { extension, views, manifest };
