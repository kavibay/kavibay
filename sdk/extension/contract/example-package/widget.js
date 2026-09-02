// SPDX-License-Identifier: MIT
/**
 * The smallest complete widget package.
 *
 * `setup` is the contract's, identical to what a widget in the app bundle
 * writes — it takes a `WidgetContext` and returns a model. `render` is the part
 * a package supplies for itself: the in-app path maps a definition id to a Vue
 * component, and a package is not in that map.
 *
 * What is absent is the point. No connect screen, no spinner, no error panel,
 * no retry button. The host draws all of those, from the far side of the
 * channel, and it draws the same ones it draws for every other widget. A
 * package that renders its own is not customising anything, it is producing a
 * second loading state in an overlay that already has one.
 */
kavibayWidget.define({
  async setup(ctx) {
    // `ctx.data` is scoped to this instance by the host. Two counters on the
    // desk do not see each other, and neither can name the other's scope.
    let count = (await ctx.data.get("count")) ?? 0;

    return {
      label: ctx.config.label ?? "Count",
      current: () => count,
      async increment() {
        count += 1;
        await ctx.data.set("count", count);
        return count;
      },
    };
  },

  /**
   * Called once, with the element to fill. Not on every change: the model owns
   * its own updating, exactly as in the app, and a render called repeatedly
   * would invite rebuilding the DOM on every tick.
   */
  render(model, root) {
    root.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px";

    const label = document.createElement("p");
    label.textContent = model.label;
    label.style.cssText = "margin:0;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-faint)";

    const value = document.createElement("p");
    value.textContent = String(model.current());
    value.style.cssText = "margin:0;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums";

    // A button with a click handler, never a form. Form submission is checked
    // against the sandbox flags *before* the submit event fires, so inside
    // `allow-scripts` the handler is skipped rather than prevented — the widget
    // would look right and do nothing.
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "+";
    button.style.cssText =
      "font:inherit;font-size:14px;line-height:1;padding:4px 12px;color:inherit;cursor:pointer;" +
      "background:var(--fill, rgba(255,255,255,.08));border:1px solid var(--border, rgba(255,255,255,.18));border-radius:6px";
    button.addEventListener("click", async () => {
      value.textContent = String(await model.increment());
    });

    wrap.append(label, value, button);
    root.append(wrap);
  },
});
