"use strict";

// Domain → company name + purpose
var COMPANY_MAP = {
  // Google
  "google-analytics.com": { name: "Google Analytics", purpose: "Analytics" },
  "googletagmanager.com": { name: "Google Tag Manager", purpose: "Analytics" },
  "doubleclick.net": { name: "Google Ads", purpose: "Advertising" },
  "googlesyndication.com": { name: "Google Ads", purpose: "Advertising" },
  "googleadservices.com": { name: "Google Ads", purpose: "Advertising" },
  "google.com": { name: "Google", purpose: "Analytics" },
  "youtube.com": { name: "YouTube (Google)", purpose: "Advertising" },
  "ytimg.com": { name: "YouTube (Google)", purpose: "Advertising" },
  "googlevideo.com": { name: "YouTube (Google)", purpose: "Advertising" },
  "gstatic.com": { name: "Google", purpose: "Infrastructure" },
  "googleapis.com": { name: "Google", purpose: "Infrastructure" },
  "ggpht.com": { name: "Google", purpose: "Infrastructure" },
  // Facebook / Meta
  "facebook.net": { name: "Meta", purpose: "Advertising" },
  "facebook.com": { name: "Meta", purpose: "Advertising" },
  "fbcdn.net": { name: "Meta", purpose: "Advertising" },
  // LinkedIn
  "linkedin.com": { name: "LinkedIn", purpose: "Advertising" },
  "licdn.com": { name: "LinkedIn", purpose: "Advertising" },
  // Microsoft / Bing
  "bing.com": { name: "Microsoft Ads", purpose: "Advertising" },
  "msn.com": { name: "Microsoft", purpose: "Advertising" },
  "live.com": { name: "Microsoft", purpose: "Analytics" },
  // Twitter / X
  "twitter.com": { name: "X (Twitter)", purpose: "Advertising" },
  "t.co": { name: "X (Twitter)", purpose: "Advertising" },
  "twimg.com": { name: "X (Twitter)", purpose: "Advertising" },
  // TikTok
  "tiktok.com": { name: "TikTok", purpose: "Advertising" },
  "byteoversea.com": { name: "TikTok", purpose: "Advertising" },
  "tiktokcdn.com": { name: "TikTok", purpose: "CDN" },
  // Pinterest
  "pinterest.com": { name: "Pinterest", purpose: "Advertising" },
  "pinimg.com": { name: "Pinterest", purpose: "Advertising" },
  // Snap
  "snapchat.com": { name: "Snapchat", purpose: "Advertising" },
  "sc-static.net": { name: "Snapchat", purpose: "Advertising" },
  // Analytics
  "hotjar.com": { name: "Hotjar", purpose: "Analytics" },
  "clarity.ms": { name: "Microsoft Clarity", purpose: "Analytics" },
  "fullstory.com": { name: "FullStory", purpose: "Analytics" },
  "segment.io": { name: "Segment", purpose: "Analytics" },
  "segment.com": { name: "Segment", purpose: "Analytics" },
  "mixpanel.com": { name: "Mixpanel", purpose: "Analytics" },
  "amplitude.com": { name: "Amplitude", purpose: "Analytics" },
  "newrelic.com": { name: "New Relic", purpose: "Analytics" },
  "nr-data.net": { name: "New Relic", purpose: "Analytics" },
  "optimizely.com": { name: "Optimizely", purpose: "Analytics" },
  "bounceexchange.com": { name: "Bounce Exchange", purpose: "Analytics" },
  "permutive.com": { name: "Permutive", purpose: "Analytics" },
  "chartbeat.com": { name: "Chartbeat", purpose: "Analytics" },
  "scorecardresearch.com": { name: "Comscore", purpose: "Analytics" },
  "quantserve.com": { name: "Quantcast", purpose: "Analytics" },
  "heap.io": { name: "Heap", purpose: "Analytics" },
  "heapanalytics.com": { name: "Heap", purpose: "Analytics" },
  "mouseflow.com": { name: "Mouseflow", purpose: "Analytics" },
  "crazyegg.com": { name: "Crazy Egg", purpose: "Analytics" },
  "contentsquare.com": { name: "Contentsquare", purpose: "Analytics" },
  "matomo.org": { name: "Matomo", purpose: "Analytics" },
  "plausible.io": { name: "Plausible", purpose: "Analytics" },
  "posthog.com": { name: "PostHog", purpose: "Analytics" },
  "pendo.io": { name: "Pendo", purpose: "Analytics" },
  "walkme.com": { name: "WalkMe", purpose: "Analytics" },
  "userpilot.com": { name: "Userpilot", purpose: "Analytics" },
  "appcues.com": { name: "Appcues", purpose: "Analytics" },
  // Error tracking
  "sentry.io": { name: "Sentry", purpose: "Error tracking" },
  "bugsnag.com": { name: "Bugsnag", purpose: "Error tracking" },
  // Advertising
  "outbrain.com": { name: "Outbrain", purpose: "Advertising" },
  "taboola.com": { name: "Taboola", purpose: "Advertising" },
  "criteo.com": { name: "Criteo", purpose: "Advertising" },
  "adsrvr.org": { name: "The Trade Desk", purpose: "Advertising" },
  "adnxs.com": { name: "Microsoft Advertising", purpose: "Advertising" },
  "rubiconproject.com": { name: "Magnite (Rubicon)", purpose: "Advertising" },
  "pubmatic.com": { name: "PubMatic", purpose: "Advertising" },
  "openx.net": { name: "OpenX", purpose: "Advertising" },
  "casalemedia.com": { name: "Index Exchange", purpose: "Advertising" },
  "indexww.com": { name: "Index Exchange", purpose: "Advertising" },
  "amazon-adsystem.com": { name: "Amazon Ads", purpose: "Advertising" },
  "amazonaax.com": { name: "Amazon Ads", purpose: "Advertising" },
  "assoc-amazon.com": { name: "Amazon Ads", purpose: "Advertising" },
  "amazon.com": { name: "Amazon", purpose: "Analytics" },
  "ssl-images-amazon.com": { name: "Amazon", purpose: "Content" },
  "media-amazon.com": { name: "Amazon", purpose: "Content" },
  "cloudfront.net": { name: "Amazon CloudFront", purpose: "CDN" },
  "amazonaws.com": { name: "Amazon AWS", purpose: "Infrastructure" },
  "advertising.com": { name: "Yahoo Advertising", purpose: "Advertising" },
  "bidswitch.net": { name: "BidSwitch", purpose: "Advertising" },
  "sharethrough.com": { name: "Sharethrough", purpose: "Advertising" },
  "33across.com": { name: "33Across", purpose: "Advertising" },
  "lijit.com": { name: "Sovrn", purpose: "Advertising" },
  "sovrn.com": { name: "Sovrn", purpose: "Advertising" },
  "media.net": { name: "Media.net", purpose: "Advertising" },
  "btloader.com": { name: "BidTellect", purpose: "Advertising" },
  "safeframe.googlesyndication.com": { name: "Google Ads", purpose: "Advertising" },
  "moatads.com": { name: "Moat (Oracle)", purpose: "Advertising" },
  "doubleverify.com": { name: "DoubleVerify", purpose: "Advertising" },
  "adsymptotic.com": { name: "Adsymptotic", purpose: "Advertising" },
  "liadm.com": { name: "LiveIntent", purpose: "Advertising" },
  "intentiq.com": { name: "IntentIQ", purpose: "Advertising" },
  "id5-sync.com": { name: "ID5", purpose: "Advertising" },
  "yieldmo.com": { name: "Yieldmo", purpose: "Advertising" },
  "triplelift.com": { name: "TripleLift", purpose: "Advertising" },
  "smartadserver.com": { name: "Smart AdServer", purpose: "Advertising" },
  "teads.tv": { name: "Teads", purpose: "Advertising" },
  "zemanta.com": { name: "Zemanta", purpose: "Advertising" },
  "revcontent.com": { name: "RevContent", purpose: "Advertising" },
  "nativo.com": { name: "Nativo", purpose: "Advertising" },
  "stackadapt.com": { name: "StackAdapt", purpose: "Advertising" },
  "adroll.com": { name: "AdRoll", purpose: "Advertising" },
  "retargetly.com": { name: "Retargetly", purpose: "Advertising" },
  // Adobe
  "omtrdc.net": { name: "Adobe Analytics", purpose: "Analytics" },
  "2o7.net": { name: "Adobe Analytics", purpose: "Analytics" },
  "adobedtm.com": { name: "Adobe Tag Manager", purpose: "Analytics" },
  // Data brokers / Identity
  "bluekai.com": { name: "Oracle (BlueKai)", purpose: "Data broker" },
  "demdex.net": { name: "Adobe Audience Manager", purpose: "Data broker" },
  "krxd.net": { name: "Salesforce (Krux)", purpose: "Data broker" },
  "rlcdn.com": { name: "LiveRamp", purpose: "Data broker" },
  "pippio.com": { name: "LiveRamp", purpose: "Data broker" },
  "exelator.com": { name: "Nielsen", purpose: "Data broker" },
  "agkn.com": { name: "Neustar", purpose: "Data broker" },
  "tapad.com": { name: "Tapad", purpose: "Data broker" },
  "liveramp.com": { name: "LiveRamp", purpose: "Data broker" },
  "zeotap.com": { name: "Zeotap", purpose: "Data broker" },
  "lotame.com": { name: "Lotame", purpose: "Data broker" },
  "bombora.com": { name: "Bombora", purpose: "Data broker" },
  "6sense.com": { name: "6sense", purpose: "Data broker" },
  "clearbit.com": { name: "Clearbit", purpose: "Data broker" },
  "zoominfo.com": { name: "ZoomInfo", purpose: "Data broker" },
  // Consent / Privacy
  "onetrust.com": { name: "OneTrust", purpose: "Consent" },
  "cookielaw.org": { name: "OneTrust", purpose: "Consent" },
  "trustarc.com": { name: "TrustArc", purpose: "Consent" },
  "evidon.com": { name: "Evidon", purpose: "Consent" },
  "consensu.org": { name: "IAB Consent", purpose: "Consent" },
  // CDN / Infra
  "akamaihd.net": { name: "Akamai", purpose: "CDN" },
  "fastly.net": { name: "Fastly", purpose: "CDN" },
  "edgecastcdn.net": { name: "Edgecast", purpose: "CDN" },
  // Customer engagement
  "hubspot.com": { name: "HubSpot", purpose: "Marketing" },
  "hsforms.com": { name: "HubSpot", purpose: "Marketing" },
  "marketo.com": { name: "Marketo", purpose: "Marketing" },
  "mktoresp.com": { name: "Marketo", purpose: "Marketing" },
  "pardot.com": { name: "Pardot", purpose: "Marketing" },
  "salesforce.com": { name: "Salesforce", purpose: "Marketing" },
  "intercom.io": { name: "Intercom", purpose: "Marketing" },
  "drift.com": { name: "Drift", purpose: "Marketing" },
  "zendesk.com": { name: "Zendesk", purpose: "Customer support" },
  // Chinese / Asian ad-tech & analytics
  "baidu.com": { name: "Baidu", purpose: "Analytics" },
  "hm.baidu.com": { name: "Baidu Analytics", purpose: "Analytics" },
  "cnzz.com": { name: "CNZZ (Umeng)", purpose: "Analytics" },
  "umeng.com": { name: "Umeng", purpose: "Analytics" },
  "growingio.com": { name: "GrowingIO", purpose: "Analytics" },
  "sensorsdata.cn": { name: "Sensors Data", purpose: "Analytics" },
  "sensorsdata.com": { name: "Sensors Data", purpose: "Analytics" },
  "aldwx.com": { name: "Aldwx", purpose: "Analytics" },
  "alipay.com": { name: "Alipay", purpose: "Advertising" },
  "alicdn.com": { name: "Alibaba", purpose: "Advertising" },
  "alibaba.com": { name: "Alibaba", purpose: "Advertising" },
  "taobao.com": { name: "Taobao (Alibaba)", purpose: "Advertising" },
  "mmstat.com": { name: "Alibaba Analytics", purpose: "Analytics" },
  "tanx.com": { name: "Alibaba Tanx", purpose: "Advertising" },
  "tencent.com": { name: "Tencent", purpose: "Analytics" },
  "qq.com": { name: "Tencent QQ", purpose: "Analytics" },
  "weibo.com": { name: "Weibo", purpose: "Advertising" },
  "weibocdn.com": { name: "Weibo", purpose: "Advertising" },
  "bytedance.com": { name: "ByteDance", purpose: "Advertising" },
  "snssdk.com": { name: "ByteDance", purpose: "Advertising" },
  "pstatp.com": { name: "ByteDance", purpose: "Advertising" },
  "oceanengine.com": { name: "Ocean Engine (ByteDance)", purpose: "Advertising" },
  "jd.com": { name: "JD.com", purpose: "Advertising" },
  "360.cn": { name: "Qihoo 360", purpose: "Analytics" },
  // Mobile attribution
  "branch.io": { name: "Branch", purpose: "Analytics" },
  "app.link": { name: "Branch", purpose: "Analytics" },
  "adjust.com": { name: "Adjust", purpose: "Analytics" },
  "appsflyer.com": { name: "AppsFlyer", purpose: "Analytics" },
  "onelink.me": { name: "AppsFlyer", purpose: "Analytics" },
  "singular.net": { name: "Singular", purpose: "Analytics" },
  "kochava.com": { name: "Kochava", purpose: "Analytics" },
  // Marketing / engagement
  "braze.com": { name: "Braze", purpose: "Marketing" },
  "braze.eu": { name: "Braze", purpose: "Marketing" },
  "klaviyo.com": { name: "Klaviyo", purpose: "Marketing" },
  "attentivemobile.com": { name: "Attentive", purpose: "Marketing" },
  "iterable.com": { name: "Iterable", purpose: "Marketing" },
  "customer.io": { name: "Customer.io", purpose: "Marketing" },
  "pushwoosh.com": { name: "Pushwoosh", purpose: "Marketing" },
  "onesignal.com": { name: "OneSignal", purpose: "Marketing" },
  "airship.com": { name: "Airship", purpose: "Marketing" },
  "urbanairship.com": { name: "Airship", purpose: "Marketing" },
  "leanplum.com": { name: "Leanplum", purpose: "Marketing" },
  "moengage.com": { name: "MoEngage", purpose: "Marketing" },
  "clevertap.com": { name: "CleverTap", purpose: "Marketing" },
  "webengage.com": { name: "WebEngage", purpose: "Marketing" },
  // Tag management
  "tealiumiq.com": { name: "Tealium", purpose: "Analytics" },
  "tealium.com": { name: "Tealium", purpose: "Analytics" },
  "ensighten.com": { name: "Ensighten", purpose: "Analytics" },
  "commandersact.com": { name: "Commanders Act", purpose: "Analytics" },
  "tagcommander.com": { name: "Commanders Act", purpose: "Analytics" },
  // Monitoring / Performance
  "datadoghq.com": { name: "Datadog", purpose: "Analytics" },
  "datadoghq.eu": { name: "Datadog", purpose: "Analytics" },
  "dynatrace.com": { name: "Dynatrace", purpose: "Analytics" },
  "speedcurve.com": { name: "SpeedCurve", purpose: "Analytics" },
  "adobedc.net": { name: "Adobe", purpose: "Analytics" },
  "launchdarkly.com": { name: "LaunchDarkly", purpose: "Analytics" },
  // A/B testing / Personalization
  "vwo.com": { name: "VWO", purpose: "Analytics" },
  "kameleoon.com": { name: "Kameleoon", purpose: "Analytics" },
  "ab-tasty.com": { name: "AB Tasty", purpose: "Analytics" },
  "dynamicyield.com": { name: "Dynamic Yield", purpose: "Analytics" },
  // Fraud / Bot detection
  "forter.com": { name: "Forter", purpose: "Analytics" },
  "perimeterx.net": { name: "PerimeterX", purpose: "Analytics" },
  "shape.com": { name: "Shape Security", purpose: "Analytics" },
  "datadome.co": { name: "DataDome", purpose: "Analytics" },
  "arkoselabs.com": { name: "Arkose Labs", purpose: "Analytics" },
  // Affiliate / Referral
  "shareasale.com": { name: "ShareASale", purpose: "Advertising" },
  "cj.com": { name: "CJ Affiliate", purpose: "Advertising" },
  "awin1.com": { name: "Awin", purpose: "Advertising" },
  "pepperjam.com": { name: "Pepperjam", purpose: "Advertising" },
  "impact.com": { name: "Impact", purpose: "Advertising" },
  "partnerize.com": { name: "Partnerize", purpose: "Advertising" },
  "refersion.com": { name: "Refersion", purpose: "Advertising" },
  "rakuten.com": { name: "Rakuten", purpose: "Advertising" },
  "linksynergy.com": { name: "Rakuten", purpose: "Advertising" },
};

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

