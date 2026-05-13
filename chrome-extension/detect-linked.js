"use strict";

(function () {

// ── Tracking parameters mapped to providers ──

var TRACKING_PROVIDERS = {
  "utm_source":   { provider: "Google Analytics", color: "#4285f4" },
  "utm_medium":   { provider: "Google Analytics", color: "#4285f4" },
  "utm_campaign": { provider: "Google Analytics", color: "#4285f4" },
  "utm_term":     { provider: "Google Analytics", color: "#4285f4" },
  "utm_content":  { provider: "Google Analytics", color: "#4285f4" },
  "utm_id":       { provider: "Google Analytics", color: "#4285f4" },
  "gclid":        { provider: "Google",           color: "#4285f4" },
  "dclid":        { provider: "Google",           color: "#4285f4" },
  "_ga":          { provider: "Google",           color: "#4285f4" },
  "_gl":          { provider: "Google",           color: "#4285f4" },
  "fbclid":       { provider: "Meta",             color: "#1877f2" },
  "igshid":       { provider: "Instagram",        color: "#e1306c" },
  "msclkid":      { provider: "Microsoft",        color: "#00a4ef" },
  "mc_eid":       { provider: "Mailchimp",        color: "#ffe01b" },
  "mc_cid":       { provider: "Mailchimp",        color: "#ffe01b" },
  "_hsenc":       { provider: "HubSpot",          color: "#ff7a59" },
  "_hsmi":        { provider: "HubSpot",          color: "#ff7a59" },
  "_openstat":    { provider: "OpenStat",         color: "#9b59b6" },
  "yclid":        { provider: "Yandex",           color: "#fc3f1d" },
  "twclid":       { provider: "X",                color: "#a0a0a0" },
  "ttclid":       { provider: "TikTok",           color: "#ee1d52" },
  "li_fat_id":    { provider: "LinkedIn",         color: "#0a66c2" },
  "ref_src":      { provider: "Referral",         color: "#888888" },
  "ref_url":      { provider: "Referral",         color: "#888888" },
};

var TRACKING_PARAMS = Object.keys(TRACKING_PROVIDERS);

// ── Redirect wrapper definitions ──

var REDIRECT_WRAPPERS = [
  { pattern: "google.com/url", params: ["q", "url"], name: "Google" },
  { pattern: "l.facebook.com/l.php", params: ["u"], name: "Facebook" },
  { pattern: "youtube.com/redirect", params: ["q"], name: "YouTube" },
  { pattern: "safelinks.protection.outlook.com", params: ["url"], name: "Outlook SafeLinks" },
];

var SHORTENER_DOMAINS = ["t.co", "bit.ly", "tinyurl.com", "ow.ly", "goo.gl"];
var REDIRECT_DOMAINS = ["click.redditmail.com"];

// ── State ──

var items = [];

// ── URL analysis ──

function getTrackingParams(url) {
  var found = [];
  try {
    var params = new URL(url).searchParams;
    for (var i = 0; i < TRACKING_PARAMS.length; i++) {
      if (params.has(TRACKING_PARAMS[i])) {
        found.push(TRACKING_PARAMS[i]);
      }
    }
  } catch (e) {}
  return found;
}

function checkRedirectWrapper(url) {
  try {
    var parsed = new URL(url);
    var host = parsed.hostname.replace(/^www\./, "");
    var path = parsed.pathname;

    for (var i = 0; i < REDIRECT_WRAPPERS.length; i++) {
      var w = REDIRECT_WRAPPERS[i];
      var parts = w.pattern.split("/");
      var wrapperHost = parts[0];
      var wrapperPath = "/" + parts.slice(1).join("/");

      if (host === wrapperHost && path === wrapperPath) {
        for (var j = 0; j < w.params.length; j++) {
          var dest = parsed.searchParams.get(w.params[j]);
          if (dest) {
            try { dest = decodeURIComponent(dest); } catch (e) {}
            return { name: w.name, unwrappedUrl: dest };
          }
        }
      }
    }

    for (var s = 0; s < SHORTENER_DOMAINS.length; s++) {
      if (host === SHORTENER_DOMAINS[s]) {
        return { name: host + " (shortener)", unwrappedUrl: null };
      }
    }

    for (var r = 0; r < REDIRECT_DOMAINS.length; r++) {
      if (host === REDIRECT_DOMAINS[r]) {
        return { name: host + " (redirect)", unwrappedUrl: null };
      }
    }
  } catch (e) {}
  return null;
}

function cleanUrl(url) {
  try {
    var parsed = new URL(url);
    var changed = false;
    for (var i = 0; i < TRACKING_PARAMS.length; i++) {
      if (parsed.searchParams.has(TRACKING_PARAMS[i])) {
        parsed.searchParams.delete(TRACKING_PARAMS[i]);
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch (e) {
    return url;
  }
}

function getDomain(url) {
  try { return new URL(url).hostname; } catch (e) { return ""; }
}

// ── Link scanning ──

function analyzeLink(href) {
  if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("#")) return null;

  var trackingParams = getTrackingParams(href);
  var wrapper = checkRedirectWrapper(href);

  if (trackingParams.length === 0 && !wrapper) return null;

  // Resolve a single company per tracked link so background.js can
  // bucket clicks per watcher. Priority: redirect-wrapper origin first
  // (it's the active intermediary), else the first matching tracking
  // param's provider. Shorteners surface as the shortener host since
  // we can't see past the redirect.
  var provider = null;
  if (wrapper && wrapper.name && wrapper.name.indexOf("(") === -1) {
    provider = wrapper.name;
  } else if (trackingParams.length > 0) {
    for (var p = 0; p < trackingParams.length; p++) {
      var info = TRACKING_PROVIDERS[trackingParams[p]];
      if (info && info.provider && info.provider !== "Referral") {
        provider = info.provider;
        break;
      }
    }
  }

  return {
    href: href,
    cleanHref: wrapper && wrapper.unwrappedUrl ? cleanUrl(wrapper.unwrappedUrl) : cleanUrl(href),
    domain: getDomain(href),
    trackingParams: trackingParams,
    isRedirectWrapper: !!wrapper,
    wrapperName: wrapper ? wrapper.name : null,
    unwrappedUrl: wrapper ? wrapper.unwrappedUrl : null,
    provider: provider,
  };
}

var totalAnchors = 0;

function scanLinks() {
  items = [];
  var anchors = document.querySelectorAll("a[href]");
  totalAnchors = anchors.length;
  for (var i = 0; i < anchors.length; i++) {
    var result = analyzeLink(anchors[i].href);
    if (result) {
      var exists = false;
      for (var j = 0; j < items.length; j++) {
        if (items[j].href === result.href) { exists = true; break; }
      }
      if (!exists) items.push(result);
    }
  }
  sendResults();
}

function scanElement(el) {
  if (el.tagName !== "A" || !el.href) return;
  var result = analyzeLink(el.href);
  if (!result) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].href === result.href) return;
  }
  items.push(result);
  sendResults();
}

function sendResults() {
  totalAnchors = document.querySelectorAll("a[href]").length;
  var wrappers = 0;
  var tracked = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].isRedirectWrapper) wrappers++;
    if (items[i].trackingParams.length > 0) tracked++;
  }

  chrome.runtime.sendMessage({
    type: "detection",
    module: "linked",
    data: {
      domain: location.hostname,
      url: location.href,
      timestamp: Date.now(),
      items: items,
      totals: { wrappers: wrappers, tracked: tracked, total: items.length, allLinks: totalAnchors },
    }
  });
}

// ── Init ──

scanLinks();

window.addEventListener("pageshow", function (e) {
  if (e.persisted) sendResults();
});

var observer = new MutationObserver(function (mutations) {
  for (var i = 0; i < mutations.length; i++) {
    var nodes = mutations[i].addedNodes;
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      if (node.nodeType !== 1) continue;
      scanElement(node);
      var links = node.querySelectorAll ? node.querySelectorAll("a[href]") : [];
      for (var k = 0; k < links.length; k++) {
        scanElement(links[k]);
      }
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });

})();
