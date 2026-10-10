/** Host-served in every package document; widgets do not implement host gestures. */
(function forwardWidgetGestures() {
  // Pointer events never bubble out of the iframe into the host's card.
  window.addEventListener("pointerdown", function () {
    parent.postMessage({ type: "kavibay.ext.pointerdown" }, "*");
  }, { capture: true });

  var gestureScale = null;
  function send(change) {
    parent.postMessage(Object.assign({ type: "kavibay.ext.zoom" }, change), "*");
  }
  window.addEventListener("wheel", function (event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // WebKit may emit both streams for a pinch; its gesture scale wins.
    if (gestureScale !== null) return;
    send({ kind: "wheel", deltaY: event.deltaY, deltaMode: event.deltaMode });
  }, { capture: true, passive: false });

  window.addEventListener("gesturestart", function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    gestureScale = 1;
  }, { capture: true, passive: false });
  window.addEventListener("gesturechange", function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (gestureScale === null || !Number.isFinite(event.scale) || event.scale <= 0) return;
    send({ kind: "pinch", factor: event.scale / gestureScale });
    gestureScale = event.scale;
  }, { capture: true, passive: false });
  window.addEventListener("gestureend", function (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    gestureScale = null;
  }, { capture: true, passive: false });
})();
