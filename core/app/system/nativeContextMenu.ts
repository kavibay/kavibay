/**
 * Keep WebKit's own right-click menu (Reload, Inspect Element, …) out of the app.
 *
 * Surfaces with a menu of their own open it and call `preventDefault` first. This
 * listener sits on `window`, so it runs after them and only stops the browser's.
 */
export function suppressNativeContextMenu(): void {
  window.addEventListener("contextmenu", (event) => event.preventDefault());
}
