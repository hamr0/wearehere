"use strict";

var SUSPICIOUS_PATTERNS = [
  { pattern: /^_ga|^_gid|^_gat|^_gcl/i, category: "Cross-site tracking" },
  { pattern: /amplitude|mixpanel|mp_/i, category: "Cross-site tracking" },
  { pattern: /hubspot|intercom/i, category: "Cross-site tracking" },
  { pattern: /ajs_|segment/i, category: "Cross-site tracking" },
  { pattern: /plausible|matomo|_pk_|piwik/i, category: "Cross-site tracking" },
  { pattern: /hotjar|_hjid|_hjSession/i, category: "Cross-site tracking" },
  { pattern: /fullstory|logrocket|mouseflow/i, category: "Cross-site tracking" },
  { pattern: /_clck|_clsk|clarity/i, category: "Cross-site tracking" },
  { pattern: /ahoy_/i, category: "Cross-site tracking" },
  { pattern: /_fbp|_fbc/i, category: "Cross-site tracking" },
  { pattern: /optimizely/i, category: "Cross-site tracking" },
  { pattern: /permutive/i, category: "Cross-site tracking" },
  { pattern: /quantcast|_qc/i, category: "Cross-site tracking" },
  { pattern: /^IDE$|^DSID$|^NID$|^ANID$|^1P_JAR$/i, category: "Advertising" },
  { pattern: /__gads|__gpi|test_cookie|adroll/i, category: "Advertising" },
  { pattern: /doubleclick|googlesyndication|googlead/i, category: "Advertising" },
  { pattern: /fbclid|gclid|utm_/i, category: "Advertising" },
  { pattern: /rtbhouse|criteo|taboola|outbrain/i, category: "Advertising" },
  { pattern: /fingerprint|device_id|browser_id|machine_id/i, category: "Fingerprinting" },
  { pattern: /visitor_id|client_id|distinct_id/i, category: "Fingerprinting" },
  { pattern: /canvas_fingerprint|webgl_fingerprint|audio_fingerprint/i, category: "Fingerprinting" },
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i, category: "PII exposure", matchValue: true },
  { pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, category: "Tracking", matchValue: true },
];

var MAX_KEYS_PER_DOMAIN = 500;
var MAX_VALUE_LENGTH = 200;

function classifyItem(key, value) {
  var flags = [];
  for (var i = 0; i < SUSPICIOUS_PATTERNS.length; i++) {
    var p = SUSPICIOUS_PATTERNS[i];
    if (p.matchValue) {
      if (p.pattern.test(value)) flags.push(p.category);
    } else {
      if (p.pattern.test(key)) flags.push(p.category);
    }
  }
  var seen = {};
  var unique = [];
  for (var j = 0; j < flags.length; j++) {
    if (!seen[flags[j]]) {
      seen[flags[j]] = true;
      unique.push(flags[j]);
    }
  }
  return unique;
}

function scanStorage(storage, storeName) {
  var items = [];
  if (!storage) return items;

  try {
    var len = Math.min(storage.length, MAX_KEYS_PER_DOMAIN);
    for (var i = 0; i < len; i++) {
      var key = storage.key(i);
      if (key === null) continue;
      var rawValue = storage.getItem(key) || "";
      var value = rawValue.length > MAX_VALUE_LENGTH
        ? rawValue.slice(0, MAX_VALUE_LENGTH) + "\u2026"
        : rawValue;
      var flags = classifyItem(key, rawValue);
      items.push({
        store: storeName,
        key: key,
        value: value,
        size: rawValue.length,
        flags: flags,
      });
    }
  } catch (e) {}
  return items;
}

function run() {
  var localItems = scanStorage(window.localStorage, "local");
  var sessionItems = scanStorage(window.sessionStorage, "session");
  var items = localItems.concat(sessionItems);
  var flagged = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].flags.length > 0) flagged++;
  }

  chrome.runtime.sendMessage({
    type: "detection",
    module: "leaked",
    data: {
      domain: location.hostname,
      url: location.href,
      timestamp: Date.now(),
      items: items,
      totals: {
        local: localItems.length,
        session: sessionItems.length,
        flagged: flagged,
      },
    }
  });
}

run();
