import extension from "../../../extensions/emoji-picker/extension";
import views from "../../../extensions/emoji-picker/view";
import manifest from "../../../extensions/emoji-picker/manifest.json";

/**
 * The Emoji Picker, behind one dynamic import.
 *
 * It needs no capability and no network, so it belongs in the browser — but it
 * carries the emoji table, which is 300 KB of source and by far the largest
 * thing in the eager set. Weight decides eager or lazy, never in or out.
 */
export default { extension, views, manifest };
