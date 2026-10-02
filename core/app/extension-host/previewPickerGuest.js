// Injected before package scripts, only into Wizard preview documents (?wizardPreview=1).
(() => {
  let token = null;
  let overlay = null;
  let hovered = null;
  let cursorStyle = null;

  function clear() {
    overlay?.remove();
    overlay = null;
    hovered = null;
  }
  function highlight(element) {
    if (!element || element === document.documentElement || element === overlay) return clear();
    hovered = element;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.cssText = "all:initial;position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:2px solid #78a9ff;border-radius:3px;background:rgba(120,169,255,.14);";
      document.documentElement.append(overlay);
    }
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }
  function selectorFor(element) {
    const parts = [];
    for (let node = element; node && parts.length < 8; node = node.parentElement) {
      const tag = node.localName;
      if (node.id && node.id.length <= 64) {
        const id = `#${CSS.escape(node.id)}`;
        if (document.querySelectorAll(id).length === 1) {
          parts.unshift(id);
          break;
        }
      }
      const classes = parts.length ? [] : [...node.classList].filter((name) => /^[a-zA-Z_][\w-]{0,31}$/.test(name)).slice(0, 2);
      let part = tag + classes.map((name) => `.${CSS.escape(name)}`).join("");
      const siblings = node.parentElement ? [...node.parentElement.children].filter((child) => child.localName === tag) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      parts.unshift(part);
      if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
    }
    while (parts.join(" > ").length > 512) parts.shift();
    return parts.join(" > ");
  }
  function excerpt(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text = "";
    let visited = 0;
    for (let node = walker.nextNode(); node && visited++ < 200 && text.length < 200; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest("input,textarea,select,[contenteditable],script,style,[hidden],[aria-hidden=true]") || !parent.getClientRects().length) continue;
      text += ` ${node.textContent ?? ""}`.replace(/\s+/g, " ");
    }
    return text.trim().slice(0, 200);
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.type !== "kavibay.preview.pick") return;
    const next = event.data.token;
    token = typeof next === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(next) ? next : null;
    clear();
    cursorStyle?.remove();
    cursorStyle = null;
    if (token) {
      cursorStyle = document.createElement("style");
      cursorStyle.textContent = "html, body, body * { cursor: crosshair !important; }";
      document.documentElement.append(cursorStyle);
    }
  });
  window.addEventListener("pointermove", (event) => {
    if (token && event.target instanceof Element) highlight(event.target);
  }, true);
  window.addEventListener("scroll", () => { if (token && hovered) highlight(hovered); }, true);
  window.addEventListener("resize", clear);
  document.addEventListener("mouseleave", clear);

  // Capture before widget handlers: picking a button must not also run its action.
  for (const name of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "dblclick", "contextmenu"]) {
    window.addEventListener(name, (event) => {
      if (!token) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, passive: false });
  }
  window.addEventListener("click", (event) => {
    if (!token) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const element = event.target;
    if (!(element instanceof Element) || element === overlay) return;
    parent.postMessage({
      type: "kavibay.preview.selected", token,
      element: { selector: selectorFor(element), tag: element.localName, text: excerpt(element) },
    }, "*");
    clear();
  }, true);
  window.addEventListener("keydown", (event) => {
    if (!token) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      parent.postMessage({ type: "kavibay.preview.cancelled", token }, "*");
      token = null;
      cursorStyle?.remove();
      clear();
    }
  }, true);
  parent.postMessage({ type: "kavibay.preview.ready" }, "*");
})();
