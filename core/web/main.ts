/**
 * Browser entry for the real app: the same `core/app/main.ts`, with the Tauri
 * backend answered inside the page (`ipc.ts`, `webCommands.ts`). Nothing under
 * `core/app` knows it runs on a web page — that is what keeps the landing
 * identical to the desktop instead of a lookalike.
 *
 * The page picks what it shows through the query:
 *   ?scene=desk|wizard|playground|hero  which saved desk the app boots into (demoState.ts)
 *   ?play=<demo case>    arm the scripted Wizard tour (webTour.ts)
 *   ?keep                real localStorage, for authoring a scene
 */
import { isDemoCaseId } from "../embed/demo/demoCase";
import { isScene, useScene } from "./demoState";
import { installWebIpc, webEmitSticky } from "./ipc";
import { installMemoryStorage } from "./memoryStorage";
import { installWebTour } from "./webTour";
import { installWebHotkey } from "./webWindow";
import { installWizardPreview } from "./webWizardPreview";
import "./web.css";

const query = new URLSearchParams(location.search);

/**
 * Every visit starts from the demo desk and keeps nothing. `?keep` uses the
 * real localStorage instead — that is how a scene is authored: arrange it on
 * the page, then read the keys back out.
 */
if (!query.has("keep")) installMemoryStorage();

const scene = query.get("scene");
if (isScene(scene)) useScene(scene);

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
installWizardPreview();
installWebHotkey();

const play = query.get("play");
if (isDemoCaseId(play)) installWebTour(play);

// On the desktop the hotkey brings the palette up; on the page it is simply open.
webEmitSticky("palette:show");

await import("../app/main");
