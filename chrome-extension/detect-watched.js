"use strict";

(function () {
  var MSG_TYPE = "__wearewatched__";
  var counts = {};
  var debounceTimer = null;
  var DEBOUNCE_MS = 500;

  // Inject page-context script
  var script = document.createElement("script");
  script.src = chrome.runtime.getURL("inject.js");
  script.onload = function () { script.remove(); };
  (document.documentElement || document.head || document.body).appendChild(script);

  // Listen for messages from inject.js
  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== MSG_TYPE) return;

    var api = event.data.api;
    var category = event.data.category;

    if (!counts[api]) {
      counts[api] = { category: category, count: 0 };
    }
    counts[api].count++;

    scheduleSend();
  });

  function scheduleSend() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sendResults, DEBOUNCE_MS);
  }

  function sendResults() {
    var items = [];
    var uniqueFingerprint = 0;
    var uniquePermission = 0;

    var apis = Object.keys(counts);
    for (var i = 0; i < apis.length; i++) {
      var api = apis[i];
      var entry = counts[api];
      items.push({
        api: api,
        category: entry.category,
        count: entry.count
      });
      if (entry.category === "fingerprint") uniqueFingerprint++;
      if (entry.category === "permission") uniquePermission++;
    }

    try {
      chrome.runtime.sendMessage({
        type: "detection",
        module: "watched",
        data: {
          domain: location.hostname,
          items: items,
          totals: {
            fingerprint: uniqueFingerprint,
            permission: uniquePermission,
            total: uniqueFingerprint + uniquePermission
          }
        }
      });
    } catch (e) { /* service worker not ready */ }
  }
})();
