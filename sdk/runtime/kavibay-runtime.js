// SPDX-License-Identifier: MIT
/**
 * Kavibay runtime package SDK.
 *
 * Copy this file into your package and load it before your own script:
 *
 *   <script src="kavibay-runtime.js"></script>
 *
 * It wraps the host bridge so you never hand-roll postMessage plumbing:
 *
 *   const res = await kavibay.http("forecast", { latitude: 52.5, longitude: 13.4 });
 *   if (!res.ok) return showError(res.code);
 *   render(res.data);
 *
 *   await kavibay.storage.set({ city: "Berlin" });
 *   const saved = await kavibay.storage.get();
 *
 * Everything is host-mediated on purpose: your package never holds a secret,
 * never learns another package's data, and can only reach the endpoints its
 * own `api.json` declares and the user consented to.
 */

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
 * THE FIRST TWO ATTEMPTS AT THIS FAILED, AND HOW IS THE REASON FOR THE THIRD.
 * Forcing `background: transparent` on the root is the one value that hands the
 * canvas over — it *is* the condition. Forcing a nearly-zero alpha instead
 * looked like it dodged the condition and did not: Chromium quantises alpha to
 * 8 bits at computed-value time, so `rgba(0,0,0,0.00004)` computes to
 * `rgba(0, 0, 0, 0)`, the same value as `transparent`.
 *
 * So this does not try to satisfy the rule cleverly. It removes the rule:
 * `color-scheme: normal` on the root means there is no scheme colour to
 * substitute, which is plain pre-`color-scheme` behaviour and not a subtlety.
 * The two things `color-scheme: dark` was wanted for are put back directly —
 * `scrollbar-color` for the viewport scrollbar, and the dark scheme on form
 * controls, where it changes rendering and not the canvas. The non-zero root
 * alpha stays as a second, independent line of defence; at 1/255 over the card
 * behind it, it is not a difference anybody can see.
 */
(function forceTransparentCanvas() {
  var style = document.createElement("style");
  style.textContent =
    ":root{color-scheme:normal !important;" +
    "background-color:rgba(0,0,0,0.004) !important;" +
    "scrollbar-color:rgba(232,232,234,0.32) transparent;}" +
    "body{background:transparent !important;}" +
    "input,textarea,select,button,progress,meter{color-scheme:dark;}";
  (document.head || document.documentElement).appendChild(style);
})();

/**
 * Reports this document's failures to the host.
 *
 * Without it, a package that throws writes a perfectly good message to a
 * console inside a sandboxed frame that nobody can open — and the widget is
 * simply blank, with the host holding a skeleton and no way to say why.
 *
 * INSTALLED FIRST, before the bridge below and long before your own script. A
 * parse error or a top-level throw fires before any listener added later
 * exists, and those are the failures with no other trace at all.
 *
 * This is the hand-written twin of `installFaultReporting` in
 * `sdk/extension/contract/sandbox-guest.ts`. Two copies because the two package
 * formats share no module system — this file is served as-is and that one is
 * compiled — so `scripts/guestFaultReporting.assert.mjs` holds them to being
 * the same thing.
 */
/**
 * Tells the host how tall this package's own content is.
 *
 * Only the guest can: the frame is sandboxed to an opaque origin, so its layout
 * is not readable from outside. Without it a generated widget opens at whatever
 * size the model guessed for `ui.defaultSize`, and the usual guess is too short
 * — so the first thing a new widget does is scroll.
 *
 * `scrollHeight` on the root rather than the body's box: it is the height the
 * content *wants*, which is exactly the question, and it stays right when the
 * package positions things absolutely.
 *
 * Debounced to a frame and only sent when the number actually moves, because a
 * `ResizeObserver` on a widget that animates would otherwise post on every tick
 * for a size that has not changed.
 */
