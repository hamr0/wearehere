/**
 * content.js — Runs at document_start.
 * 1. Listens for fingerprinting/beacon relays from inject.js (MAIN world)
 * 2. On page load, scans DOM for trackers, dark patterns, storage, links
 * 3. Sends everything to background.js
 *
 * Module sources:
 *   Tracker domains  → wearecooked v4.0.0 (COMPANY_MAP + lookupCompany)
 *   Dark patterns    → weareplayed v0.1.0 (heuristics)
 *   Storage patterns → weareleaking v0.2.0 (SUSPICIOUS_PATTERNS + classifyItem)
 *   Link tracking    → wearelinked v0.3.0 (TRACKING_PARAMS)
 *   Form scanning    → wearesilent v0.1.0 (getAriaLabel + field detection, Method B passive)
 */

// inject.js runs in MAIN world via manifest — no manual injection needed.

// --- Collected data ---
const scanData = {
  fingerprinting: [],
  beacons: [],
  trackers: null,
  darkPatterns: null,
  storage: null,
  links: null,
  thirdPartyScripts: null,
  formFields: [],
};

// --- Phase 2: Listen for inject.js postMessage ---
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data?.__wearehere) return;
  if (e.data.fingerprinting) scanData.fingerprinting.push(...e.data.fingerprinting);
  if (e.data.beacons) scanData.beacons.push(...e.data.beacons);
  sendUpdate();
});

// --- Phase 3: DOM scan on load ---
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(scanPage, 500);
} else {
  window.addEventListener('load', () => setTimeout(scanPage, 500));
}

// Also re-scan after dynamic content loads
let scanCount = 0;
const observer = new MutationObserver(() => {
  scanCount++;
  if (scanCount === 50 || scanCount === 200) scanPage();
});

