// SPDX-License-Identifier: MIT
/**
 * Lazy widget views, with a way to warm them before they are needed.
 *
 * Extensions declare their widget/settings/menu components as dynamic imports so
 * none of that code sits in the start-up graph. That trade has a sharp edge: the
 * first Ctrl+Space mounts every widget on the desk at once, and each one would
 * then fetch its own chunk while the user is already looking at the palette.
 *
 * `lazyView` keeps the loader next to the component it produced, so the host can
 * run those loaders during idle time after boot ({@link warmLazyViews}). By the
 * time a widget mounts, its module is in the module cache and mounting is
 * synchronous again — start-up stays light *and* opening stays instant.
 *
 * Use this instead of a bare `defineAsyncComponent` for anything the host may
 * mount on its own (widget, settings panel, menu). A view that only appears
 * after an explicit user action can stay a plain async component.
 */
import { defineAsyncComponent, type Component } from "vue";

type ViewLoader = () => Promise<unknown>;

/**
 * Loaders keyed by the component they belong to, so the host can warm exactly
 * the views it is about to need rather than every view in the app.
 */
const loaders = new WeakMap<object, ViewLoader>();

/** Loaders already started — a module is fetched once, not once per caller. */
const started = new WeakSet<object>();

/** Declare a lazily loaded view and remember how to load it early. */
export function lazyView(loader: ViewLoader): Component {
  const component = defineAsyncComponent(loader as () => Promise<Component>);
  loaders.set(component as object, loader);
  return component;
}

/**
 * Start loading the given views' modules without mounting them.
 *
 * Failures are swallowed on purpose: this is a head start, not a load-bearing
 * step. If a chunk cannot be fetched here, mounting the component later fails
 * the same way it would have without warming, and reports it in that context.
 */
export function warmLazyViews(components: Iterable<Component | undefined>): void {
  for (const component of components) {
    if (!component || typeof component !== "object") continue;
    const key = component as object;
    if (started.has(key)) continue;
    const loader = loaders.get(key);
    if (!loader) continue;
    started.add(key);
    void loader().catch(() => {});
  }
}
