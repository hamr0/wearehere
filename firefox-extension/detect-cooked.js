"use strict";

(function () {

// Domain → company name + purpose (shared table, see company-map.js)
var COMPANY_MAP = self.WH_COMPANY_MAP;

var URL_PATTERN_MAP = [
  { pattern: /analytics\.js|gtag\/js|gtm\.js/i, name: "Google Analytics", purpose: "Analytics" },
  { pattern: /fbevents\.js|fbq/i, name: "Meta Pixel", purpose: "Advertising" },
  { pattern: /bat\.js|\/UET\//i, name: "Microsoft Ads", purpose: "Advertising" },
  { pattern: /insight\.min\.js|snap\.licdn\.com/i, name: "LinkedIn Insight", purpose: "Advertising" },
  { pattern: /\/pixel[./?]|\/track[./?]|\/beacon[./?]/i, name: "Tracking Pixel", purpose: "Analytics" },
  { pattern: /\/collect[./?]|__utm/i, name: "Analytics Beacon", purpose: "Analytics" },
  { pattern: /\/ads\/|\/adserver|\/pagead\//i, name: "Ad Server", purpose: "Advertising" },
  { pattern: /\/conversion[./?]|\/rtb[./?]|\/bid[./?]/i, name: "Ad Exchange", purpose: "Advertising" },
];

function matchUrlPattern(url) {
  for (var i = 0; i < URL_PATTERN_MAP.length; i++) {
    if (URL_PATTERN_MAP[i].pattern.test(url)) return URL_PATTERN_MAP[i];
  }
  return null;
}

var PIXEL_PATH_PATTERNS = /\/pixel|\/track|\/beacon|\/collect|\/t\.gif|\/p\.gif|\/\.gif|__utm\.gif/i;
var MAX_ELEMENTS = 500;

var items = [];
var totals = { pixels: 0, iframes: 0, beacons: 0, prefetches: 0, total: 0 };
var dirty = false;
var sentOnce = false;
var pendingBeacons = [];
var seenEls = new WeakSet();

function getDomain(urlStr) {
  try {
    return new URL(urlStr).hostname;
  } catch (e) {
    return "";
  }
}

function lookupCompany(domain) {
  var parts = domain.split(".");
  for (var i = 0; i < parts.length - 1; i++) {
    var candidate = parts.slice(i).join(".");
    if (COMPANY_MAP[candidate]) return COMPANY_MAP[candidate];
  }
  return null;
}

function isKnownTracker(domain) {
  return lookupCompany(domain) !== null;
}

function isHidden(el) {
  var style = window.getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}

function addItem(type, url) {
  if (totals.total >= MAX_ELEMENTS) return;
  var domain = getDomain(url);
  if (!domain) return;

  for (var i = 0; i < items.length; i++) {
    if (items[i].type === type && items[i].src === url) return;
  }

  var company = lookupCompany(domain) || matchUrlPattern(url);
  items.push({
    type: type,
    src: url,
    domain: domain,
    company: company ? company.name : domain,
    purpose: company ? company.purpose : "Unknown",
  });
  totals[type + "s"] = (totals[type + "s"] || 0) + 1;
  totals.total++;
}

function* scanPixels() {
  var imgs = document.querySelectorAll("img");
  for (var i = 0; i < imgs.length; i++) {
    if (i % 16 === 15) yield;
    var img = imgs[i];
    var src = img.src;
    if (!src || src.startsWith("data:") || src.endsWith(".svg")) continue;

    // Cheap string checks first. Both branches below need a known tracker
    // or a pixel-ish path, so an ordinary content image (every product
    // photo on a catalog page) exits here without the layout/style reads.
    var pixelPath = PIXEL_PATH_PATTERNS.test(src);
    var tracker = isKnownTracker(getDomain(src));
    if (!tracker && !pixelPath) continue;

    var isSmall = (img.naturalWidth <= 1 && img.naturalHeight <= 1) ||
                  (img.width <= 1 && img.height <= 1) ||
                  img.getAttribute("width") === "0" || img.getAttribute("width") === "1" ||
                  img.getAttribute("height") === "0" || img.getAttribute("height") === "1";
    var hidden = isHidden(img);

    if (tracker && (isSmall || hidden || pixelPath)) {
      addItem("pixel", src);
    } else if (!tracker && (isSmall || hidden) && pixelPath) {
      addItem("pixel", src);
    }
  }
}

function* scanIframes() {
  var iframes = document.querySelectorAll("iframe");
  for (var i = 0; i < iframes.length; i++) {
    if (i % 16 === 15) yield;
    var iframe = iframes[i];
    var src = iframe.src;
    if (!src) continue;

    var domain = getDomain(src);
    if (domain === location.hostname) continue;
    // Only trackers count, so decide that before offsetWidth/computed style.
    if (!isKnownTracker(domain) && !matchUrlPattern(src)) continue;

    var w = parseInt(iframe.getAttribute("width") || iframe.offsetWidth, 10) || 0;
    var h = parseInt(iframe.getAttribute("height") || iframe.offsetHeight, 10) || 0;
    var isSmall = w <= 1 || h <= 1;
    var hidden = isHidden(iframe);

    if (isSmall || hidden) {
      addItem("iframe", src);
    }
  }
}

function scanPrefetches() {
  var links = document.querySelectorAll('link[rel="prefetch"], link[rel="preconnect"], link[rel="dns-prefetch"]');
  for (var i = 0; i < links.length; i++) {
    var href = links[i].href;
    if (!href) continue;
    var domain = getDomain(href);
    if (isKnownTracker(domain)) {
      addItem("prefetch", href);
    }
  }
}

function scanElement(el) {
  if (el.tagName === "IMG") {
    var src = el.src;
    if (!src || src.startsWith("data:") || src.endsWith(".svg")) return;
    // Cheap checks first: el.width forces layout and getComputedStyle forces
    // a style flush. Run on every added image during infinite scroll, those
    // were the extension's single longest main-thread task. Neither can turn
    // a non-tracker, non-pixel-path image into a hit, so skip them.
    var pixelPath = PIXEL_PATH_PATTERNS.test(src);
    var tracker = isKnownTracker(getDomain(src));
    if (!tracker && !pixelPath) return;
    var isSmall = (el.naturalWidth <= 1 && el.naturalHeight <= 1) ||
                  (el.width <= 1 && el.height <= 1);
    var hidden = isHidden(el);
    var isPixel = tracker ? (isSmall || hidden || pixelPath) : ((isSmall || hidden) && pixelPath);
    if (isPixel) {
      addItem("pixel", src);
      dirty = true;
    }
  } else if (el.tagName === "IFRAME") {
    var iframeSrc = el.src;
    if (!iframeSrc) return;
    var domain = getDomain(iframeSrc);
    if (domain === location.hostname) return;
    if (!isKnownTracker(domain) && !matchUrlPattern(iframeSrc)) return;
    var w = parseInt(el.getAttribute("width") || el.offsetWidth, 10) || 0;
    var h = parseInt(el.getAttribute("height") || el.offsetHeight, 10) || 0;
    if (w <= 1 || h <= 1 || isHidden(el)) {
      addItem("iframe", iframeSrc);
      dirty = true;
    }
  } else if (el.tagName === "LINK") {
    var rel = (el.getAttribute("rel") || "").toLowerCase();
    if (rel === "prefetch" || rel === "preconnect" || rel === "dns-prefetch") {
      var href = el.href;
      if (href && isKnownTracker(getDomain(href))) {
        addItem("prefetch", href);
        dirty = true;
      }
    }
  }
}

function sendResults() {
  try {
    chrome.runtime.sendMessage({
      type: "detection",
      module: "cooked",
      data: {
        domain: location.hostname,
        url: location.href,
        timestamp: Date.now(),
        items: items,
        totals: totals,
      }
    });
  } catch (e) {
    whSettle.stop();
    window.removeEventListener("message", onBeaconMessage);
  }
}

// Reporting only: the listener stays immediate (inject.js posts beacons while the
// page runs) but just queues the URL; counting and messaging wait for settle.
function onBeaconMessage(event) {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "__wearecounted_beacon__") return;
  if (pendingBeacons.length < MAX_ELEMENTS) pendingBeacons.push(event.data.url);
  whSettle.schedule(cookedJob);
}

window.addEventListener("message", onBeaconMessage);

// Added nodes are only queued while the page is busy; scanned at settle.
var feed = whSettle.feed(function () { whSettle.schedule(cookedJob); });

var cookedFinal = false;   // true once the current round has sent its final message

function applyBeacons() {
  var beacons = pendingBeacons;
  pendingBeacons = [];
  for (var b = 0; b < beacons.length; b++) {
    addItem("beacon", beacons[b]);
    dirty = true;
  }
}

function* cookedJob() {
  cookedFinal = false;
  var batch = feed.take();
  if (batch.full) {
    yield* scanPixels();
    yield* scanIframes();
    scanPrefetches();
  } else {
    var n = 0;
    for (var el of whSettle.matches(batch, "img, iframe, link", seenEls, true)) {
      scanElement(el);
      if (++n % 16 === 0) yield;
    }
  }
  applyBeacons();
  if (dirty || !sentOnce) {
    dirty = false;
    sentOnce = true;
    sendResults();
  }
  cookedFinal = true;
}

// Leaving: send what is counted so far (pixels/iframes found by the quick pass).
whSettle.onLeave(function () {
  if (cookedFinal) return;
  applyBeacons();
  if (!totals.total) return;   // only report finds, never an unscanned zero
  sentOnce = true;
  dirty = false;
  sendResults();
});

// No injectBeaconWrapper() — inject.js is manifest-loaded now
whSettle.schedule(cookedJob);

})();