function startObserver() {
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

if (document.body) startObserver();
else document.addEventListener('DOMContentLoaded', startObserver);

// =============================================================================
// From wearecooked v4.0.0 — COMPANY_MAP + lookupCompany + URL_PATTERN_MAP
// =============================================================================
const COMPANY_MAP = {
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
  // Chinese / Asian ad-tech
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
  // A/B testing
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

// From wearecooked v4.0.0 — URL pattern fallback
const URL_PATTERN_MAP = [
  { pattern: /analytics\.js|gtag\/js|gtm\.js/i, name: "Google Analytics", purpose: "Analytics" },
  { pattern: /fbevents\.js|fbq/i, name: "Meta Pixel", purpose: "Advertising" },
  { pattern: /bat\.js|\/UET\//i, name: "Microsoft Ads", purpose: "Advertising" },
  { pattern: /insight\.min\.js|snap\.licdn\.com/i, name: "LinkedIn Insight", purpose: "Advertising" },
  { pattern: /\/pixel[./?]|\/track[./?]|\/beacon[./?]/i, name: "Tracking Pixel", purpose: "Analytics" },
  { pattern: /\/collect[./?]|__utm/i, name: "Analytics Beacon", purpose: "Analytics" },
  { pattern: /\/ads\/|\/adserver|\/pagead\//i, name: "Ad Server", purpose: "Advertising" },
  { pattern: /\/conversion[./?]|\/rtb[./?]|\/bid[./?]/i, name: "Ad Exchange", purpose: "Advertising" },
];

function lookupCompany(domain) {
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (COMPANY_MAP[candidate]) return COMPANY_MAP[candidate];
  }
  return null;
}

function matchUrlPattern(url) {
  for (const p of URL_PATTERN_MAP) {
    if (p.pattern.test(url)) return p;
  }
  return null;
}

// =============================================================================
// From weareplayed v0.1.0 — Dark pattern phrases
// =============================================================================
const SHAMING = [
  'no thanks, i don\'t want', 'no, i prefer to', 'i\'ll pass on',
  'no thanks, i\'d rather', 'i don\'t want to save', 'i prefer paying full price',
  'no, keep me uninformed', 'i don\'t like deals',
];
const URGENCY = [
  /only \d+ left/i, /\d+ people (?:are )?(?:viewing|looking|watching)/i,
  /limited time offer/i, /offer expires/i, /hurry/i, /act now/i,
  /don't miss out/i, /selling fast/i, /almost gone/i, /last chance/i,
  /ends (?:today|tonight|soon|in)/i, /while supplies last/i,
];
const TIMERS = [/\d+\s*:\s*\d+\s*:\s*\d+/, /\d+h\s*\d+m/, /\d+ hours? \d+ min/];

// =============================================================================
// From wearelinked v0.3.0 — Tracking params
// =============================================================================
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
  'mc_eid', 'mc_cid', '_hsenc', '_hsmi', 'twclid', 'igshid',
];

// =============================================================================
// From weareleaking v0.2.0 — Suspicious storage patterns with categories
// =============================================================================
const SUSPICIOUS_PATTERNS = [
  // Cross-site tracking
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
  // Advertising
  { pattern: /^IDE$|^DSID$|^NID$|^ANID$|^1P_JAR$/i, category: "Advertising" },
  { pattern: /__gads|__gpi|test_cookie|adroll/i, category: "Advertising" },
  { pattern: /doubleclick|googlesyndication|googlead/i, category: "Advertising" },
  { pattern: /fbclid|gclid|utm_/i, category: "Advertising" },
  { pattern: /rtbhouse|criteo|taboola|outbrain/i, category: "Advertising" },
  // Fingerprinting
  { pattern: /fingerprint|device_id|browser_id|machine_id/i, category: "Fingerprinting" },
  { pattern: /visitor_id|client_id|distinct_id/i, category: "Fingerprinting" },
  { pattern: /canvas_fingerprint|webgl_fingerprint|audio_fingerprint/i, category: "Fingerprinting" },
  // PII exposure
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i, category: "PII exposure", matchValue: true },
  // Generic tracking (UUIDs in values)
  { pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, category: "Tracking", matchValue: true },
];

function classifyStorageItem(key, value) {
  const flags = [];
  const seen = {};
  for (const p of SUSPICIOUS_PATTERNS) {
    if (p.matchValue) {
      if (p.pattern.test(value) && !seen[p.category]) { flags.push(p.category); seen[p.category] = true; }
    } else {
      if (p.pattern.test(key) && !seen[p.category]) { flags.push(p.category); seen[p.category] = true; }
    }
  }
  return flags;
}

// --- DOM scanning ---
function scanPage() {
  const pageHost = location.hostname;

  // 1. Tracking pixels & hidden iframes — identify by company name
  const pixels = [];
  const hiddenIframes = [];

  document.querySelectorAll('img').forEach(img => {
    const isPixel = (img.naturalWidth <= 1 && img.naturalHeight <= 1) ||
                    (img.width <= 1 && img.height <= 1) ||
                    img.style.display === 'none' || img.style.visibility === 'hidden' ||
                    (img.offsetWidth <= 1 && img.offsetHeight <= 1);
    if (isPixel && img.src) {
      let domain = '';
      try { domain = new URL(img.src).hostname; } catch {}
      if (domain) {
        const company = lookupCompany(domain) || matchUrlPattern(img.src);
        pixels.push({ src: img.src.substring(0, 200), domain, company });
      }
    }
  });

  document.querySelectorAll('iframe').forEach(iframe => {
    const isHidden = (iframe.width <= 1 || iframe.height <= 1) ||
                     iframe.style.display === 'none' || iframe.style.visibility === 'hidden' ||
                     (iframe.offsetWidth <= 1 && iframe.offsetHeight <= 1);
    if (isHidden && iframe.src) {
      let domain = '';
      try { domain = new URL(iframe.src).hostname; } catch {}
      if (domain && domain !== pageHost) {
        const company = lookupCompany(domain);
        hiddenIframes.push({ src: iframe.src.substring(0, 200), domain, company });
      }
    }
  });

  // Only count known tracker pixels (have a company match)
  const trackerPixels = pixels.filter(p => p.company);

  // Build company list for display
  const allTrackerCompanies = {};
  for (const p of trackerPixels) {
    const key = p.company.name;
    if (!allTrackerCompanies[key]) allTrackerCompanies[key] = { ...p.company, count: 0 };
    allTrackerCompanies[key].count++;
  }
  for (const f of hiddenIframes) {
    if (!f.company) continue;
    const key = f.company.name;
    if (!allTrackerCompanies[key]) allTrackerCompanies[key] = { ...f.company, count: 0 };
    allTrackerCompanies[key].count++;
  }

  scanData.trackers = {
    pixels: trackerPixels.length,
    allHiddenImages: pixels.length,
    hiddenIframes: hiddenIframes.length,
    pixelDomains: [...new Set(trackerPixels.map(p => p.domain))].slice(0, 20),
    iframeDomains: [...new Set(hiddenIframes.map(i => i.domain))].slice(0, 20),
    companies: Object.values(allTrackerCompanies).sort((a, b) => b.count - a.count).slice(0, 20),
  };

  // 2. Third-party scripts — identify by company name
  const scripts = [];
  document.querySelectorAll('script[src]').forEach(s => {
    try {
      const url = new URL(s.src);
      if (url.hostname !== pageHost && !url.hostname.endsWith('.' + pageHost)) {
        const company = lookupCompany(url.hostname) || matchUrlPattern(s.src);
        scripts.push({ domain: url.hostname, src: s.src, company });
      }
    } catch {}
  });

  // Build company list for 3P scripts
  const scriptCompanies = {};
  for (const s of scripts) {
    if (!s.company) continue;
    const key = s.company.name;
    if (!scriptCompanies[key]) scriptCompanies[key] = { ...s.company, count: 0 };
    scriptCompanies[key].count++;
  }

  scanData.thirdPartyScripts = {
    total: scripts.length,
    domains: [...new Set(scripts.map(s => s.domain))].slice(0, 30),
    companies: Object.values(scriptCompanies).sort((a, b) => b.count - a.count).slice(0, 20),
  };

  // 3. Dark patterns (from weareplayed v0.1.0)
  const bodyText = document.body ? document.body.innerText : '';
  const bodyLower = bodyText.toLowerCase();
  const detected = [];
  let dpScore = 0;

  const clickableText = [];
  document.querySelectorAll('a, button, [role="button"]').forEach(el => {
    clickableText.push((el.textContent || '').trim().toLowerCase());
  });
  const shamingMatches = [];
  for (const phrase of SHAMING) {
    for (const text of clickableText) {
      if (text.includes(phrase)) shamingMatches.push(text.substring(0, 80));
    }
  }
  if (shamingMatches.length) { detected.push({ type: 'confirm_shaming', matches: shamingMatches.slice(0, 3) }); dpScore += 20; }

  const urgencyMatches = [];
  for (const re of URGENCY) {
    const m = bodyLower.match(re);
    if (m) urgencyMatches.push(m[0]);
  }
  if (urgencyMatches.length) { detected.push({ type: 'fake_urgency', matches: [...new Set(urgencyMatches)].slice(0, 3) }); dpScore += 20; }

  // Countdown timers — only flag if near urgency language (avoids video player timestamps)
  const timerMatches = [];
  for (const re of TIMERS) {
    const m = bodyText.match(re);
    if (m) {
      const idx = bodyText.indexOf(m[0]);
      const context = bodyText.substring(Math.max(0, idx - 300), Math.min(bodyText.length, idx + 300)).toLowerCase();
      const nearUrgency = URGENCY.some(u => u.test(context)) ||
        /hurry|limited|expires?|countdown|offer|deal|sale|left|remaining/i.test(context);
      if (nearUrgency) timerMatches.push(m[0]);
    }
  }
  if (timerMatches.length) { detected.push({ type: 'countdown_timer', matches: timerMatches.slice(0, 3) }); dpScore += 20; }

  const preChecked = [];
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (!cb.checked) return;
    const label = cb.closest('label')?.textContent?.trim() || cb.parentElement?.textContent?.trim() || '';
    if (/newsletter|marketing|subscribe|promo|agree|opt.?in|email/i.test(label)) {
      preChecked.push(label.substring(0, 80));
    }
  });
  if (preChecked.length) { detected.push({ type: 'pre_checked_boxes', matches: preChecked.slice(0, 3) }); dpScore += 20; }

  const hiddenUnsub = [];
  document.querySelectorAll('a, span').forEach(el => {
    const text = (el.textContent || '').trim().toLowerCase();
    if (text.includes('unsubscribe') || text.includes('opt out') || text.includes('opt-out')) {
      try {
        const fontSize = parseFloat(getComputedStyle(el).fontSize);
        if (fontSize < 10) hiddenUnsub.push(text.substring(0, 60));
      } catch {}
    }
  });
  if (hiddenUnsub.length) { detected.push({ type: 'hidden_unsubscribe', matches: hiddenUnsub.slice(0, 3) }); dpScore += 20; }

  scanData.darkPatterns = { score: Math.min(dpScore, 100), detected };

  // 4. Storage (from weareleaking v0.2.0 — categorized)
  function scanStorage(store, storeName) {
    const items = [];
    try {
      const len = Math.min(store.length, 500);
      for (let i = 0; i < len; i++) {
        const key = store.key(i);
        if (key === null) continue;
        const val = store.getItem(key) || '';
        const flags = classifyStorageItem(key, val);
        items.push({
          store: storeName,
          key,
          value: val.length > 200 ? val.substring(0, 200) + '\u2026' : val,
          size: val.length,
          flags,
        });
      }
    } catch {}
    return items;
  }

  try {
    const localItems = scanStorage(localStorage, 'local');
    const sessionItems = scanStorage(sessionStorage, 'session');
    const allItems = [...localItems, ...sessionItems];
    const flaggedItems = allItems.filter(i => i.flags.length > 0);

    // Group by category
    const byCategory = {};
    for (const item of flaggedItems) {
      for (const cat of item.flags) {
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(item.key);
      }
    }

    scanData.storage = {
      localStorage: { total: localItems.length, flagged: flaggedItems.filter(i => i.store === 'local') },
      sessionStorage: { total: sessionItems.length, flagged: flaggedItems.filter(i => i.store === 'session') },
      totalKeys: allItems.length,
      flaggedCount: flaggedItems.length,
      byCategory,
      flaggedKeys: flaggedItems.slice(0, 10).map(i => ({ key: i.key, flags: i.flags })),
    };
  } catch {
    scanData.storage = {
      localStorage: { total: 0, flagged: [] },
      sessionStorage: { total: 0, flagged: [] },
      totalKeys: 0, flaggedCount: 0, byCategory: {}, flaggedKeys: [],
    };
  }

  // 5. Links (from wearelinked v0.3.0)
  const links = document.querySelectorAll('a[href]');
  let withTracking = 0;
  let redirectWrappers = 0;
  const linkDetails = [];

  links.forEach(a => {
    try {
      const url = new URL(a.href, location.origin);
      const found = TRACKING_PARAMS.filter(p => url.searchParams.has(p));
      if (found.length) {
        withTracking++;
        if (linkDetails.length < 5) linkDetails.push({ href: a.href.substring(0, 150), params: found });
      }
      const h = url.hostname;
      if (h.includes('google.com/url') || h.includes('l.facebook.com') ||
          h === 't.co' || h === 'bit.ly' || h === 'tinyurl.com') {
        redirectWrappers++;
      }
    } catch {}
  });

  scanData.links = {
    total: links.length,
    withTracking,
    redirectWrappers,
    details: linkDetails,
  };

  // 6. Find ToS/privacy links on the page for background to fetch
  const tosLinks = [];
  const tosRe = /privacy|terms|tos|legal|cookie.?policy/i;
  links.forEach(a => {
    try {
      const href = a.href;
      const text = (a.textContent || '').trim().toLowerCase();
      if ((tosRe.test(href) || tosRe.test(text)) && href.startsWith('http')) {
        tosLinks.push(href);
      }
    } catch {}
  });
  scanData.tosLinks = [...new Set(tosLinks)].slice(0, 10);

  // 7. Form fields (from wearesilent v0.1.0 — Method B: passive awareness)
  scanData.formFields = scanFormFields();

  sendUpdate();
}

