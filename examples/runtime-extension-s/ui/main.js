/** SPDX-License-Identifier: MIT */
(function () {
  var statusEl = document.getElementById("status");
  var EXT_ID = "runtime-extension-s";
  // Host ignores these ids; still send them so the message shape is valid.
  var INSTANCE_ID = "fixture-instance";
  var pending = {};

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function requestId() {
    return "req-" + Math.random().toString(36).slice(2);
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type !== "kavibay.ext.storage.result") return;
    var cb = pending[data.requestId];
    if (!cb) return;
    delete pending[data.requestId];
    cb(data);
  });

  function storageCall(type, extra) {
    return new Promise(function (resolve) {
      var id = requestId();
      pending[id] = resolve;
      var msg = Object.assign(
        {
          type: type,
          requestId: id,
          extId: EXT_ID,
          instanceId: INSTANCE_ID,
        },
        extra || {},
      );
      parent.postMessage(msg, "*");
    });
  }

  // Announce ready, then set + get a value and show the result.
  parent.postMessage({ type: "kavibay.ext.ready", extId: EXT_ID }, "*");
  setStatus("ready; setting…");

  storageCall("kavibay.ext.storage.set", {
    value: { hello: "kavibay", n: 1 },
  })
    .then(function (setRes) {
      if (!setRes.ok) {
        setStatus("set failed: " + (setRes.error || "unknown"));
        return null;
      }
      setStatus("set ok; getting…");
      return storageCall("kavibay.ext.storage.get");
    })
    .then(function (getRes) {
      if (!getRes) return;
      if (!getRes.ok) {
        setStatus("get failed: " + (getRes.error || "unknown"));
        return;
      }
      setStatus("storage ok: " + JSON.stringify(getRes.value));
    });
})();
