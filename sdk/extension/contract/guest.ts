// SPDX-License-Identifier: MIT
import type { ProviderError, WidgetContext, WidgetInstance } from "./sdk";
import {
  SandboxGuestPort, applyTheme, failedMessage, faultMessage, installFaultReporting, installLinkOpening,
  mountedMessage, readInit, readThemeMessage, readyMessage, type LinkOpeningTarget,
} from "./sandbox-guest";

/**
 * The contract guest, for a widget that ships as a package rather than in the
 * app bundle.
 *
 * `sdk/runtime/kavibay-runtime.js` is the same idea for runtime packages, and
 * the reason it is served by the host rather than copied into each package
 * applies here twice over: a second, hand-maintained copy of a wire protocol
 * cannot stay in sync with the first. So this is built from the same TypeScript
 * the in-app guest uses — one `sandboxContext`, one set of message shapes — and
 * emitted as a classic script.
 *
 * Classic, not a module, and that is not a style choice: an opaque origin makes
 * every `type="module"` fetch cross-origin, so a module guest does not load at
 * all inside `sandbox="allow-scripts"`. Finding 17.
 *
 * NO VUE, and nothing from the app. A package supplies its own `render`,
 * because the in-app path maps a definition id to a Vue component through
 * `widgetViews.ts` and a generated widget cannot be in that map. Rendering to
 * the DOM is also the only thing that works under `script-src 'self'` — there
 * is no compiler in here.
 */

/** What a package registers. `setup` is the contract's; `render` is its own. */
export interface GuestWidget<TConfig = Record<string, unknown>, TModel = unknown> {
  setup(ctx: WidgetContext<TConfig>): Promise<TModel> | TModel;
  /**
   * Called once, after setup resolves, with the element to fill.
   *
   * Once — not on every change. The model a widget returns owns its own
   * updating, exactly as it does in-app, and a render called repeatedly would
   * invite a package to rebuild its DOM on every tick.
   */
  render(model: TModel, root: HTMLElement): void;
}

declare global {
  interface Window {
    kavibayWidget: {
      define<TConfig, TModel>(widget: GuestWidget<TConfig, TModel>): void;
    };
  }
}

/**
 * Makes the document canvas actually composite through, whatever the package
 * wrote.
 *
 * A widget is content inside a card the host draws, and the card owns the
 * background — that rule is in DESIGN.md and models follow it: they write
 * `body { background: transparent }`. It is not enough. The house style is
 * dark, so they also write `:root { color-scheme: dark }`, and per CSS Color
 * Adjust the canvas then takes the scheme's own colour **whenever the root's
 * background is transparent**. Every widget lands on the desk as a black
 * rectangle.
 *
 * Both instructions are correct. The trap is that they are correct together
 * and produce the opposite of what either intends, which is not something a
 * prompt can be written out of — so the host settles it.
 *
 * THIS IS THE TWIN OF `forceTransparentCanvas` IN `sdk/runtime/kavibay-runtime.js`
 * AND THE TWO MUST NOT DRIFT. Forcing `background: transparent` on the root is
 * the one value that hands the canvas over — it *is* the condition. A
 * nearly-zero alpha does not dodge it either: Chromium quantises alpha to 8
 * bits at computed-value time, so `rgba(0,0,0,0.00004)` computes to
 * `rgba(0, 0, 0, 0)`, the same value as `transparent`. Both were tried here and
 * both left every widget black.
 *
 * So this does not satisfy the rule cleverly, it removes it: `color-scheme:
 * normal` on the root means there is no scheme colour to substitute. The two
 * things `color-scheme: dark` was wanted for are put back where they change
 * rendering rather than the canvas — `scrollbar-color`, and the dark scheme on
 * form controls. The non-zero root alpha stays as a second, independent line of
 * defence; at 1/255 over the card behind it, nobody can see it.
 */
function forceTransparentCanvas() {
  const style = document.createElement("style");
  style.textContent =
    ":root{color-scheme:normal !important;" +
    "background-color:rgba(0,0,0,0.004) !important;" +
    "scrollbar-color:rgba(232,232,234,0.32) transparent;}" +
    "body{background:transparent !important;}" +
    "input,textarea,select,button,progress,meter{color-scheme:dark;}";
  (document.head ?? document.documentElement).appendChild(style);
}
forceTransparentCanvas();

/**
 * FIRST, before anything else in this file and long before the package's own
 * script.
 *
 * A parse error or a top-level throw in the package fires before any listener
 * installed later exists, and those are exactly the failures with no other
 * trace: the widget never calls `define`, so the host waits on a handshake that
 * never comes and shows a skeleton with no explanation anywhere.
 */
installFaultReporting(window, console, (fault) =>
  window.parent.postMessage(faultMessage(fault), "*"),
);