function scanPixels() {
  var imgs = document.querySelectorAll("img");
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i];
    var src = img.src;
    if (!src || src.startsWith("data:") || src.endsWith(".svg")) continue;

    var isSmall = (img.naturalWidth <= 1 && img.naturalHeight <= 1) ||
                  (img.width <= 1 && img.height <= 1) ||
                  img.getAttribute("width") === "0" || img.getAttribute("width") === "1" ||
                  img.getAttribute("height") === "0" || img.getAttribute("height") === "1";
    var hidden = isHidden(img);
    var pixelPath = PIXEL_PATH_PATTERNS.test(src);
    var tracker = isKnownTracker(getDomain(src));

    if (tracker && (isSmall || hidden || pixelPath)) {
      addItem("pixel", src);
    } else if (!tracker && (isSmall || hidden) && pixelPath) {
      addItem("pixel", src);
    }
  }
}

function scanIframes() {
  var iframes = document.querySelectorAll("iframe");
  for (var i = 0; i < iframes.length; i++) {
    var iframe = iframes[i];
    var src = iframe.src;
    if (!src) continue;

    var domain = getDomain(src);
    if (domain === location.hostname) continue;

    var w = parseInt(iframe.getAttribute("width") || iframe.offsetWidth, 10) || 0;
    var h = parseInt(iframe.getAttribute("height") || iframe.offsetHeight, 10) || 0;
    var isSmall = w <= 1 || h <= 1;
    var hidden = isHidden(iframe);
    var tracker = isKnownTracker(domain);

    if ((isSmall || hidden) && (tracker || matchUrlPattern(src))) {
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
    var isSmall = (el.naturalWidth <= 1 && el.naturalHeight <= 1) ||
                  (el.width <= 1 && el.height <= 1);
    var hidden = isHidden(el);
    var pixelPath = PIXEL_PATH_PATTERNS.test(src);
    var tracker = isKnownTracker(getDomain(src));
    var isPixel = tracker ? (isSmall || hidden || pixelPath) : ((isSmall || hidden) && pixelPath);
    if (isPixel) {
      addItem("pixel", src);
      sendResults();
    }
  } else if (el.tagName === "IFRAME") {
    var iframeSrc = el.src;
    if (!iframeSrc) return;
    var domain = getDomain(iframeSrc);
    if (domain === location.hostname) return;
    var w = parseInt(el.getAttribute("width") || el.offsetWidth, 10) || 0;
    var h = parseInt(el.getAttribute("height") || el.offsetHeight, 10) || 0;
    var iframeTracker = isKnownTracker(domain);
    if ((w <= 1 || h <= 1 || isHidden(el)) && (iframeTracker || matchUrlPattern(iframeSrc))) {
      addItem("iframe", iframeSrc);
      sendResults();
    }
  } else if (el.tagName === "LINK") {
    var rel = (el.getAttribute("rel") || "").toLowerCase();
    if (rel === "prefetch" || rel === "preconnect" || rel === "dns-prefetch") {
      var href = el.href;
      if (href && isKnownTracker(getDomain(href))) {
        addItem("prefetch", href);
        sendResults();
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
    observer.disconnect();
    window.removeEventListener("message", onBeaconMessage);
  }
}

function onBeaconMessage(event) {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "__wearecounted_beacon__") return;

  addItem("beacon", event.data.url);
  sendResults();
}

window.addEventListener("message", onBeaconMessage);

var observer = new MutationObserver(function (mutations) {
  for (var i = 0; i < mutations.length; i++) {
    var nodes = mutations[i].addedNodes;
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      if (node.nodeType !== 1) continue;
      scanElement(node);
      var children = node.querySelectorAll ? node.querySelectorAll("img, iframe, link") : [];
      for (var k = 0; k < children.length; k++) {
        scanElement(children[k]);
      }
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });

// No injectBeaconWrapper() — inject.js is manifest-loaded now
scanPixels();
scanIframes();
scanPrefetches();
sendResults();
