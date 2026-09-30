/**
 * Browser entry for the real app: the same `core/app/main.ts`, with the Tauri
 * backend answered inside the page (`ipc.ts`, `webCommands.ts`). Nothing under
 * `core/app` knows it runs on a web page — that is what keeps the landing
 * identical to the desktop instead of a lookalike.
 */
import { installWebIpc, webEmitSticky } from "./ipc";
import { installMemoryStorage } from "./memoryStorage";
import { installWebHotkey } from "./webWindow";

/**
 * Every visit starts from the demo desk (`demoState.ts`) and keeps nothing.
 * `?keep` uses the real localStorage instead — that is how the demo desk is
 * authored: arrange it on the page, then read the keys back out.
 */
if (!new URLSearchParams(location.search).has("keep")) installMemoryStorage();

/**
 * The app sits in an iframe partway down a long page. Its own `focus()` calls
 * (the palette focuses its search field when it opens) would otherwise scroll
 * the landing page to wherever the iframe is.
 */
const nativeFocus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function focus(options?: FocusOptions) {
  nativeFocus.call(this, { ...options, preventScroll: true });
};

installWebIpc();
installWebHotkey();

// On the desktop the hotkey brings the palette up; on the page it is simply open.
webEmitSticky("palette:show");

await import("../app/main");
