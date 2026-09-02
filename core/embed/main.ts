import { defineCustomElement } from "vue";
import KavibayWidget from "./widget/KavibayWidget.vue";
import PaletteDemo from "./palette/PaletteDemo.ce.vue";
import DemoControls from "./demo/DemoControls.ce.vue";
import { lazyWidgetNames, loadLazyWidget } from "./widget/catalog";

/**
 * Side-effect entry: one script tag registers every embed custom element.
 *
 * The two elements are registered differently on purpose, and the difference
 * is the whole reason widgets look like the app rather than like a copy of it.
 *
 * `PaletteDemo` is this package's own component and keeps a shadow root. Its
 * `.ce.vue` suffix is what `@vitejs/plugin-vue` 5.x matches to compile in
 * custom-element mode, which inlines the SFC's styles so Vue can put them in
 * that shadow tree. Nothing outside this package styles it, and nothing it
 * ships leaks onto the host page.
 *
 * `KavibayWidget` renders **shipping widgets**: the app's `WidgetCard.vue`
 * chrome, the app's `useWidgetRuntime`, and the widget's own view from its
 * `view.ts`. Those views are ordinary `.vue` files whose styles are emitted to
 * the document stylesheet, and a shadow root cannot see them — inside a shadow
 * tree every widget would render unstyled. The fix is `shadowRoot: false`, not
 * a copy of each view's CSS. Light DOM is also what the app does: widgets
 * there live in the normal document inside `WidgetCard`, never in a shadow
 * tree.
 *
 * A consumer of `<kavibay-widget>` therefore loads `kavibay-embed.css` beside
 * the script; the palette alone does not need it.
 *
 * This is the in-process path, which is what makes it pixel-identical to the
 * desktop. The sandboxed iframe path — the one a store needs for third-party
 * code — stays a later phase and will be a second element, not a change here.
 */
customElements.define("kavibay-palette-demo", defineCustomElement(PaletteDemo));

/**
 * Play, pause and replay for the scripted tour, plus how far it has got.
 *
 * Its own element, and a shadow one like the palette, because the tour spans
 * three components in no shared tree — the page decides where the transport
 * sits, the same way it decides where the palette does. Without a tour on the
 * page it renders nothing.
 */
customElements.define("kavibay-demo-controls", defineCustomElement(DemoControls));

/**
 * Fetch the heavy widgets this page actually asks for, then define the element.
 *
 * The order is the point. `embedWidget` is synchronous — a card looks its
 * definition up while mounting — so a lazily loaded widget has to be in the
 * catalog before the first upgrade. Defining afterwards costs a page that
 * needs the Wizard one extra round trip, and saves every page that does not
 * about 44 KB gzip.
 *
 * The scan reads the document rather than a configuration list: the page
 * already states what it mounts, in the markup, and a second list would be a
 * second place to forget.
 */
async function defineWidgetElement() {
  const wanted = new Set(
    [...document.querySelectorAll("kavibay-widget")]
      .map((el) => el.getAttribute("definition"))
      .filter((name): name is string => Boolean(name)),
  );

  await Promise.all(
    lazyWidgetNames()
      .filter((name) => wanted.has(name))
      .map((name) => loadLazyWidget(name)),
  );

  customElements.define("kavibay-widget", defineCustomElement(KavibayWidget, { shadowRoot: false }));
}

void defineWidgetElement();