/**
 * Tells the host how tall this package's own content is.
 *
 * The twin of `reportContentSize` in `sdk/runtime/kavibay-runtime.js`, and for
 * the same reason: the frame is sandboxed to an opaque origin, so only the code
 * inside it can measure. Without it a generated widget opens at whatever the
 * model guessed for its size, and the usual guess is too short — the first
 * thing a new widget does is scroll.
 */
(function reportContentSize() {
  let lastW = 0;
  let lastH = 0;
  let queued = false;

  /**
   * What the tallest scrolling element inside the package is hiding.
   *
   * The document is usually not what overflows: a widget writes
   * `html, body { height: 100% }` and puts its list in a box with
   * `overflow: auto`, so the page fits by construction however much content
   * there is. Measuring only the document then reports a perfectly fitting page
   * above a list that scrolls.
   */
  const hiddenInside = () => {
    let extra = 0;
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const { overflowY } = getComputedStyle(el);
      if (overflowY !== "auto" && overflowY !== "scroll") continue;
      extra = Math.max(extra, el.scrollHeight - el.clientHeight);
    }
    return extra;
  };

  const measure = () => {
    queued = false;
    const root = document.documentElement;
    if (!root) return;
    const width = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0);
    const height =
      Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0) + hiddenInside();
    if (width === lastW && height === lastH) return;
    lastW = width;
    lastH = height;
    window.parent.postMessage({ type: "kavibay.ext.content-size", width, height }, "*");
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  };

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(schedule);
    // The body, not `documentElement`: observing the viewport reports the
    // frame's own size back and makes the measurement a function of the answer.
    const observe = () => document.body && observer.observe(document.body);
    if (document.body) observe();
    else document.addEventListener("DOMContentLoaded", observe);
  }
  window.addEventListener("load", schedule);
  document.addEventListener("DOMContentLoaded", schedule);
  schedule();
})();

const port = new SandboxGuestPort((message) => window.parent.postMessage(message, "*"));

let registered: GuestWidget<any, any> | undefined;
let instance: WidgetInstance<unknown> | undefined;
/** Declared provider ids, from the same init that names the instance. */
let declaredProviders: readonly string[] = [];
let started = false;

const fail = (error: ProviderError) => window.parent.postMessage(failedMessage(error), "*");

const toError = (err: unknown): ProviderError =>
  err && typeof err === "object" && "kind" in err && "message" in err
    ? (err as ProviderError)
    : { kind: "provider-error", message: err instanceof Error ? err.message : String(err) };

/**
 * Runs when both halves are present: the host has said which instance this is,
 * and the package has registered its widget. Either can arrive first — the
 * script tag order inside the package's HTML is the package author's business,
 * not something the host should depend on.
 */
async function startIfReady() {
  if (started || !registered || !instance) return;
  started = true;

  const root = document.getElementById("kavibay-widget");
  if (!root) {
    fail({ kind: "provider-error", message: 'the package HTML has no <div id="kavibay-widget">' });
    return;
  }

  try {
    const ctx = port.context(instance, declaredProviders) as never;
    /**
     * After ctx exists, before render. An `<a href>` the package writes is
     * otherwise a dead control: the frame cannot navigate, and a link that
     * looks clickable and isn't is the silent failure the prompt used to
     * warn about. The host still decides which hosts this widget may open.
     */
    installLinkOpening(window as unknown as LinkOpeningTarget, (url) =>
      (ctx as { openExternal: { open: (url: string) => Promise<void> } }).openExternal.open(url),
    );
    const model = await registered.setup(ctx);
    registered.render(model, root);
    // The host holds a skeleton until this arrives.
    window.parent.postMessage(mountedMessage(), "*");
  } catch (err) {
    // A package that throws must not be a blank frame. The host renders the
    // same error panel it would for any widget; a package never draws one.
    fail(toError(err));
  }
}

window.kavibayWidget = {
  define(widget) {
    if (registered) return;
    registered = widget as GuestWidget<any, any>;
    void startIfReady();
  },
};

window.addEventListener("message", (event: MessageEvent) => {
  // Only the embedder speaks to this document. `event.origin` is "null" under
  // an opaque origin and so says nothing; the window reference is the identity.
  if (event.source !== window.parent) return;
  if (port.accept(event.data)) return;

  const theme = readThemeMessage(event.data);
  if (theme) {
    applyTheme((token, value) => document.documentElement.style.setProperty(token, value), theme);
    return;
  }

  const named = readInit(event.data);
  if (named && !instance) {
    instance = named.instance;
    declaredProviders = named.providers;
    void startIfReady();
  }
});

// Last, so the host cannot answer before the listener above exists.
window.parent.postMessage(readyMessage(), "*");