(function reportContentSize() {
  "use strict";

  var lastW = 0;
  var lastH = 0;
  var queued = false;

  /**
   * What the tallest scrolling element inside the package is hiding.
   *
   * The document is usually not what overflows. A widget writes
   * `html, body { height: 100% }` and puts its list in a box with
   * `overflow: auto`, so the document fits *by construction* however much
   * content there is — and a measurement of `documentElement.scrollHeight`
   * reports a perfectly fitting page above a list that scrolls.
   *
   * Adding the largest hidden remainder asks the real question: how much taller
   * would this have to be for nothing to scroll. The host's ceiling is what
   * stops a log with no end from growing without limit.
   */
  function hiddenInside() {
    var extra = 0;
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      var overflowY = getComputedStyle(el).overflowY;
      if (overflowY !== "auto" && overflowY !== "scroll") continue;
      var hidden = el.scrollHeight - el.clientHeight;
      if (hidden > extra) extra = hidden;
    }
    return extra;
  }

  function measure() {
    queued = false;
    var root = document.documentElement;
    var body = document.body;
    if (!root) return;
    var w = Math.max(root.scrollWidth, body ? body.scrollWidth : 0);
    var h =
      Math.max(root.scrollHeight, body ? body.scrollHeight : 0) + hiddenInside();
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    try {
      parent.postMessage({ type: "kavibay.ext.content-size", width: w, height: h }, "*");
    } catch (err) {
      /* A frame with no parent to tell is not a failure worth reporting. */
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  }

  if (typeof ResizeObserver === "function") {
    var observer = new ResizeObserver(schedule);
    // The element whose box changes when content is added, not the viewport —
    // observing `documentElement` reports the *frame's* size back at us and
    // makes the measurement a function of the answer.
    if (document.body) observer.observe(document.body);
    else document.addEventListener("DOMContentLoaded", function () {
      if (document.body) observer.observe(document.body);
    });
  }
  window.addEventListener("load", schedule);
  document.addEventListener("DOMContentLoaded", schedule);
  schedule();
})();