// =============================================================================
// From wearesilent v0.1.0 — Form field scanning (Method B: passive)
// =============================================================================
function getAriaLabel(el) {
  // 1. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const texts = [];
    for (const id of labelledBy.split(/\s+/)) {
      const ref = document.getElementById(id);
      if (ref) texts.push(ref.textContent.trim());
    }
    const joined = texts.join(' ').trim();
    if (joined) return joined;
  }
  // 2. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  // 3. <label for="id">
  if (el.id) {
    const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (label) { const t = label.textContent.trim(); if (t) return t; }
  }
  // 4. Wrapping <label>
  const parent = el.closest('label');
  if (parent) {
    const clone = parent.cloneNode(true);
    clone.querySelectorAll('input, textarea, select').forEach(i => i.remove());
    const t = clone.textContent.trim();
    if (t) return t;
  }
  // 5. placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) return placeholder.trim();
  // 6. name or id fallback
  const name = el.name || el.id;
  if (name) return name.replace(/[_\-\[\].]+/g, ' ').trim();
  return null;
}

function scanFormFields() {
  const fields = [];
  const seen = new Set();
  document.querySelectorAll('input, textarea, select').forEach(el => {
    const type = (el.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') return;
    // Skip invisible (except password)
    if (type !== 'password' && el.offsetParent === null) return;
    const label = getAriaLabel(el);
    if (!label || seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    fields.push(label.substring(0, 60));
  });
  return fields;
}

// --- Send to background ---
function sendUpdate() {
  chrome.runtime.sendMessage({
    type: 'scanResult',
    domain: location.hostname,
    url: location.href,
    data: {
      fingerprinting: scanData.fingerprinting,
      beacons: scanData.beacons,
      trackers: scanData.trackers,
      darkPatterns: scanData.darkPatterns,
      storage: scanData.storage,
      links: scanData.links,
      thirdPartyScripts: scanData.thirdPartyScripts,
      tosLinks: scanData.tosLinks,
      formFields: scanData.formFields,
    },
  });
}

// --- ToS fetch fallback: background asks content script to fetch (has page cookies/context) ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetchToS') {
    (async () => {
      for (const url of msg.urls) {
        try {
          const resp = await fetch(url, { credentials: 'include' });
          const html = await resp.text();
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
            .replace(/\s+/g, ' ').trim();
          if (text.length > 100) {
            sendResponse({ text, url });
            return;
          }
        } catch {}
      }
      sendResponse(null);
    })();
    return true; // async response
  }
});
