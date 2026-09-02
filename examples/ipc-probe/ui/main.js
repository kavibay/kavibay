/** SPDX-License-Identifier: MIT */
/**
 * Dev-only probe: every check must PASS (blocked).
 * FAIL on any row means the sandbox no longer isolates the frame from host IPC/DOM —
 * stop-ship for runtime extensions until fixed.
 */
(function () {
  var resultsEl = document.getElementById("results");
  var summaryEl = document.getElementById("summary");

  /** @typedef {{ name: string, blocked: boolean, detail: string }} ProbeCheck */

  /**
   * True when `value` is absent / undefined (IPC surface not injected).
   * @param {unknown} value
   */
  function isAbsent(value) {
    return value === undefined || value === null;
  }

  /**
   * True when reading a parent/top property throws (cross-origin / opaque isolation).
   * @param {Window} win
   * @param {string} prop
   */
  function accessThrows(win, prop) {
    try {
      void win[prop];
      return false;
    } catch (_err) {
      return true;
    }
  }

  /** @returns {ProbeCheck[]} */
  function runChecks() {
    var chromeWebview = null;
    try {
      chromeWebview =
        typeof window.chrome === "object" && window.chrome
          ? window.chrome.webview
          : undefined;
    } catch (_err) {
      chromeWebview = "threw";
    }

    return [
      {
        name: "window.__TAURI_INTERNALS__",
        blocked: isAbsent(window.__TAURI_INTERNALS__),
        detail: isAbsent(window.__TAURI_INTERNALS__)
          ? "absent"
          : "present (IPC reachable)",
      },
      {
        name: "window.ipc",
        blocked: isAbsent(window.ipc),
        detail: isAbsent(window.ipc) ? "absent" : "present (IPC reachable)",
      },
      {
        name: "window.chrome.webview",
        blocked: chromeWebview === "threw" || isAbsent(chromeWebview),
        detail:
          chromeWebview === "threw"
            ? "access threw"
            : isAbsent(chromeWebview)
              ? "absent"
              : "present (WebView bridge reachable)",
      },
      {
        name: "parent.document",
        blocked: accessThrows(window.parent, "document"),
        detail: accessThrows(window.parent, "document")
          ? "blocked (SecurityError)"
          : "readable (same-origin leak)",
      },
      {
        name: "top.document",
        blocked: accessThrows(window.top || window, "document"),
        detail: accessThrows(window.top || window, "document")
          ? "blocked (SecurityError)"
          : "readable (same-origin leak)",
      },
    ];
  }

  var checks = runChecks();
  var allPass = true;

  for (var i = 0; i < checks.length; i++) {
    var check = checks[i];
    if (!check.blocked) allPass = false;
    var li = document.createElement("li");
    li.className = check.blocked ? "pass" : "fail";
    li.innerHTML =
      "<strong>" +
      (check.blocked ? "PASS" : "FAIL") +
      "</strong> <code>" +
      check.name +
      "</code> — " +
      check.detail;
    resultsEl.appendChild(li);
  }

  summaryEl.textContent = allPass
    ? "ALL PASS — iframe IPC/DOM isolation holds"
    : "FAIL — stop-ship: runtime frame can reach host surface";
  summaryEl.className = allPass ? "pass" : "fail";

  // Ready handshake (no permissions; host may ignore storage).
  try {
    parent.postMessage({ type: "kavibay.ext.ready", extId: "ipc-probe" }, "*");
  } catch (_err) {
    // postMessage to parent is expected to work even under opaque origin.
  }
})();