(function installFaultReporting() {
  "use strict";

  /** Enough to diagnose; few enough that a throwing timer cannot flood. */
  var LIMIT = 50;
  var MESSAGE_MAX = 400;
  var STACK_MAX = 800;

  var sent = 0;
  var reporting = false;

  function clip(text, max) {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  /** Anything at all, as one line. JSON.stringify throws on cycles. */
  function describe(value) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.name + ": " + value.message;
    try {
      var json = JSON.stringify(value);
      return json === undefined ? String(value) : json;
    } catch (err) {
      return String(value);
    }
  }

  function stackOf(value) {
    return value instanceof Error && typeof value.stack === "string"
      ? clip(value.stack, STACK_MAX)
      : undefined;
  }

  /** `widget.js:42:9` — the basename, because every file shares one root. */
  function whereOf(event) {
    var file = event && typeof event.filename === "string" ? event.filename : "";
    if (!file) return undefined;
    var name = file.split("/").pop() || file;
    if (typeof event.lineno !== "number" || event.lineno === 0) return name;
    return typeof event.colno === "number" && event.colno !== 0
      ? name + ":" + event.lineno + ":" + event.colno
      : name + ":" + event.lineno;
  }

  function send(fault) {
    // Reentrancy: posting can throw, and a reporter that failed through
    // console.error would otherwise report its own failure forever.
    if (reporting || sent >= LIMIT) return;
    reporting = true;
    sent += 1;
    try {
      if (sent === LIMIT) fault.message += " — further faults are not reported";
      parent.postMessage(
        {
          type: "kavibay.ext.fault",
          source: fault.source,
          message: fault.message,
          where: fault.where,
          stack: fault.stack,
        },
        "*",
      );
    } catch (err) {
      // A reporter that throws must not become the thing being reported.
    }
    reporting = false;
  }

  window.addEventListener("error", function (event) {
    var message =
      event && typeof event.message === "string" && event.message
        ? event.message
        : describe(event && event.error);
    send({
      source: "error",
      message: clip(message, MESSAGE_MAX),
      where: whereOf(event),
      stack: stackOf(event && event.error),
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    send({
      source: "rejection",
      message: clip(describe(event && event.reason), MESSAGE_MAX),
      stack: stackOf(event && event.reason),
    });
  });

  // A <script src> or <img> that did not load. Resource errors do not bubble,
  // so only the capture phase (third argument) hears them at the window, and
  // they carry no message — just the element. A real runtime error reaches
  // here too, targeted at the window, which has no src or href.
  window.addEventListener(
    "error",
    function (event) {
      var element = event && event.target;
      var url = element && (element.src || element.href);
      if (typeof url !== "string" || url === "") return;
      send({ source: "error", message: clip("failed to load " + url, MESSAGE_MAX) });
    },
    true,
  );

  // Wrapped, not replaced: the original still runs, so devtools on the frame
  // loses nothing. Included because a generated widget's usual shape is
  // `catch (e) { console.error(e) }`, and that catch is where the useful
  // sentence goes to die.
  var original = console.error.bind(console);
  console.error = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(describe(arguments[i]));
    send({ source: "console", message: clip(parts.join(" "), MESSAGE_MAX) });
    original.apply(console, arguments);
  };
})();

(function () {
  "use strict";

  /** How long to wait for a host reply before giving up on a request. */
  var REQUEST_TIMEOUT_MS = 30000;

  var pending = Object.create(null);
  var nextId = 0;

  function newRequestId() {
    nextId += 1;
    return "r" + nextId + "-" + Math.random().toString(36).slice(2, 10);
  }

  /** Sends one message to the host and resolves when its reply arrives. */
  function send(message) {
    return new Promise(function (resolve, reject) {
      var requestId = newRequestId();
      message.requestId = requestId;

      var timer = setTimeout(function () {
        delete pending[requestId];
        reject(new Error("kavibay: host did not answer in time"));
      }, REQUEST_TIMEOUT_MS);

      pending[requestId] = function (reply) {
        clearTimeout(timer);
        resolve(reply);
      };

      // The host ignores any id in the payload and binds the call to this
      // frame; sending one anyway would only be decoration.
      parent.postMessage(message, "*");
    });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (typeof data.requestId !== "string") return;

    var resolver = pending[data.requestId];
    if (!resolver) return;
    delete pending[data.requestId];
    resolver(data);
  });

  var kavibay = {
    /**
     * Calls one endpoint from this package's `api.json`.
     *
     * Resolves with `{ ok, status, data, code, detail, retryAfterSecs, fromCache }`.
     * It never rejects for a provider error — check `ok` and branch on `code`
     * (`permission_denied`, `invalid_arguments`, `rate_limited`, `http_error`,
     * `network_error`, `timeout`, …).
     */
    http: function (endpointId, args) {
      return send({
        type: "kavibay.ext.http.call",
        endpointId: endpointId,
        args: args === undefined ? null : args,
      }).then(function (reply) {
        return reply.result;
      });
    },

    storage: {
      /** Reads this widget instance's stored value (`null` when unset). */
      get: function () {
        return storageReadPromise(send({ type: "kavibay.ext.storage.get" }).then(function (reply) {
          if (reply.ok === false) throw new Error(reply.error);
          return reply.value;
        }));
      },
      /** Replaces this widget instance's stored value. */
      set: function (value) {
        return send({ type: "kavibay.ext.storage.set", value: value }).then(
          function (reply) {
            if (reply.ok === false) throw new Error(reply.error);
            return reply.value;
          },
        );
      },
    },
  };

  // Match the contract guest: a missing await must not silently reset saved fields.
  function storageReadPromise(promise) {
    function misuse() {
      throw new Error("kavibay.storage.get() returns a Promise. Use await kavibay.storage.get() before reading saved fields.");
    }
    return new Proxy(promise, {
      get: function (target, key) {
        if (key === "then" || key === "catch" || key === "finally") return target[key].bind(target);
        if (Reflect.has(target, key)) return Reflect.get(target, key, target);
        return misuse();
      },
      ownKeys: misuse,
    });
  }

  window.kavibay = kavibay;
  parent.postMessage({ type: "kavibay.ext.ready" }, "*");
})();
