"use strict";

(function () {
  var MSG_TYPE = "__wearewatched__";
  var counts = {};
  // byScript: { 'google-analytics.com': { fingerprint: 4, permission: 0 }, ... }
  // Populated from inject.js's stack-walked caller host so background.js
  // can resolve scripts to companies and surface per-watcher device-id.
  var byScript = {};
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
    var script = event.data.script;

    if (!counts[api]) {
      counts[api] = { category: category, count: 0 };
    }
    counts[api].count++;

    if (script) {
      if (!byScript[script]) byScript[script] = { fingerprint: 0, permission: 0 };
      byScript[script][category] = (byScript[script][category] || 0) + 1;
    }

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
          byScript: byScript,
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
