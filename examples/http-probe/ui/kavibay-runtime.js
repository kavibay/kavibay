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
        return send({ type: "kavibay.ext.storage.get" }).then(function (reply) {
          if (reply.ok === false) throw new Error(reply.error);
          return reply.value;
        });
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

  window.kavibay = kavibay;
  parent.postMessage({ type: "kavibay.ext.ready" }, "*");
})();
