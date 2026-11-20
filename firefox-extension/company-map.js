"use strict";

// Shared domain → company table. Loaded by detect-cooked.js (content script,
// via manifest) and by the service worker (importScripts) so both attribute
// from ONE list. Also holds the sub-brand → parent relation and the helpers
// the scoper, blur credit and Watchers table share.
(function () {

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

self.WH_COMPANY_MAP = COMPANY_MAP;

var _names = null;
function names() {
  if (_names) return _names;
  _names = {};
  for (var k in COMPANY_MAP) _names[COMPANY_MAP[k].name.toLowerCase()] = COMPANY_MAP[k].name;
  return _names;
}

// Sub-brands the name rules below can't see: the parent isn't a prefix of the
// name, or isn't itself a name in the table. Keyed by lowercased name; also
// matches "<alias> <anything>" (e.g. "Facebook Pixel").
var PARENT_ALIASES = {
  "facebook": "Meta",
  "x (twitter)": "X",
  "oracle (bluekai)": "Oracle",
  "moat (oracle)": "Oracle",
  "pardot": "Salesforce",
};

// Parent of a sub-brand: explicit aliases first, then derived from the names
// themselves: "Google Ads" -> "Google" (name starts with another known name +
// space), "YouTube (Google)" / "Taobao (Alibaba)" -> the parenthesised owner.
// The derived parent must itself be a known company name; single level.
// Returns null for top-level names.
self.WH_companyParent = function (name) {
  if (!name) return null;
  var n = names(), lower = String(name).toLowerCase(), best = null, k;
  for (k in PARENT_ALIASES) {
    if (lower === k || lower.indexOf(k + " ") === 0) return PARENT_ALIASES[k];
  }
  for (k in n) {
    if (k === lower) continue;
    if (lower.indexOf(k + " ") === 0 && (!best || k.length > best.length)) best = k;
  }
  if (best) return n[best];
  var m = /\(([^)]+)\)\s*$/.exec(lower);
  if (m && n[m[1]] && m[1] !== lower) return n[m[1]];
  return null;
};

// Group key + display name a watcher rolls up under (its parent, else itself).
self.WH_watcherGroup = function (name) {
  var p = self.WH_companyParent(name) || name;
  return { key: String(p).toLowerCase(), name: p };
};

// { registrableDomain: companyName } seeded from COMPANY_MAP using the
// caller-supplied eTLD+1 helper (each context keeps its own, honouring
// WH_PUBLIC_SUFFIX). Exact registrable keys win over subdomain keys.
self.WH_seedDomainCompany = function (etld1Fn) {
  var out = {}, keys = Object.keys(COMPANY_MAP).sort(function (a, b) { return a.split(".").length - b.split(".").length; });
  for (var i = 0; i < keys.length; i++) {
    var e = etld1Fn(keys[i]);
    if (e && !(e in out)) out[e] = COMPANY_MAP[keys[i]].name;
  }
  return out;
};

// Build the Watchers table from per-parent groups (snapshots.js `groups`:
// { key: { name, hits, mech } }, hits already a union over members' visits).
// Stored per-company counters are credited to the parent at write time, so a
// parent's number already includes its sub-brands since that change; old
// standalone sub-brand counts are NOT re-attributed and fall into
// "everything else" via the residual. Top `limit` groups by reach are kept;
// those with trimmed and blurred both 0 go to `quiet` (no row). The else row
// is lifetime total minus the shown rows, clamped at 0, so the columns add up.
// Falls back to rolling snap.watchers up by parent (hits = max over members,
// a lower bound) when the snapshot predates `groups`.
self.WH_buildWatcherRows = function (snap, byTrimmed, byBlurred, trimmedTotal, blurredTotal, limit) {
  var groups = snap && snap.groups, k;
  if (!groups) {
    groups = {};
    var ws = (snap && snap.watchers) || {};
    for (k in ws) {
      var g = self.WH_watcherGroup(ws[k].name || k), cur = groups[g.key];
      if (!cur) cur = groups[g.key] = { name: g.name, hits: 0, mech: { cookies: 0, pixels: 0, clicks: 0, deviceId: 0 } };
      cur.hits = Math.max(cur.hits, ws[k].hits || 0);
      for (var m in cur.mech) cur.mech[m] += (ws[k].mech && ws[k].mech[m]) || 0;
    }
  }
  var ranked = Object.keys(groups).map(function (key) {
    var g = groups[key];
    return { key: key, name: g.name, hits: g.hits || 0, mech: g.mech || {},
      trimmed: (byTrimmed && byTrimmed[key] && byTrimmed[key].tightened) || 0,
      blurred: (byBlurred && byBlurred[key] && byBlurred[key].count) || 0 };
  }).sort(function (a, b) { return b.hits - a.hits || a.name.localeCompare(b.name); }).slice(0, limit || 12);
  var rows = [], quiet = [], sumT = 0, sumB = 0;
  ranked.forEach(function (r) {
    if (r.trimmed === 0 && r.blurred === 0) { quiet.push(r.name); return; }
    rows.push(r); sumT += r.trimmed; sumB += r.blurred;
  });
  quiet.sort(function (a, b) { return a.localeCompare(b); });
  return { rows: rows, quiet: quiet,
    elseTrimmed: Math.max(0, (trimmedTotal || 0) - sumT),
    elseBlurred: Math.max(0, (blurredTotal || 0) - sumB) };
};

})();
